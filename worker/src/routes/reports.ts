import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { isAdminEmail, verifySupabaseToken } from "../auth.js";
import { isAllowlisted, normalizeEmail, uuid } from "../db.js";
import { requireAdmin, requireAuth, requireTester } from "../middleware.js";
import { notifyReportsChanged, type ReportRealtimeEvent } from "../realtime.js";

const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
const MAX_LOG_ENTRIES = 200;
const ALLOWED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const ALLOWED_STATUSES = new Set(["open", "investigating", "in_progress", "fixed", "resolved", "closed"]);
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reports = new Hono<{ Bindings: Env; Variables: Variables }>();

function queueReportChange(c: any, event: Omit<ReportRealtimeEvent, "type" | "at">): void {
  if (!c.env.REPORT_REALTIME) return;
  const task = notifyReportsChanged(c.env as Env, event).catch((err) => {
    console.warn("[realtime] report change broadcast failed", err);
  });
  try {
    c.executionCtx?.waitUntil?.(task);
  } catch {
    void task;
  }
}

function redact(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return sanitizePlainText(value.replace(JWT_PATTERN, "[redacted-token]"), 2000);
}

function sanitizePlainText(value: unknown, maxLength = 4000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeLogEntries(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_LOG_ENTRIES).map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entry as Record<string, unknown>)) out[key] = redact(val);
    return out;
  });
}

function normalizeSeverity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return ALLOWED_SEVERITIES.has(lower) ? lower : null;
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return ALLOWED_STATUSES.has(lower) ? lower : null;
}

function normalizeCommitSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeCommitUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = sanitizePlainText(value, 500);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 200))];
}

type ActorSource = "dashboard" | "mcp" | "widget";

interface MutationActor {
  email: string;
  source: ActorSource;
}

type ReportAuditSnapshot = Record<string, unknown>;

function dashboardActor(email: string): MutationActor {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new ReportError(403, "Updater email is required");
  return { email: normalized, source: "dashboard" };
}

function widgetActor(email: string): MutationActor {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new ReportError(403, "Updater email is required");
  return { email: normalized, source: "widget" };
}

function auditSnapshot(row: Record<string, unknown> | null): ReportAuditSnapshot | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    severity: row.severity,
    status: row.status,
    resolution: row.resolution,
    page_url: row.page_url,
    deleted_at: row.deleted_at,
    updated_by_email: row.updated_by_email,
    updated_by_source: row.updated_by_source,
    fixed_at: row.fixed_at,
    fixed_by_email: row.fixed_by_email,
    fix_commit_sha: row.fix_commit_sha,
    fix_commit_url: row.fix_commit_url,
    updated_at: row.updated_at,
  };
}

