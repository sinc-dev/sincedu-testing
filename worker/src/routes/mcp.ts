import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { isAdminEmail } from "../auth.js";
import { normalizeEmail, uuid } from "../db.js";
import { requireAuth, requireTester } from "../middleware.js";

const MAX_TOKEN_NAME_LENGTH = 80;
const MAX_REPORT_LIMIT = 200;
const DEFAULT_REPORT_LIMIT = 20;
const MCP_SERVER_VERSION = "0.2.0";
const TOKEN_PREFIX = "sinc_mcp_";
const ALLOWED_STATUSES = new Set(["open", "investigating", "in_progress", "fixed", "resolved", "closed"]);

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  } & Record<string, unknown>;
};

type McpTokenRow = {
  id: string;
  user_email: string;
  name: string;
  token_hash: string;
  last_four: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

interface MutationActor {
  email: string;
  source: "mcp";
}

type ReportAuditSnapshot = Record<string, unknown>;

const mcp = new Hono<{ Bindings: Env; Variables: Variables }>();

function sanitizeTokenName(value: unknown): string {
  if (typeof value !== "string") return "AI agent";
  const trimmed = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return trimmed ? trimmed.slice(0, MAX_TOKEN_NAME_LENGTH) : "AI agent";
}

function extractBearer(c: any): string | null {
  const header = c.req.header("authorization") || c.req.header("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createMcpToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${TOKEN_PREFIX}${base64Url(bytes)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function getMcpActor(c: any): Promise<{ email: string; isAdmin: boolean; tokenId: string } | Response> {
  const token = extractBearer(c);
  if (!token) return c.json({ error: "Unauthorized", message: "Missing MCP bearer token" }, 401);
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT id, user_email FROM mcp_tokens
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first() as McpTokenRow | null;
  if (!row) return c.json({ error: "Unauthorized", message: "Invalid MCP token" }, 401);
  await c.env.DB.prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ?")
    .bind(row.id)
    .run();
  const email = normalizeEmail(row.user_email);
  return { email, isAdmin: isAdminEmail(email, c.env.ADMIN_EMAILS), tokenId: row.id };
}

function numericLimit(value: unknown): number {
  const raw = Number(value ?? DEFAULT_REPORT_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_REPORT_LIMIT;
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_REPORT_LIMIT);
}

function numericOffset(value: unknown): number {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(Math.trunc(raw), 0);
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

function normalizeReportIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, MAX_REPORT_LIMIT))];
}

function sanitizeResolution(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 4000);
  return cleaned || null;
}

