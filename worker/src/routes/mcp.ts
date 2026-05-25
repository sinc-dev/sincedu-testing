import { Hono } from "hono";
import type { Env, Variables } from "../types.js";
import { isAdminEmail } from "../auth.js";
import { normalizeEmail, uuid } from "../db.js";
import { requireAuth, requireTester } from "../middleware.js";

const MAX_TOKEN_NAME_LENGTH = 80;
const MAX_REPORT_LIMIT = 50;
const DEFAULT_REPORT_LIMIT = 20;
const TOKEN_PREFIX = "sinc_mcp_";

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
  binds.push(limit);

  const { results } = await c.env.DB.prepare(
    `SELECT id, project, reporter_email, reporter_name, title, note, severity, status,
            page_url, element_selector, console_count, network_count,
            CASE WHEN screenshot_key IS NULL THEN 0 ELSE 1 END AS has_screenshot,
            created_at, updated_at
     FROM reports
     WHERE ${filters.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...binds)
    .all();
  return {
    reports: results ?? [],
    limit,
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
        limit: { type: "number", description: "Maximum reports to return, up to 50." },
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
      serverInfo: { name: "SINC EDU Testing MCP", version: "0.1.0" },
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
        return c.json(rpcResult(request.id, {
          content: [{ type: "text", text: JSON.stringify({ report }, null, 2) }],
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
      return c.json(rpcError(request.id, -32601, "Unknown tool"), 404);
    } catch (error) {
      return c.json(rpcError(request.id, -32000, error instanceof Error ? error.message : "Tool call failed"), 400);
    }
  }

  return c.json(rpcError(request.id, -32601, "Method not found"), 404);
});

export default mcp;