async function insertReportAuditEvent(
  env: Env,
  reportId: string,
  actor: MutationActor,
  action: string,
  before: ReportAuditSnapshot | null,
  after: ReportAuditSnapshot | null,
) {
  await env.DB.prepare(
    `INSERT INTO report_audit_events (id, report_id, actor_email, actor_source, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uuid(),
      reportId,
      actor.email,
      actor.source,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    )
    .run();
}

async function getReportForAudit(env: Env, id: string): Promise<Record<string, unknown> | null> {
  return await env.DB.prepare(
    `SELECT id, title, note, severity, status, resolution, page_url, deleted_at,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, updated_at
     FROM reports
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(id)
    .first() as Record<string, unknown> | null;
}

async function getLatestFixedEvent(env: Env, reportId: string): Promise<Record<string, unknown> | null> {
  return await env.DB.prepare(
    `SELECT id, report_id, actor_email, actor_source, action, before_json, after_json, created_at
     FROM report_audit_events
     WHERE report_id = ? AND json_extract(after_json, '$.status') = 'fixed'
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(reportId)
    .first() as Record<string, unknown> | null;
}

interface NormalizedElement {
  selector: string;
  text: string;
  rect: unknown;
}

// Builds the list of picked elements. Prefers `meta.elements` (the multi-element
// payload); falls back to the legacy single-element fields so older senders and
// the education-portals mirror keep working.
function normalizeElements(value: unknown, meta: Record<string, unknown>): NormalizedElement[] {
  const out: NormalizedElement[] = [];
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 25)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const selector = sanitizePlainText(e.selector, 1000);
      const text = sanitizePlainText(e.text, 1000);
      const rect = e.rect && typeof e.rect === "object" ? e.rect : null;
      if (!selector && !text && !rect) continue;
      out.push({ selector, text, rect });
    }
  }
  if (out.length === 0) {
    const selector = sanitizePlainText(meta.elementSelector, 1000);
    const text = sanitizePlainText(meta.elementText, 1000);
    const rect = meta.elementRect && typeof meta.elementRect === "object" ? meta.elementRect : null;
    if (selector || text || rect) out.push({ selector, text, rect });
  }
  return out;
}

function normalizeSourceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Carries an HTTP status so context-free ingest paths can surface a clean error. */
export class ReportError extends Error {
  constructor(public status: 400 | 403, message: string) {
    super(message);
    this.name = "ReportError";
  }
}

type ScreenshotInput =
  | { size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> }
  | { bytes: ArrayBuffer; type?: string }
  | null
  | undefined;

async function normalizeScreenshot(
  input: ScreenshotInput,
): Promise<{ data: ArrayBuffer; type: string } | null> {
  if (!input) return null;
  // File/Blob from a multipart form — check this FIRST. Modern Workers runtimes
  // add Blob.prototype.bytes(), so a File now also has a `bytes` member; the RPC
  // branch below must not misfire on it (returning the method to R2.put throws
  // "parameter 2 is not of type ...").
  const file = input as { size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof file.arrayBuffer === "function") {
    if ((file.size ?? 0) <= 0) return null;
    if ((file.size ?? 0) > MAX_SCREENSHOT_BYTES) throw new ReportError(400, "Screenshot too large");
    return { data: await file.arrayBuffer(), type: file.type || "image/jpeg" };
  }
  // RPC payload: a raw binary buffer in `bytes` (only a real ArrayBuffer/view).
  if ("bytes" in input && (input.bytes instanceof ArrayBuffer || ArrayBuffer.isView(input.bytes))) {
    const size = input.bytes.byteLength;
    if (size <= 0) return null;
    if (size > MAX_SCREENSHOT_BYTES) throw new ReportError(400, "Screenshot too large");
    return { data: input.bytes, type: input.type || "image/jpeg" };
  }
  return null;
}

/**
 * Context-free report writer shared by the HTTP route and the RPC entrypoint.
 * Persists screenshot/console/network blobs to R2 and the row to D1, returning
 * the created id. Throws ReportError for client-facing failures.
 */
async function persistReportCore(env: Env, params: {
  project: string;
  reporterEmail: string;
  reporterName: string | null;
  meta: Record<string, unknown>;
  // Either a single screenshot (legacy / RPC mirror) or several (multi-element).
  screenshot?: ScreenshotInput;
  screenshots?: ScreenshotInput[];
}): Promise<{ id: string; status: string }> {
  const project = sanitizePlainText(params.project || "default", 100) || "default";
  const note = sanitizePlainText(params.meta.note, 4000);
  const explicitTitle = sanitizePlainText(params.meta.title, 120);
  const title = explicitTitle || (note.split("\n")[0] || "Tester report").slice(0, 120);
  const severity = normalizeSeverity(params.meta.severity);
  const pageUrl = sanitizePlainText(params.meta.pageUrl, 2000) || null;
  const userAgent = sanitizePlainText(params.meta.userAgent, 500) || null;

  const elements = normalizeElements(params.meta.elements, params.meta);
  const primary = elements[0] ?? null;
  const elementSelector = primary?.selector || null;
  const elementText = primary?.text || null;
  const elementRect = primary?.rect ? JSON.stringify(primary.rect).slice(0, 2000) : null;
  const elementsJson = elements.length > 0 ? JSON.stringify(elements).slice(0, 20000) : null;

  const consoleLogs = sanitizeLogEntries(params.meta.consoleLogs);
  const networkLogs = sanitizeLogEntries(params.meta.networkLogs);

  const id = normalizeSourceId(params.meta.localReportId) || uuid();
  const baseKey = `reports/${project}/${id}`;
  let consoleKey: string | null = null;
  let networkKey: string | null = null;

  // Persist every screenshot. The first one is treated as primary (its key
  // lands in screenshot_key so legacy readers and the list view still work).
  const inputs: ScreenshotInput[] = params.screenshots?.length
    ? params.screenshots
    : params.screenshot
      ? [params.screenshot]
      : [];
  const screenshotKeys: string[] = [];
  for (const input of inputs) {
    const shot = await normalizeScreenshot(input);
    if (!shot) continue;
    const key = `${baseKey}/screenshot-${screenshotKeys.length}.jpg`;
    await env.STORAGE.put(key, shot.data, { httpMetadata: { contentType: shot.type } });
    screenshotKeys.push(key);
  }
  const screenshotKey = screenshotKeys[0] ?? null;
  const screenshotKeysJson = screenshotKeys.length > 0 ? JSON.stringify(screenshotKeys) : null;

  if (consoleLogs.length > 0) {
    consoleKey = `${baseKey}/console.json`;
    await env.STORAGE.put(consoleKey, JSON.stringify(consoleLogs), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  if (networkLogs.length > 0) {
    networkKey = `${baseKey}/network.json`;
    await env.STORAGE.put(networkKey, JSON.stringify(networkLogs), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO reports (
      id, project, reporter_email, reporter_name, title, note, severity,
      page_url, user_agent, element_selector, element_text, element_rect, elements,
      screenshot_key, screenshot_keys, console_logs_key, network_logs_key, console_count, network_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      project,
      normalizeEmail(params.reporterEmail),
      params.reporterName,
      title,
      note,
      severity,
      pageUrl,
      userAgent,
      elementSelector,
      elementText,
      elementRect,
      elementsJson,
      screenshotKey,
      screenshotKeysJson,
      consoleKey,
      networkKey,
      consoleLogs.length,
      networkLogs.length,
    )
    .run();

  // `INSERT OR IGNORE` silently writes nothing on a constraint conflict. Never
  // report success blindly — the widget shows "Report sent ✓" on any 2xx, so a
  // dropped row here previously surfaced as a false confirmation. When no row
  // was written, distinguish an idempotent replay (the id already exists →
  // success) from a genuine drop (nothing persisted → surface an error so the
  // client can retry instead of losing the report).
  if (!result.meta || result.meta.changes === 0) {
    const existing = await env.DB
      .prepare("SELECT status FROM reports WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ status: string | null }>();
    if (!existing) {
      throw new Error(`Report ${id} was not persisted (insert ignored, no existing row)`);
    }
    return { id, status: existing.status ?? "open" };
  }

  return { id, status: "open" };
}

/** Hono wrapper used by the dashboard POST route. Maps ReportError to JSON. */
async function persistReport(c: any, params: {
  project: string;
  reporterEmail: string;
  reporterName: string | null;
  meta: Record<string, unknown>;
  screenshots: unknown[];
}) {
  try {
    const result = await persistReportCore(c.env as Env, {
      ...params,
      screenshots: params.screenshots as ScreenshotInput[],
    });
    queueReportChange(c, { action: "created", id: result.id, project: params.project });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof ReportError) {
      return c.json({ error: "Bad Request", message: err.message }, err.status);
    }
    throw err;
  }
}

/**
 * Token-free ingest used by the education-portals senders over a Service
 * Binding (RPC). Enforces the tester allowlist, then persists. Throws
 * ReportError(400/403) for client-facing failures.
 */
export async function ingestEducationPortalsReport(env: Env, payload: {
  project?: unknown;
  reporterEmail?: unknown;
  reporterName?: unknown;
  meta?: unknown;
  screenshot?: ScreenshotInput;
  screenshots?: ScreenshotInput[];
}): Promise<{ id: string; status: string }> {
  const reporterEmail = normalizeEmail(
    typeof payload.reporterEmail === "string" ? payload.reporterEmail : "",
  );
  if (!reporterEmail) throw new ReportError(400, "reporterEmail is required");

  const admin = isAdminEmail(reporterEmail, env.ADMIN_EMAILS);
  const tester = admin || (await isAllowlisted(env.DB, reporterEmail));
  if (!tester) throw new ReportError(403, "Reporter is not on the tester allowlist");

  const meta = typeof payload.meta === "string" ? parseMeta(payload.meta) : (
    payload.meta && typeof payload.meta === "object" ? payload.meta as Record<string, unknown> : {}
  );

  const result = await persistReportCore(env, {
    project: typeof payload.project === "string" && payload.project.trim()
      ? payload.project
      : "educational-portals",
    reporterEmail,
    reporterName: sanitizePlainText(payload.reporterName, 200) || null,
    meta,
    screenshot: payload.screenshot,
    screenshots: payload.screenshots,
  });
  await notifyReportsChanged(env, { action: "created", id: result.id }).catch((err) => {
    console.warn("[realtime] report change broadcast failed", err);
  });
  return result;
}

async function canAccessReport(c: any, report: { reporter_email: string }): Promise<boolean> {
  const user = c.get("user");
  if (isAdminEmail(user.email, c.env.ADMIN_EMAILS)) return true;
  return normalizeEmail(report.reporter_email) === normalizeEmail(user.email);
}

async function ensureTesterCanInspectReport(c: any, id: string): Promise<Record<string, unknown> | null> {
  return await c.env.DB.prepare("SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first() as Record<string, unknown> | null;
}

interface AnalyticsReportRow {
  id: string;
  project: string | null;
  reporter_email: string | null;
  severity: string | null;
  status: string | null;
  page_url: string | null;
  console_count: number | null;
  network_count: number | null;
  screenshot_key: string | null;
  created_at: string;
}

interface CounterMap {
  [key: string]: number;
}

interface AnalyticsTotals {
  reports: number;
  projects: number;
  open: number;
  active: number;
  done: number;
  withLogs: number;
  withScreenshots: number;
  lastReportAt: string | null;
}

function incrementCounter(counter: CounterMap, key: string | null | undefined, amount = 1): void {
  const normalized = key?.trim() || "Unspecified";
  counter[normalized] = (counter[normalized] ?? 0) + amount;
}

function getUrlDomain(url: string | null | undefined): string {
  if (!url) return "No URL";
  try {
    return new URL(url).hostname || "No URL";
  } catch {
    return "Invalid URL";
  }
}

function toSortedBreakdown(counter: CounterMap): Array<{ name: string; count: number }> {
  return Object.entries(counter)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function makeEmptyCounters(): { byStatus: CounterMap; bySeverity: CounterMap; byReporter: CounterMap; byDomain: CounterMap } {
  return { byStatus: {}, bySeverity: {}, byReporter: {}, byDomain: {} };
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseAnalyticsDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return [7, 14, 30, 90].includes(parsed) ? parsed : 14;
}

function startOfUtcDay(value: Date): Date {
  const copy = new Date(value);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addUtcDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function rowCreatedAt(row: AnalyticsReportRow): Date | null {
  const created = new Date(row.created_at);
  return Number.isNaN(created.getTime()) ? null : created;
}

function isActiveStatus(status: string): boolean {
  return status === "investigating" || status === "in_progress";
}

function isDoneStatus(status: string): boolean {
  return status === "fixed" || status === "resolved" || status === "closed";
}

function summarizeRows(rows: AnalyticsReportRow[]): AnalyticsTotals {
  const projects = new Set<string>();
  let open = 0;
  let active = 0;
  let done = 0;
  let withLogs = 0;
  let withScreenshots = 0;
  let lastReportAt: string | null = null;

  for (const row of rows) {
    projects.add(row.project?.trim() || "default");
    const status = row.status?.trim() || "open";
    if (status === "open") open += 1;
    if (isActiveStatus(status)) active += 1;
    if (isDoneStatus(status)) done += 1;
    if ((row.console_count ?? 0) + (row.network_count ?? 0) > 0) withLogs += 1;
    if (row.screenshot_key) withScreenshots += 1;
    if (!lastReportAt || row.created_at > lastReportAt) lastReportAt = row.created_at;
  }

  return {
    reports: rows.length,
    projects: projects.size,
    open,
    active,
    done,
    withLogs,
    withScreenshots,
    lastReportAt,
  };
}

// GET /access — does the current user have tester capabilities?
reports.get("/access", requireAuth, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const tester = admin || (await isAllowlisted(c.env.DB, user.email));
  return c.json({ isTester: tester, isAdmin: admin, email: user.email, name: user.name });
});

// Is this request coming from a localhost dev origin? Used to allow
// unauthenticated report submissions during local development.
function isLocalhostOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  } catch {
    return false;
  }
}

// Auth gate for report submission. Localhost dev origins may submit without a
// token (attributed to a synthetic local reporter); every other origin must
// present a valid tester token.
const submitAuth = async (c: any, next: any) => {
  const origin = c.req.header("origin") || c.req.header("referer");
  if (isLocalhostOrigin(origin)) {
    c.set("user", { uid: "local", email: "local@localhost", name: "Local Dev", emailVerified: false });
    return next();
  }
  return requireAuth(c, async () => {
    await requireTester(c, next);
  });
};

// POST / — submit a report (multipart: project, meta JSON, optional screenshot)
reports.post("/", submitAuth, async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();

  // New multi-element widget sends repeated `screenshots`; older senders send a
  // single `screenshot`. Accept both.
  const multi = form.getAll("screenshots").filter(Boolean);
  const legacy = form.get("screenshot");
  const screenshots = multi.length > 0 ? multi : legacy ? [legacy] : [];

  return persistReport(c, {
    project: String(form.get("project") || "default"),
    reporterEmail: user.email,
    reporterName: user.name,
    meta: parseMeta(form.get("meta")),
    screenshots,
  });
});

// Legacy HTTP ingest (shared token). Senders on a Service Binding use the
// token-free RPC method (ingestReport) instead; this path stays for backward
// compatibility and as a fallback while the binding rolls out.
reports.post("/integrations/education-portals", async (c) => {
  const configuredToken = c.env.EDUCATION_PORTALS_INGEST_TOKEN;
  const providedToken = c.req.header("x-sincedu-ingest-token");
  if (!configuredToken || !providedToken || providedToken !== configuredToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const form = await c.req.formData();
  const multiShots = form.getAll("screenshots").filter(Boolean) as ScreenshotInput[];
  try {
    const result = await ingestEducationPortalsReport(c.env, {
      project: form.get("project"),
      reporterEmail: form.get("reporterEmail"),
      reporterName: form.get("reporterName"),
      meta: form.get("meta"),
      screenshot: form.get("screenshot") as ScreenshotInput,
      screenshots: multiShots.length > 0 ? multiShots : undefined,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof ReportError) {
      const label = err.status === 403 ? "Forbidden" : "Bad Request";
      return c.json({ error: label, message: err.message }, err.status);
    }
    throw err;
  }
});

// GET / — list reports. Admin sees all; testers see their own.
reports.get("/", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const project = c.req.query("project");
  const pageUrl = c.req.query("pageUrl")?.trim();
  const requestedLimit = Number(c.req.query("limit") ?? 200);
  const requestedOffset = Number(c.req.query("offset") ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200, 1), 500);
  const offset = Math.max(Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0, 0);

  const filters: string[] = [];
  const binds: unknown[] = [];
  if (!admin && !pageUrl) {
    filters.push("reporter_email = ?");
    binds.push(normalizeEmail(user.email));
  }
  if (project) {
    filters.push("project = ?");
    binds.push(project);
  }
  if (pageUrl) {
    filters.push("page_url = ?");
    binds.push(pageUrl.slice(0, 2000));
    filters.push("element_selector IS NOT NULL");
  }
  filters.push("deleted_at IS NULL");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM reports ${where}`)
    .bind(...binds)
    .first<{ total: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT id, project, reporter_email, reporter_name, title, note, severity, status,
            page_url, element_selector, console_count, network_count, screenshot_key, screenshot_keys,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, created_at, updated_at
     FROM reports ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();

  return c.json({
    reports: results ?? [],
    total: totalRow?.total ?? 0,
    limit,
    offset,
  });
});

// GET /analytics — summarized report analytics. Admins see all projects;
// testers see only their own report activity.
reports.get("/analytics", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const days = parseAnalyticsDays(c.req.query("days"));
  const filters: string[] = ["deleted_at IS NULL"];
  const binds: unknown[] = [];

  if (!admin) {
    filters.push("reporter_email = ?");
    binds.push(normalizeEmail(user.email));
  }

  const where = `WHERE ${filters.join(" AND ")}`;
  const { results } = await c.env.DB.prepare(
    `SELECT id, project, reporter_email, severity, status, page_url,
            console_count, network_count, screenshot_key, created_at
     FROM reports ${where}
     ORDER BY created_at DESC`,
  )
    .bind(...binds)
    .all<AnalyticsReportRow>();

  const rows = results ?? [];
  const today = startOfUtcDay(new Date());
  const currentStart = addUtcDays(today, -(days - 1));
  const currentEnd = addUtcDays(today, 1);
  const previousStart = addUtcDays(currentStart, -days);
  const previousEnd = currentStart;
  const currentPeriodRows: AnalyticsReportRow[] = [];
  const previousPeriodRows: AnalyticsReportRow[] = [];
  const global = makeEmptyCounters();
  const projectMap = new Map<string, {
    project: string;
    total: number;
    open: number;
    active: number;
    done: number;
    withLogs: number;
    withScreenshots: number;
    lastReportAt: string | null;
    byStatus: CounterMap;
    bySeverity: CounterMap;
    byReporter: CounterMap;
    byDomain: CounterMap;
  }>();

  const recentDays = Array.from({ length: days }, (_, index) => {
    const date = addUtcDays(currentStart, index);
    return dayKey(date);
  });
  const recentCounts = Object.fromEntries(recentDays.map((day) => [day, 0])) as CounterMap;

  let withLogs = 0;
  let withScreenshots = 0;
  let lastReportAt: string | null = null;

  for (const row of rows) {
    const project = row.project?.trim() || "default";
    const status = row.status?.trim() || "open";
    const severity = row.severity?.trim() || "Unspecified";
    const reporter = normalizeEmail(row.reporter_email ?? "") || "Unknown reporter";
    const domain = getUrlDomain(row.page_url);
    const logCount = (row.console_count ?? 0) + (row.network_count ?? 0);
    const hasLogs = logCount > 0;
    const hasScreenshot = Boolean(row.screenshot_key);

    let projectSummary = projectMap.get(project);
    if (!projectSummary) {
      projectSummary = {
        project,
        total: 0,
        open: 0,
        active: 0,
        done: 0,
        withLogs: 0,
        withScreenshots: 0,
        lastReportAt: null,
        ...makeEmptyCounters(),
      };
      projectMap.set(project, projectSummary);
    }

    projectSummary.total += 1;
    if (status === "open") projectSummary.open += 1;
    if (isActiveStatus(status)) projectSummary.active += 1;
    if (isDoneStatus(status)) projectSummary.done += 1;
    if (hasLogs) projectSummary.withLogs += 1;
    if (hasScreenshot) projectSummary.withScreenshots += 1;
    if (!projectSummary.lastReportAt || row.created_at > projectSummary.lastReportAt) {
      projectSummary.lastReportAt = row.created_at;
    }

    incrementCounter(projectSummary.byStatus, status);
    incrementCounter(projectSummary.bySeverity, severity);
    incrementCounter(projectSummary.byReporter, reporter);
    incrementCounter(projectSummary.byDomain, domain);

    incrementCounter(global.byStatus, status);
    incrementCounter(global.bySeverity, severity);
    incrementCounter(global.byReporter, reporter);
    incrementCounter(global.byDomain, domain);

    if (hasLogs) withLogs += 1;
    if (hasScreenshot) withScreenshots += 1;
    if (!lastReportAt || row.created_at > lastReportAt) lastReportAt = row.created_at;

    const created = rowCreatedAt(row);
    if (created) {
      const createdDay = dayKey(created);
      if (createdDay in recentCounts) recentCounts[createdDay] += 1;
      if (created >= currentStart && created < currentEnd) currentPeriodRows.push(row);
      if (created >= previousStart && created < previousEnd) previousPeriodRows.push(row);
    }
  }

  const projects = [...projectMap.values()]
    .map((project) => ({
      project: project.project,
      total: project.total,
      open: project.open,
      active: project.active,
      done: project.done,
      withLogs: project.withLogs,
      withScreenshots: project.withScreenshots,
      lastReportAt: project.lastReportAt,
      primaryDomain: toSortedBreakdown(project.byDomain).find((item) => item.name !== "No URL" && item.name !== "Invalid URL")?.name ?? null,
      byStatus: toSortedBreakdown(project.byStatus),
      bySeverity: toSortedBreakdown(project.bySeverity),
      byReporter: toSortedBreakdown(project.byReporter).slice(0, 8),
      byDomain: toSortedBreakdown(project.byDomain).slice(0, 8),
    }))
    .sort((a, b) => b.total - a.total || a.project.localeCompare(b.project));

  return c.json({
    period: {
      days,
      currentStart: dayKey(currentStart),
      currentEnd: dayKey(addUtcDays(currentEnd, -1)),
      previousStart: dayKey(previousStart),
      previousEnd: dayKey(addUtcDays(previousEnd, -1)),
    },
    totals: {
      reports: rows.length,
      projects: projects.length,
      open: global.byStatus.open ?? 0,
      active: (global.byStatus.investigating ?? 0) + (global.byStatus.in_progress ?? 0),
      done: (global.byStatus.fixed ?? 0) + (global.byStatus.resolved ?? 0) + (global.byStatus.closed ?? 0),
      withLogs,
      withScreenshots,
      lastReportAt,
    },
    periodTotals: summarizeRows(currentPeriodRows),
    previousPeriodTotals: summarizeRows(previousPeriodRows),
    byStatus: toSortedBreakdown(global.byStatus),
    bySeverity: toSortedBreakdown(global.bySeverity),
    byReporter: toSortedBreakdown(global.byReporter).slice(0, 12),
    byDomain: toSortedBreakdown(global.byDomain).slice(0, 12),
    recentTrend: recentDays.map((date) => ({ date, count: recentCounts[date] ?? 0 })),
    projects,
  });
});