function normalizeCommitUrl(value: unknown): string | null {
  const cleaned = sanitizeResolution(value)?.slice(0, 500);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mcpMutationActor(actor: { email: string }): MutationActor {
  const email = normalizeEmail(actor.email);
  if (!email) throw new Error("Updater email is required");
  return { email, source: "mcp" };
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
  c: any,
  reportId: string,
  actor: MutationActor,
  action: string,
  before: ReportAuditSnapshot | null,
  after: ReportAuditSnapshot | null,
) {
  await c.env.DB.prepare(
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

async function getReportForAudit(c: any, id: string): Promise<Record<string, unknown> | null> {
  return await c.env.DB.prepare(
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

async function getLatestFixedEvent(c: any, reportId: string): Promise<Record<string, unknown> | null> {
  return await c.env.DB.prepare(
    `SELECT id, report_id, actor_email, actor_source, action, before_json, after_json, created_at
     FROM report_audit_events
     WHERE report_id = ? AND json_extract(after_json, '$.status') = 'fixed'
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(reportId)
    .first() as Record<string, unknown> | null;
}

async function listReportsForActor(c: any, actor: { email: string; isAdmin: boolean }, args: Record<string, unknown>) {
  const filters = ["deleted_at IS NULL"];
  const binds: unknown[] = [];
  if (!actor.isAdmin) {
    filters.push("reporter_email = ?");
    binds.push(actor.email);
  }
  if (typeof args.project === "string" && args.project.trim()) {
    filters.push("project = ?");
    binds.push(args.project.trim().slice(0, 100));
  }
  if (typeof args.status === "string" && args.status.trim()) {
    filters.push("status = ?");
    binds.push(args.status.trim().toLowerCase().slice(0, 40));
  }
  const limit = numericLimit(args.limit);
  const offset = numericOffset(args.offset);

  // Total matching rows (before limit/offset) so callers can paginate through
  // the full set instead of silently getting only the newest `limit` rows.
  const whereClause = filters.join(" AND ");
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM reports WHERE ${whereClause}`,
  )
    .bind(...binds)
    .first();
  const total = Number((totalRow as { total?: number } | null)?.total ?? 0);

  const pagedBinds = [...binds, limit, offset];
  const { results } = await c.env.DB.prepare(
    `SELECT id, project, reporter_email, reporter_name, title, note, severity, status,
            page_url, element_selector, console_count, network_count,
            CASE WHEN screenshot_key IS NULL THEN 0 ELSE 1 END AS has_screenshot,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, created_at, updated_at
     FROM reports
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...pagedBinds)
    .all();
  const reports = results ?? [];
  return {
    reports,
    limit,
    offset,
    total,
    hasMore: offset + reports.length < total,
  };
}

async function getAccessibleReport(c: any, actor: { email: string; isAdmin: boolean }, id: unknown) {
  if (typeof id !== "string" || !id.trim()) return null;
  const report = await c.env.DB.prepare("SELECT * FROM reports WHERE id = ? AND deleted_at IS NULL LIMIT 1")
    .bind(id.trim())
    .first() as Record<string, unknown> | null;
  if (!report) return null;
  if (!actor.isAdmin && normalizeEmail(report.reporter_email) !== actor.email) return null;
  return report;
}

async function getReportSummary(c: any, id: string) {
  const report = await c.env.DB.prepare(
    `SELECT id, project, title, status, resolution,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, updated_at
     FROM reports
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!report) return report;
  return { ...(report as Record<string, unknown>), latest_fixed_event: await getLatestFixedEvent(c, id) };
}

async function updateReportStatusForActor(
  c: any,
  actor: { email: string; isAdmin: boolean },
  args: Record<string, unknown>,
) {
  if (!actor.isAdmin) {
    throw new Error("Only admin MCP tokens can update report status");
  }
  if (typeof args.id !== "string" || !args.id.trim()) {
    throw new Error("id is required");
  }
  const status = normalizeStatus(args.status);
  if (!status) {
    throw new Error(`status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }
  const actorMeta = mcpMutationActor(actor);
  const before = await getReportForAudit(c, args.id.trim());
  if (!before || before.deleted_at) {
    throw new Error("Report not found");
  }

  const updates = ["status = ?"];
  const binds: unknown[] = [status];
  if ("resolution" in args) {
    updates.push("resolution = ?");
    binds.push(sanitizeResolution(args.resolution));
  }
  if ("fix_commit_sha" in args) {
    updates.push("fix_commit_sha = ?");
    binds.push(normalizeCommitSha(args.fix_commit_sha));
  }
  if ("fix_commit_url" in args) {
    updates.push("fix_commit_url = ?");
    binds.push(normalizeCommitUrl(args.fix_commit_url));
  }
  if (status === "fixed" && !before.fixed_at) {
    updates.push("fixed_at = datetime('now')");
  }
  if (status === "fixed" && !before.fixed_by_email) {
    updates.push("fixed_by_email = ?");
    binds.push(actorMeta.email);
  }
  updates.push("updated_by_email = ?");
  binds.push(actorMeta.email);
  updates.push("updated_by_source = ?");
  binds.push(actorMeta.source);
  binds.push(args.id.trim());

  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET ${updates.join(", ")}, updated_at = datetime('now')
     WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(...binds)
    .run();

  if (!result.meta || result.meta.changes === 0) {
    throw new Error("Report not found");
  }
  const after = await getReportForAudit(c, args.id.trim());
  await insertReportAuditEvent(c, args.id.trim(), actorMeta, "status_update", auditSnapshot(before), auditSnapshot(after));
  return await getReportSummary(c, args.id.trim());
}

async function bulkUpdateReportStatusForActor(
  c: any,
  actor: { email: string; isAdmin: boolean },
  args: Record<string, unknown>,
) {
  if (!actor.isAdmin) {
    throw new Error("Only admin MCP tokens can update report status");
  }
  const ids = normalizeReportIds(args.ids);
  if (ids.length === 0) throw new Error("ids must be a non-empty array of report ids");
  const status = normalizeStatus(args.status);
  if (!status) {
    throw new Error(`status must be one of: ${[...ALLOWED_STATUSES].join(", ")}`);
  }

  const placeholders = ids.map(() => "?").join(",");
  const actorMeta = mcpMutationActor(actor);
  const beforeResult = await c.env.DB.prepare(
    `SELECT id, title, note, severity, status, resolution, page_url, deleted_at,
            updated_by_email, updated_by_source, fixed_at, fixed_by_email,
            fix_commit_sha, fix_commit_url, updated_at
     FROM reports
     WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(...ids)
    .all();
  const beforeRows = (beforeResult.results ?? []) as Record<string, unknown>[];
  const result = await c.env.DB.prepare(
    `UPDATE reports
     SET status = ?,
         fixed_at = CASE WHEN ? = 'fixed' AND fixed_at IS NULL THEN datetime('now') ELSE fixed_at END,
         fixed_by_email = CASE WHEN ? = 'fixed' AND fixed_by_email IS NULL THEN ? ELSE fixed_by_email END,
         updated_by_email = ?,
         updated_by_source = ?,
         updated_at = datetime('now')
     WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  )
    .bind(status, status, status, actorMeta.email, actorMeta.email, actorMeta.source, ...ids)
    .run();

  for (const before of beforeRows ?? []) {
    const reportId = String(before.id);
    const after = await getReportForAudit(c, reportId);
    await insertReportAuditEvent(c, reportId, actorMeta, "status_update", auditSnapshot(before), auditSnapshot(after));
  }

  return {
    requested: ids.length,
    updated: result.meta?.changes ?? 0,
    status,
    ids,
  };
}

async function readReportLogs(c: any, report: Record<string, unknown>, type: unknown) {
  if (type !== "console" && type !== "network") {
    throw new Error("type must be console or network");
  }
  const key = type === "console" ? report.console_logs_key : report.network_logs_key;
  if (typeof key !== "string" || !key) return [];
  const object = await c.env.STORAGE.get(key);
  if (!object) return [];
  const text = await object.text();
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const tools = [
  {
    name: "list_reports",
    description: "List SINC EDU testing bug reports visible to this MCP token.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum reports to return, up to 200 (default 20)." },
        offset: { type: "number", description: "Number of rows to skip for pagination (default 0). Response includes total + hasMore." },
        status: { type: "string", description: "Optional report status filter." },
        project: { type: "string", description: "Optional project filter." },
      },
    },
  },
  {
    name: "get_report",
    description: "Fetch one full bug report by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_report_logs",
    description: "Fetch console or network logs for a bug report.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["console", "network"] },
      },
      required: ["id", "type"],
    },
  },
  {
    name: "get_report_audit_log",
    description: "Fetch recent audit events for a bug report visible to this MCP token.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_report_status",
    description: "Update one testing bug report status. Requires an admin MCP token. Status attribution is recorded in the audit trail.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Report id." },
        status: {
          type: "string",
          enum: [...ALLOWED_STATUSES],
          description: "New report status.",
        },
        resolution: {
          type: "string",
          description: "Optional short note describing what fixed or changed.",
        },
        fix_commit_sha: {
          type: "string",
          description: "Optional Git commit SHA that contains the fix.",
        },
        fix_commit_url: {
          type: "string",
          description: "Optional HTTPS URL for the fixing commit or pull request.",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "bulk_update_report_status",
    description: "Update the status of up to 50 testing bug reports. Requires an admin MCP token. Status attribution is recorded in the audit trail.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Report ids to update, up to 50.",
        },
        status: {
          type: "string",
          enum: [...ALLOWED_STATUSES],
          description: "New report status.",
        },
      },
      required: ["ids", "status"],
    },
  },
];

mcp.get("/tokens", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, last_four, created_at, last_used_at
     FROM mcp_tokens
     WHERE user_email = ? AND revoked_at IS NULL
     ORDER BY created_at DESC`,
  )
    .bind(normalizeEmail(user.email))
    .all();
  return c.json({ tokens: results ?? [] });
});

mcp.post("/tokens", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const token = createMcpToken();
  const tokenHash = await sha256Hex(token);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO mcp_tokens (id, user_email, name, token_hash, last_four)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, normalizeEmail(user.email), sanitizeTokenName(body.name), tokenHash, token.slice(-4))
    .run();
  return c.json({
    token: {
      id,
      name: sanitizeTokenName(body.name),
      last_four: token.slice(-4),
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
    secret: token,
  }, 201);
});

mcp.delete("/tokens/:id", requireAuth, requireTester, async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `UPDATE mcp_tokens
     SET revoked_at = COALESCE(revoked_at, datetime('now'))
     WHERE id = ? AND user_email = ? AND revoked_at IS NULL`,
  )
    .bind(c.req.param("id"), normalizeEmail(user.email))
    .run();
  if (!result.meta || result.meta.changes === 0) return c.json({ error: "Not Found" }, 404);
  return c.json({ id: c.req.param("id") });
});

mcp.get("/info", (c) => c.json({
  name: "SINC EDU Testing MCP",
  endpoint: "/api/mcp",
  transport: "http-json-rpc",
  auth: "Authorization: Bearer <mcp-token>",
  tools: tools.map((tool) => tool.name),
}));

mcp.post("/", async (c) => {
  const actor = await getMcpActor(c);
  if (actor instanceof Response) return actor;

  const request = await c.req.json<JsonRpcRequest>().catch(() => null);
  if (!request || request.jsonrpc !== "2.0" || !request.method) {
    return c.json(rpcError(null, -32600, "Invalid JSON-RPC request"), 400);
  }

  if (request.method === "initialize") {
    return c.json(rpcResult(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "SINC EDU Testing MCP", version: MCP_SERVER_VERSION },
    }));
  }

  if (request.method === "tools/list") {
    return c.json(rpcResult(request.id, { tools }));
  }

  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    try {
      if (name === "list_reports") {
        const result = await listReportsForActor(c, actor, args);
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        }));
      }
      if (name === "get_report") {
        const report = await getAccessibleReport(c, actor, args.id);
        if (!report) return c.json(rpcError(request.id, -32004, "Report not found"), 404);
        const latestFixedEvent = await getLatestFixedEvent(c, String(args.id).trim());
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify({ report: { ...report, latest_fixed_event: latestFixedEvent } }, null, 2) }],
        }));
      }
      if (name === "get_report_logs") {
        const report = await getAccessibleReport(c, actor, args.id);
        if (!report) return c.json(rpcError(request.id, -32004, "Report not found"), 404);
        const logs = await readReportLogs(c, report, args.type);
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify({ logs }, null, 2) }],
        }));
      }
      if (name === "get_report_audit_log") {
        const report = await getAccessibleReport(c, actor, args.id);
        if (!report) return c.json(rpcError(request.id, -32004, "Report not found"), 404);
        const { results } = await c.env.DB.prepare(
          `SELECT id, report_id, actor_email, actor_source, action, before_json, after_json, created_at
           FROM report_audit_events
           WHERE report_id = ?
           ORDER BY created_at DESC
           LIMIT 50`,
        )
          .bind(String(args.id).trim())
          .all();
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify({ events: results ?? [] }, null, 2) }],
        }));
      }
      if (name === "update_report_status") {
        const report = await updateReportStatusForActor(c, actor, args);
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify({ report }, null, 2) }],
        }));
      }
      if (name === "bulk_update_report_status") {
        const result = await bulkUpdateReportStatusForActor(c, actor, args);
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        }));
      }
      return c.json(rpcError(request.id, -32601, "Unknown tool"), 404);
    } catch (error) {
      return c.json(rpcError(request.id, -32000, error instanceof Error ? error.message : "Tool call failed"), 400);
    }
  }

  return c.json(rpcError(request.id, -32601, "Method not found"), 404);
});

export default mcp;
