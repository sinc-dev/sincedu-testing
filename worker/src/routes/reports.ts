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

async function persistReport(c: any, params: {
  project: string;
  reporterEmail: string;
  reporterName: string | null;
  meta: Record<string, unknown>;
  screenshot: unknown;
}) {
  const project = sanitizePlainText(params.project || "default", 100) || "default";
  const note = sanitizePlainText(params.meta.note, 4000);
  const explicitTitle = sanitizePlainText(params.meta.title, 120);
  const title = explicitTitle || (note.split("\n")[0] || "Tester report").slice(0, 120);
  const severity = normalizeSeverity(params.meta.severity);
  const pageUrl = sanitizePlainText(params.meta.pageUrl, 2000) || null;
  const userAgent = sanitizePlainText(params.meta.userAgent, 500) || null;
  const elementSelector = sanitizePlainText(params.meta.elementSelector, 1000) || null;
  const elementText = sanitizePlainText(params.meta.elementText, 1000) || null;
  const elementRect = params.meta.elementRect && typeof params.meta.elementRect === "object"
    ? JSON.stringify(params.meta.elementRect).slice(0, 2000)
    : null;
  const consoleLogs = sanitizeLogEntries(params.meta.consoleLogs);
  const networkLogs = sanitizeLogEntries(params.meta.networkLogs);

  const id = normalizeSourceId(params.meta.localReportId) || uuid();
  const baseKey = `reports/${project}/${id}`;
  let screenshotKey: string | null = null;
  let consoleKey: string | null = null;
  let networkKey: string | null = null;

  const screenshot = params.screenshot as
    | { size?: number; type?: string; arrayBuffer?: () => Promise<ArrayBuffer> }
    | null;
  if (screenshot && typeof screenshot.arrayBuffer === "function" && (screenshot.size ?? 0) > 0) {
    if ((screenshot.size ?? 0) > MAX_SCREENSHOT_BYTES) {
      return c.json({ error: "Bad Request", message: "Screenshot too large" }, 400);
    }
    screenshotKey = `${baseKey}/screenshot.jpg`;
    await c.env.STORAGE.put(screenshotKey, await screenshot.arrayBuffer(), {
      httpMetadata: { contentType: screenshot.type || "image/jpeg" },
    });
  }

  if (consoleLogs.length > 0) {
    consoleKey = `${baseKey}/console.json`;
    await c.env.STORAGE.put(consoleKey, JSON.stringify(consoleLogs), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  if (networkLogs.length > 0) {
    networkKey = `${baseKey}/network.json`;
    await c.env.STORAGE.put(networkKey, JSON.stringify(networkLogs), {
      httpMetadata: { contentType: "application/json" },
    });
  }

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO reports (
      id, project, reporter_email, reporter_name, title, note, severity,
      page_url, user_agent, element_selector, element_text, element_rect,
      screenshot_key, console_logs_key, network_logs_key, console_count, network_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      screenshotKey,
      consoleKey,
      networkKey,
      consoleLogs.length,
      networkLogs.length,
    )
    .run();

  return c.json({ id, status: "open" }, 201);
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

  return persistReport(c, {
    project: String(form.get("project") || "default"),
    reporterEmail: user.email,
    reporterName: user.name,
    meta: parseMeta(form.get("meta")),
    screenshot: form.get("screenshot"),
  });
});

reports.post("/integrations/education-portals", async (c) => {
  const configuredToken = c.env.EDUCATION_PORTALS_INGEST_TOKEN;
  const providedToken = c.req.header("x-sincedu-ingest-token");
  if (!configuredToken || !providedToken || providedToken !== configuredToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const form = await c.req.formData();
  const reporterEmail = normalizeEmail(form.get("reporterEmail"));
  if (!reporterEmail) return c.json({ error: "Bad Request", message: "reporterEmail is required" }, 400);

  const admin = isAdminEmail(reporterEmail, c.env.ADMIN_EMAILS);
  const tester = admin || (await isAllowlisted(c.env.DB, reporterEmail));
  if (!tester) return c.json({ error: "Forbidden", message: "Reporter is not on the tester allowlist" }, 403);

  return persistReport(c, {
    project: String(form.get("project") || "educational-portals"),
    reporterEmail,
    reporterName: sanitizePlainText(form.get("reporterName"), 200) || null,
    meta: parseMeta(form.get("meta")),
    screenshot: form.get("screenshot"),
  });
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

// GET /:id/screenshot
reports.get("/:id/screenshot", requireAuth, requireTester, async (c) => {
  const id = c.req.param("id");
  const report = await c.env.DB.prepare("SELECT reporter_email, screenshot_key FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id)
    .first();
  if (!report) return c.json({ error: "Not Found" }, 404);
  if (!(await canAccessReport(c, report as { reporter_email: string }))) return c.json({ error: "Forbidden" }, 403);
  return serveR2(c, (report as { screenshot_key: string | null }).screenshot_key);
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