// GET /realtime — authenticated WebSocket feed for report invalidation events.
reports.get("/realtime", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket" }, 426);
  }

  const token = c.req.query("token");
  if (!token) return c.json({ error: "Unauthorized", message: "Missing token" }, 401);

  try {
    const user = await verifySupabaseToken(token, c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);
    const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
    if (!admin && !(await isAllowlisted(c.env.DB, user.email))) {
      return c.json({ error: "Forbidden", message: "Not an allowlisted tester" }, 403);
    }
  } catch (err) {
    return c.json(
      { error: "Unauthorized", message: err instanceof Error ? err.message : "Invalid token" },
      401,
    );
  }

  if (!c.env.REPORT_REALTIME) return c.json({ error: "Realtime unavailable" }, 503);

  const id = c.env.REPORT_REALTIME.idFromName("reports");
  const stub = c.env.REPORT_REALTIME.get(id);
  return stub.fetch(new Request("https://reports-realtime/connect", c.req.raw));
});

async function serveR2(c: any, key: string | null) {
  if (!key) return c.json({ error: "Not Found" }, 404);
  const object = await c.env.STORAGE.get(key);
  if (!object) return c.json({ error: "Not Found" }, 404);
  const headers = new Headers({ "Cache-Control": "private, max-age=3600" });
  object.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  return new Response(object.body, { headers });
}

