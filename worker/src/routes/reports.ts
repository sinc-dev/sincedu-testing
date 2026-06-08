import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { isAdminEmail } from "../auth.js";
import { isAllowlisted, normalizeEmail, uuid } from "../db.js";
import { requireAdmin, requireAuth, requireTester } from "../middleware.js";

const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
const MAX_LOG_ENTRIES = 200;
const ALLOWED_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const ALLOWED_STATUSES = new Set(["open", "investigating", "in_progress", "fixed", "resolved", "closed"]);
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reports = new Hono<{ Bindings: Env; Variables: Variables }>();

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

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 200))];
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

  await env.DB.prepare(
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

  return persistReportCore(env, {
    project: typeof payload.project === "string" && payload.project.trim()
      ? payload.project
      : "educational-portals",
    reporterEmail,
    reporterName: sanitizePlainText(payload.reporterName, 200) || null,
    meta,
    screenshot: payload.screenshot,
    screenshots: payload.screenshots,
  });
}

async function canAccessReport(c: any, report: { reporter_email: string }): Promise<boolean> {
  const user = c.get("user");
  if (isAdminEmail(user.email, c.env.ADMIN_EMAILS)) return true;
  return normalizeEmail(report.reporter_email) === normalizeEmail(user.email);
}

// GET /access — does the current user have tester capabilities?
reports.get("/access", requireAuth, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const tester = admin || (await isAllowlisted(c.env.DB, user.email));
  return c.json({ isTester: tester, isAdmin: admin, email: user.email, name: user.name });
});

// POST / — submit a report (multipart: project, meta JSON, optional screenshot)
reports.post("/", requireAuth, requireTester, async (c) => {
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

  const filters: string[] = [];
  const binds: unknown[] = [];
  if (!admin) {
    filters.push("reporter_email = ?");
    binds.push(normalizeEmail(user.email));
  }
  if (project) {
    filters.push("project = ?");
    binds.push(project);
  }
  filters.push("deleted_at IS NULL");
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(
    `SELECT id, project, reporter_email, reporter_name, title, note, severity, status,
            page_url, element_selector, console_count, network_count, screenshot_key,
            created_at, updated_at
     FROM reports ${where} ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all();

  return c.json({ reports: results ?? [] });
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

  if (body.delete === true) {
    const result = await c.env.DB.prepare(
      `UPDATE reports
       SET deleted_at = COALESCE(deleted_at, datetime('now')), updated_at = datetime('now')
       WHERE id IN (${placeholders}) AND deleted_at IS NULL${accessFilter}`,
    )
      .bind(...ids, ...accessBinds)
      .run();
    return c.json({ updated: result.meta?.changes ?? 0 });
  }

  const status = normalizeStatus(body.status);
  if (!status) return c.json({ error: "Bad Request", message: "status or delete is required" }, 400);
  if (!admin) return c.json({ error: "Forbidden" }, 403);

  const result = await c.env.DB.prepare(
    `UPDATE reports SET status = ?, updated_at = datetime('now')
     WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  )
    .bind(status, ...ids)
    .run();

  return c.json({ updated: result.meta?.changes ?? 0 });
});

// GET /:id — full report (admin or owner)
reports.get("/:id", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const report = await c.env.DB.prepare("SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(id).first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  if (!(await canAccessReport(c, report as { reporter_email: string }))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json({ report });
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
  if (!(await canAccessReport(c, report as { reporter_email: string }))) return c.json({ error: "Forbidden" }, 403);
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
  if (!(await canAccessReport(c, report as { reporter_email: string }))) return c.json({ error: "Forbidden" }, 403);
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
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();
  const updates: string[] = [];
  const binds: unknown[] = [];

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
    if (status) setField("status", status);
  }
  if ("resolution" in body) {
    setField("resolution", typeof body.resolution === "string" && body.resolution.trim()
      ? body.resolution.trim().slice(0, 4000)
      : null);
  }

  if (updates.length === 0) return c.json({ error: "Bad Request", message: "No valid fields to update" }, 400);
  binds.push(id);

  const result = await c.env.DB.prepare(
    `UPDATE reports SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(...binds)
    .run();

  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  return c.json({ id });
});

// DELETE /:id — soft-delete a report. Admins can delete any report; testers can
// delete their own reports.
reports.delete("/:id", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const admin = isAdminEmail(user.email, c.env.ADMIN_EMAILS);
  const id = c.req.param("id");
  const accessFilter = admin ? "" : " AND reporter_email = ?";
  const binds = admin ? [id] : [id, normalizeEmail(user.email)];

  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET deleted_at = COALESCE(deleted_at, datetime('now')), updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL${accessFilter}`,
  )
    .bind(...binds)
    .run();

  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  return c.json({ id });
});

export default reports;