// POST /bulk — bulk soft-delete reports or update status. Admins can update status;
// admins and owners can soft-delete accessible reports.
reports.post("/bulk", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const body = await c.req.json<Record<string, unknown>>();
  const ids = normalizeIds(body.ids);
  if (ids.length === 0) return c.json({ error: "Bad Request", message: "ids are required" }, 400);

  const placeholders = ids.map(() => "?").join(",");
  const accessFilter = admin ? "" : " AND reporter_email = ?";
  const accessBinds = admin ? [] : [normalizeEmail(user.email)];
  const actor = dashboardActor(user.email);

  if (body.delete === true) {
    const { results: beforeRows } = await c.env.DB.prepare(
    `SELECT id, title, note, severity, status, resolution, page_url, deleted_at,
              updated_by_email, updated_by_source, fixed_at, fixed_by_email,
              fix_commit_sha, fix_commit_url, updated_at
       FROM reports
       WHERE id IN (${placeholders}) AND deleted_at IS NULL${accessFilter}`,
    )
      .bind(...ids, ...accessBinds)
      .all<Record<string, unknown>>();
    const result = await c.env.DB.prepare(
      `UPDATE reports
       SET deleted_at = COALESCE(deleted_at, datetime('now')),
           updated_by_email = ?,
           updated_by_source = ?,
           updated_at = datetime('now')
       WHERE id IN (${placeholders}) AND deleted_at IS NULL${accessFilter}`,
    )
      .bind(actor.email, actor.source, ...ids, ...accessBinds)
      .run();
    for (const before of beforeRows ?? []) {
      const reportId = String(before.id);
      const after = await getReportForAudit(c.env, reportId);
      await insertReportAuditEvent(c.env, reportId, actor, "delete", auditSnapshot(before), auditSnapshot(after));
    }
    if ((result.meta?.changes ?? 0) > 0) queueReportChange(c, { action: "deleted", ids });
    return c.json({ updated: result.meta?.changes ?? 0 });
  }

  const status = normalizeStatus(body.status);
  if (!status) return c.json({ error: "Bad Request", message: "status or delete is required" }, 400);
  if (!admin) return c.json({ error: "Forbidden" }, 403);

  const { results: beforeRows } = await c.env.DB.prepare(
    `SELECT id, title, note, severity, status, resolution, page_url, deleted_at,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, updated_at
     FROM reports
     WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(...ids)
    .all<Record<string, unknown>>();

  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET status = ?,
         fixed_at = CASE WHEN ? = 'fixed' AND fixed_at IS NULL THEN datetime('now') ELSE fixed_at END,
         fixed_by_email = CASE WHEN ? = 'fixed' AND fixed_by_email IS NULL THEN ? ELSE fixed_by_email END,
         updated_by_email = ?,
         updated_by_source = ?,
         updated_at = datetime('now')
     WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(status, status, status, actor.email, actor.email, actor.source, ...ids)
    .run();

  for (const before of beforeRows ?? []) {
    const reportId = String(before.id);
    const after = await getReportForAudit(c.env, reportId);
    await insertReportAuditEvent(c.env, reportId, actor, "status_update", auditSnapshot(before), auditSnapshot(after));
  }

  if ((result.meta?.changes ?? 0) > 0) queueReportChange(c, { action: "updated", ids });
  return c.json({ updated: result.meta?.changes ?? 0 });
});

// GET /:id/audit — recent audit events for a report (admin or owner).
reports.get("/:id/audit", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const report = await c.env.DB.prepare("SELECT reporter_email FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  if (!(await canAccessReport(c, report as { reporter_email: string }))) return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT id, report_id, actor_email, actor_source, action, before_json, after_json, created_at
     FROM report_audit_events
     WHERE report_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(id)
    .all();
  return c.json({ events: results ?? [] });
});

// GET /:id/comments — comments visible to allowlisted testers.
reports.get("/:id/comments", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id") ?? "";
  const report = await ensureTesterCanInspectReport(c, id);
  if (!report) return c.json({ error: "Not Found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, report_id, author_email, body, created_at
     FROM report_comments
     WHERE report_id = ?
     ORDER BY created_at ASC
     LIMIT 100`,
  )
    .bind(id)
    .all();
  return c.json({ comments: results ?? [] });
});

// POST /:id/comments — add a comment from an allowlisted tester.
reports.post("/:id/comments", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id") ?? "";
  const report = await ensureTesterCanInspectReport(c, id);
  if (!report) return c.json({ error: "Not Found" }, 404);

  const user = c.get("user");
  const body = await c.req.json<Record<string, unknown>>();
  const text = sanitizePlainText(body.body, 2000);
  if (!text) return c.json({ error: "Bad Request", message: "comment is required" }, 400);

  const comment = {
    id: uuid(),
    report_id: id,
    author_email: normalizeEmail(user.email),
    body: text,
    created_at: new Date().toISOString(),
  };
  await c.env.DB.prepare(
    `INSERT INTO report_comments (id, report_id, author_email, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(comment.id, comment.report_id, comment.author_email, comment.body, comment.created_at)
    .run();
  return c.json({ comment });
});

// PATCH /:id/status — allowlisted testers can move a highlighted report's stage.
reports.patch("/:id/status", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id") ?? "";
  const before = await getReportForAudit(c.env, id);
  if (!before || before.deleted_at) return c.json({ error: "Not Found" }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const status = normalizeStatus(body.status);
  if (!status) return c.json({ error: "Bad Request", message: "status must be one of: open, investigating, in_progress, fixed, resolved, closed" }, 400);

  const user = c.get("user");
  const actor = widgetActor(user.email);
  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET status = ?,
         fixed_at = CASE WHEN ? = 'fixed' AND fixed_at IS NULL THEN datetime('now') ELSE fixed_at END,
         fixed_by_email = CASE WHEN ? = 'fixed' AND fixed_by_email IS NULL THEN ? ELSE fixed_by_email END,
         updated_by_email = ?,
         updated_by_source = ?,
         updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(status, status, status, actor.email, actor.email, actor.source, id)
    .run();
  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);

  const after = await getReportForAudit(c.env, id);
  await insertReportAuditEvent(c.env, id, actor, "status_update", auditSnapshot(before), auditSnapshot(after));
  queueReportChange(c, { action: "updated", id });
  return c.json({ id, status });
});

// GET /:id — full report (admin or owner)
reports.get("/:id", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id") ?? "";
  const report = await c.env.DB.prepare("SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  if (!(await canAccessReport(c, report as { reporter_email: string }))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const latestFixedEvent = await getLatestFixedEvent(c.env, id);
  return c.json({ report: { ...(report as Record<string, unknown>), latest_fixed_event: latestFixedEvent } });
});

// Resolve the ordered list of screenshot R2 keys for a report row, tolerating
// both the legacy single `screenshot_key` and the new `screenshot_keys` JSON.
function reportScreenshotKeys(report: { screenshot_key?: string | null; screenshot_keys?: string | null }): string[] {
  if (report.screenshot_keys) {
    try {
      const parsed = JSON.parse(report.screenshot_keys);
      if (Array.isArray(parsed)) {
        const keys = parsed.filter((k): k is string => typeof k === "string" && k.length > 0);
        if (keys.length > 0) return keys;
      }
    } catch {
      /* fall through to legacy */
    }
  }
  return report.screenshot_key ? [report.screenshot_key] : [];
}

// GET /:id/screenshot — the primary (first) screenshot, for back-compat.
reports.get("/:id/screenshot", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const report = await c.env.DB.prepare("SELECT reporter_email, screenshot_key, screenshot_keys FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  return serveR2(c, reportScreenshotKeys(report as { screenshot_key: string | null; screenshot_keys: string | null })[0] ?? null);
});

// GET /:id/screenshot/:index — the Nth screenshot for multi-element reports.
reports.get("/:id/screenshot/:index", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const index = Number.parseInt(c.req.param("index") ?? "", 10);
  const report = await c.env.DB.prepare("SELECT reporter_email, screenshot_key, screenshot_keys FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  const keys = reportScreenshotKeys(report as { screenshot_key: string | null; screenshot_keys: string | null });
  const key = Number.isInteger(index) && index >= 0 ? keys[index] ?? null : null;
  return serveR2(c, key);
});

// GET /:id/logs/:type  (type = console | network)
reports.get("/:id/logs/:type", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const type = c.req.param("type");
  if (type !== "console" && type !== "network") return c.json({ error: "Bad Request" }, 400);
  const report = await c.env.DB.prepare(
    "SELECT reporter_email, console_logs_key, network_logs_key FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1",
  )
    .bind(id)
    .first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  if (!(await canAccessReport(c, report as { reporter_email: string }))) return c.json({ error: "Forbidden" }, 403);
  const key = type === "console"
    ? (report as { console_logs_key: string | null }).console_logs_key
    : (report as { network_logs_key: string | null }).network_logs_key;
  return serveR2(c, key);
});

// PATCH /:id — admin updates report details and triage fields.
reports.patch("/:id", requireAuth, requireAdmin, async (c) => {
  const user = c.get("user");
  const actor = dashboardActor(user.email);
  const id = c.req.param("id") ?? "";
  const body = await c.req.json<Record<string, unknown>>();
  const updates: string[] = [];
  const binds: unknown[] = [];
  let nextStatus: string | null = null;

  function setField(column: string, value: unknown) {
    updates.push(`${column} = ?`);
    binds.push(value);
  }

  if (typeof body.title === "string" && body.title.trim()) setField("title", body.title.trim().slice(0, 120));
  if (typeof body.note === "string") setField("note", body.note.slice(0, 4000));
  if ("severity" in body) setField("severity", normalizeSeverity(body.severity));
  if ("page_url" in body) {
    setField("page_url", typeof body.page_url === "string" && body.page_url.trim()
      ? body.page_url.trim().slice(0, 2000)
      : null);
  }
  if ("status" in body) {
    const status = normalizeStatus(body.status);
    if (status) {
      nextStatus = status;
      setField("status", status);
    }
  }
  if ("fix_commit_sha" in body) setField("fix_commit_sha", normalizeCommitSha(body.fix_commit_sha));
  if ("fix_commit_url" in body) setField("fix_commit_url", normalizeCommitUrl(body.fix_commit_url));
  if ("resolution" in body) {
    setField("resolution", typeof body.resolution === "string" && body.resolution.trim()
      ? body.resolution.trim().slice(0, 4000)
      : null);
  }

  if (updates.length === 0) return c.json({ error: "Bad Request", message: "No valid fields to update" }, 400);
  const before = await getReportForAudit(c.env, id);
  if (!before || before.deleted_at) return c.json({ error: "Not Found" }, 404);
  if (nextStatus === "fixed" && !before.fixed_at) {
    setField("fixed_at", new Date().toISOString());
  }
  if (nextStatus === "fixed" && !before.fixed_by_email) {
    setField("fixed_by_email", actor.email);
  }
  setField("updated_by_email", actor.email);
  setField("updated_by_source", actor.source);
  binds.push(id);

  const result = await c.env.DB.prepare(
    `UPDATE reports SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(...binds)
    .run();

  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  const after = await getReportForAudit(c.env, id);
  await insertReportAuditEvent(c.env, id, actor, nextStatus ? "status_update" : "report_update", auditSnapshot(before), auditSnapshot(after));
  queueReportChange(c, { action: "updated", id });
  return c.json({ id });
});

// DELETE /:id — soft-delete a report. Admins can delete any report; testers can
// delete their own reports.
reports.delete("/:id", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const actor = dashboardActor(user.email);
  const id = c.req.param("id") ?? "";
  const accessFilter = admin ? "" : " AND reporter_email = ?";
  const binds = admin ? [id] : [id, normalizeEmail(user.email)];
  const before = await getReportForAudit(c.env, id);

  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET deleted_at = COALESCE(deleted_at, datetime('now')),
         updated_by_email = ?,
         updated_by_source = ?,
         updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL${accessFilter}`,
  )
    .bind(actor.email, actor.source, ...binds)
    .run();

  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  const after = await getReportForAudit(c.env, id);
  await insertReportAuditEvent(c.env, id, actor, "delete", auditSnapshot(before), auditSnapshot(after));
  queueReportChange(c, { action: "deleted", id });
  return c.json({ id });
});

export default reports;
