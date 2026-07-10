import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import mcp from "./mcp.js";
import reports from "./reports.js";
import type { Env } from "../types.js";

type ReportRow = {
  id: string;
  project: string;
  reporter_email: string;
  reporter_name: string | null;
  title: string;
  note: string | null;
  severity: string | null;
  status: string;
  resolution: string | null;
  page_url: string | null;
  deleted_at: string | null;
  updated_by_email: string | null;
  updated_by_source: string | null;
  created_at: string;
  updated_at: string;
};

type AuditEvent = {
  id: string;
  report_id: string;
  actor_email: string;
  actor_source: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
};

type McpTokenRow = {
  id: string;
  user_email: string;
  token_hash: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

const ADMIN_EMAIL = "admin@example.com";
const TESTER_EMAIL = "tester@example.com";
const OTHER_TESTER_EMAIL = "other@example.com";
const ADMIN_TOKEN = "sinc_mcp_admin_test";
const TESTER_TOKEN = "sinc_mcp_tester_test";
const NOW = "2026-07-03 12:00:00";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function baseReport(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "report-1",
    project: "portal",
    reporter_email: TESTER_EMAIL,
    reporter_name: null,
    title: "Broken save button",
    note: "Clicking save does nothing",
    severity: "high",
    status: "open",
    resolution: null,
    page_url: "https://example.test/page",
    deleted_at: null,
    updated_by_email: null,
    updated_by_source: null,
    created_at: "2026-07-03 10:00:00",
    updated_at: "2026-07-03 10:00:00",
    ...overrides,
  };
}

function auditStatus(event: AuditEvent, side: "before" | "after"): string | undefined {
  const json = side === "before" ? event.before_json : event.after_json;
  if (!json) return undefined;
  return (JSON.parse(json) as { status?: string }).status;
}

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM mcp_tokens")) {
      const tokenHash = String(this.values[0]);
      return this.db.tokens.find((token) => token.token_hash === tokenHash && !token.revoked_at) ?? null;
    }

    if (this.sql.includes("FROM report_audit_events")) {
      const reportId = String(this.values[0]);
      const events = this.db.auditEvents
        .filter((event) => event.report_id === reportId)
        .filter((event) => !this.sql.includes("json_extract") || auditStatus(event, "after") === "fixed")
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return events[0] ? { ...events[0] } : null;
    }

    if (this.sql.includes("FROM reports") && this.sql.includes("WHERE id = ?")) {
      const report = this.db.reports.get(String(this.values[0]));
      if (!report) return null;
      if (this.sql.includes("deleted_at IS NULL") && report.deleted_at) return null;
      return { ...report };
    }

    if (this.sql.includes("COUNT(*)") && this.sql.includes("FROM reports")) {
      const binds = [...this.values];
      let rows = [...this.db.reports.values()].filter((report) => !report.deleted_at);
      if (this.sql.includes("reporter_email = ?")) {
        const v = String(binds.shift());
        rows = rows.filter((report) => report.reporter_email === v);
      }
      if (this.sql.includes("project = ?")) {
        const v = String(binds.shift());
        rows = rows.filter((report) => report.project === v);
      }
      if (this.sql.includes("status = ?")) {
        const v = String(binds.shift());
        rows = rows.filter((report) => report.status === v);
      }
      return { total: rows.length };
    }

    return null;
  }

  async all() {
    if (this.sql.includes("FROM report_audit_events")) {
      const reportId = String(this.values[0]);
      return {
        results: this.db.auditEvents
          .filter((event) => event.report_id === reportId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 50)
          .map((event) => ({ ...event })),
      };
    }

    if (this.sql.includes("FROM reports") && this.sql.includes("id IN")) {
      const rows = this.values
        .map((id) => this.db.reports.get(String(id)))
        .filter((report): report is ReportRow => report !== undefined && !report.deleted_at)
        .map((report) => ({ ...report }));
      return { results: rows };
    }

    if (this.sql.includes("FROM reports") && this.sql.includes("ORDER BY created_at DESC")) {
      const binds = [...this.values];
      const offset = Number(binds.pop() ?? 0);
      const limit = Number(binds.pop() ?? 20);
      let rows = [...this.db.reports.values()].filter((report) => !report.deleted_at);

      if (this.sql.includes("reporter_email = ?")) {
        const reporterEmail = String(binds.shift());
        rows = rows.filter((report) => report.reporter_email === reporterEmail);
      }
      if (this.sql.includes("project = ?")) {
        const project = String(binds.shift());
        rows = rows.filter((report) => report.project === project);
      }
      if (this.sql.includes("status = ?")) {
        const status = String(binds.shift());
        rows = rows.filter((report) => report.status === status);
      }

      return {
        results: rows
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(offset, offset + limit)
          .map((report) => ({
            ...report,
            element_selector: null,
            console_count: 0,
            network_count: 0,
            screenshot_key: null,
            has_screenshot: 0,
          })),
      };
    }

    return { results: [] };
  }

  async run() {
    if (this.sql.includes("UPDATE mcp_tokens")) {
      const token = this.db.tokens.find((row) => row.id === String(this.values[0]));
      if (token) token.last_used_at = NOW;
      return { meta: { changes: token ? 1 : 0 } };
    }

    if (this.sql.includes("INSERT INTO report_audit_events")) {
      const [id, reportId, actorEmail, actorSource, action, beforeJson, afterJson] = this.values;
      this.db.auditEvents.push({
        id: String(id),
        report_id: String(reportId),
        actor_email: String(actorEmail),
        actor_source: String(actorSource),
        action: String(action),
        before_json: beforeJson === null ? null : String(beforeJson),
        after_json: afterJson === null ? null : String(afterJson),
        created_at: `${NOW}.${String(++this.db.auditCounter).padStart(3, "0")}`,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes("UPDATE reports") && this.sql.includes("id IN")) return this.runBulkReportUpdate();
    if (this.sql.includes("UPDATE reports")) return this.runSingleReportUpdate();
    return { meta: { changes: 0 } };
  }

  private runSingleReportUpdate() {
    const id = String(this.values[this.values.length - 1]);
    const report = this.db.reports.get(id);
    if (!report || report.deleted_at) return { meta: { changes: 0 } };

    const assignments = [...this.sql.matchAll(/\b([a-z_]+)\s*=\s*\?/g)].map((match) => match[1]);
    let valueIndex = 0;
    for (const column of assignments) {
      const value = this.values[valueIndex++];
      if (column === "status") report.status = String(value);
      if (column === "resolution") report.resolution = value === null ? null : String(value);
      if (column === "title") report.title = String(value);
      if (column === "note") report.note = value === null ? null : String(value);
      if (column === "severity") report.severity = value === null ? null : String(value);
      if (column === "page_url") report.page_url = value === null ? null : String(value);
      if (column === "updated_by_email") report.updated_by_email = String(value);
      if (column === "updated_by_source") report.updated_by_source = String(value);
    }

    if (this.sql.includes("deleted_at = COALESCE")) report.deleted_at = NOW;
    report.updated_at = NOW;
    return { meta: { changes: 1 } };
  }

  private runBulkReportUpdate() {
    const isStatusUpdate = this.sql.includes("SET status = ?");
    const status = isStatusUpdate ? String(this.values[0]) : null;
    const actorEmail = String(this.values[isStatusUpdate ? 4 : 0]);
    const actorSource = String(this.values[isStatusUpdate ? 5 : 1]);
    const candidateIds = this.values.slice(isStatusUpdate ? 6 : 2).map(String);
    let changes = 0;

    for (const id of candidateIds) {
      const report = this.db.reports.get(id);
      if (!report || report.deleted_at) continue;
      if (status) report.status = status;
      if (this.sql.includes("deleted_at = COALESCE")) report.deleted_at = NOW;
      report.updated_by_email = actorEmail;
      report.updated_by_source = actorSource;
      report.updated_at = NOW;
      changes += 1;
    }

    return { meta: { changes } };
  }
}

class FakeD1Database {
  readonly tokens: McpTokenRow[] = [];
  readonly reports = new Map<string, ReportRow>();
  readonly auditEvents: AuditEvent[] = [];
  auditCounter = 0;

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
}

function contentJson(responseBody: any) {
  return JSON.parse(responseBody.result.content[0].text);
}

async function makeEnv(reportRows: ReportRow[]) {
  const db = new FakeD1Database();
  db.tokens.push(
    {
      id: "admin-token",
      user_email: ADMIN_EMAIL,
      token_hash: await sha256Hex(ADMIN_TOKEN),
      revoked_at: null,
      last_used_at: null,
    },
    {
      id: "tester-token",
      user_email: TESTER_EMAIL,
      token_hash: await sha256Hex(TESTER_TOKEN),
      revoked_at: null,
      last_used_at: null,
    },
  );
  for (const report of reportRows) db.reports.set(report.id, { ...report });

  return {
    DB: db as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "anon",
    ALLOWED_ORIGINS: "*",
    ADMIN_EMAILS: ADMIN_EMAIL,
  } satisfies Env;
}

async function callTool(env: Env, token: string, name: string, args: Record<string, unknown>) {
  return callRpc(env, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

async function callRpc(env: Env, token: string, body: Record<string, unknown>) {
  const response = await mcp.fetch(
    new Request("https://worker.test/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

async function callDashboard(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
    id: "admin-user",
    email: ADMIN_EMAIL,
    email_confirmed_at: NOW,
    user_metadata: { name: "Admin" },
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const response = await reports.fetch(
    new Request(`https://worker.test${path}`, {
      method,
      headers: {
        Authorization: "Bearer dashboard-token",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  return {
    status: response.status,
    body: await response.json() as any,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP report audit trail", () => {
  it("advertises the audit and status update tools", async () => {
    const env = await makeEnv([]);

    const response = await callRpc(env, ADMIN_TOKEN, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response.status).toBe(200);
    const toolNames = response.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining([
      "get_report_audit_log",
      "update_report_status",
      "bulk_update_report_status",
    ]));
  });

  it("includes last-updater fields when listing reports", async () => {
    const env = await makeEnv([
      baseReport({
        id: "report-1",
        status: "fixed",
        updated_by_email: ADMIN_EMAIL,
        updated_by_source: "mcp",
      }),
    ]);

    const response = await callTool(env, ADMIN_TOKEN, "list_reports", { status: "fixed" });

    expect(response.status).toBe(200);
    const rows = contentJson(response.body).reports;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "report-1",
      status: "fixed",
      updated_by_email: ADMIN_EMAIL,
      updated_by_source: "mcp",
    });
    expect(rows[0]).not.toHaveProperty("fixed_by_email");
  });

  it("records a status audit event when an admin MCP token fixes a report", async () => {
    const env = await makeEnv([baseReport()]);

    const update = await callTool(env, ADMIN_TOKEN, "update_report_status", {
      id: "report-1",
      status: "fixed",
      resolution: "Save handler patched.",
    });

    expect(update.status).toBe(200);
    const updated = contentJson(update.body).report;
    expect(updated).toMatchObject({
      status: "fixed",
      resolution: "Save handler patched.",
      updated_by_email: ADMIN_EMAIL,
      updated_by_source: "mcp",
    });
    expect(updated).not.toHaveProperty("fixed_by_email");

    const audit = await callTool(env, ADMIN_TOKEN, "get_report_audit_log", { id: "report-1" });
    expect(audit.status).toBe(200);
    const events = contentJson(audit.body).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      report_id: "report-1",
      actor_email: ADMIN_EMAIL,
      actor_source: "mcp",
      action: "status_update",
    });
    expect(auditStatus(events[0], "before")).toBe("open");
    expect(auditStatus(events[0], "after")).toBe("fixed");
  });

  it("derives the latest fixed transition from repeated status changes", async () => {
    const env = await makeEnv([baseReport()]);

    await callTool(env, ADMIN_TOKEN, "update_report_status", { id: "report-1", status: "fixed" });
    await callTool(env, ADMIN_TOKEN, "update_report_status", { id: "report-1", status: "in_progress" });
    await callTool(env, ADMIN_TOKEN, "update_report_status", { id: "report-1", status: "fixed" });

    const reportResponse = await callTool(env, ADMIN_TOKEN, "get_report", { id: "report-1" });
    expect(reportResponse.status).toBe(200);
    const report = contentJson(reportResponse.body).report;
    expect(report.latest_fixed_event).toMatchObject({
      actor_email: ADMIN_EMAIL,
      actor_source: "mcp",
      action: "status_update",
    });
    expect(auditStatus(report.latest_fixed_event, "after")).toBe("fixed");

    const db = env.DB as unknown as FakeD1Database;
    expect(db.auditEvents.map((event) => auditStatus(event, "after"))).toEqual(["fixed", "in_progress", "fixed"]);
  });

  it("rejects status updates from non-admin MCP tokens", async () => {
    const env = await makeEnv([baseReport()]);

    const update = await callTool(env, TESTER_TOKEN, "update_report_status", {
      id: "report-1",
      status: "fixed",
    });

    const db = env.DB as unknown as FakeD1Database;
    expect(update.status).toBe(400);
    expect(update.body.error.message).toBe("Only admin MCP tokens can update report status");
    expect(db.reports.get("report-1")?.status).toBe("open");
    expect(db.auditEvents).toHaveLength(0);
  });

  it("rejects invalid statuses before mutating reports", async () => {
    const env = await makeEnv([baseReport()]);

    const update = await callTool(env, ADMIN_TOKEN, "update_report_status", {
      id: "report-1",
      status: "done",
    });

    const db = env.DB as unknown as FakeD1Database;
    expect(update.status).toBe(400);
    expect(update.body.error.message).toContain("status must be one of");
    expect(db.reports.get("report-1")?.status).toBe("open");
    expect(db.auditEvents).toHaveLength(0);
  });

  it("does not expose another reporter's audit log to a non-admin MCP token", async () => {
    const env = await makeEnv([
      baseReport({ id: "report-1", reporter_email: OTHER_TESTER_EMAIL }),
    ]);

    const audit = await callTool(env, TESTER_TOKEN, "get_report_audit_log", { id: "report-1" });

    expect(audit.status).toBe(404);
    expect(audit.body.error.message).toBe("Report not found");
  });

  it("records one audit event per report for bulk status updates", async () => {
    const env = await makeEnv([
      baseReport({ id: "report-1" }),
      baseReport({ id: "report-2", title: "Broken delete button" }),
    ]);

    const update = await callTool(env, ADMIN_TOKEN, "bulk_update_report_status", {
      ids: ["report-1", "report-2"],
      status: "fixed",
    });

    expect(update.status).toBe(200);
    expect(contentJson(update.body)).toMatchObject({ requested: 2, updated: 2, status: "fixed" });

    const db = env.DB as unknown as FakeD1Database;
    expect(db.reports.get("report-1")).toMatchObject({
      status: "fixed",
      updated_by_email: ADMIN_EMAIL,
      updated_by_source: "mcp",
    });
    expect(db.reports.get("report-2")).toMatchObject({
      status: "fixed",
      updated_by_email: ADMIN_EMAIL,
      updated_by_source: "mcp",
    });
    expect(db.auditEvents).toHaveLength(2);
    expect(db.auditEvents.map((event) => event.action)).toEqual(["status_update", "status_update"]);
    expect(db.auditEvents.map((event) => event.actor_source)).toEqual(["mcp", "mcp"]);
  });
});

describe("Dashboard report audit trail", () => {
  it("writes last-updater fields and a status audit event on PATCH", async () => {
    const env = await makeEnv([baseReport()]);

    const response = await callDashboard(env, "PATCH", "/report-1", {
      status: "fixed",
      resolution: "Patched in dashboard.",
    });

    const db = env.DB as unknown as FakeD1Database;
    expect(response.status).toBe(200);
    expect(db.reports.get("report-1")).toMatchObject({
      status: "fixed",
      resolution: "Patched in dashboard.",
      updated_by_email: ADMIN_EMAIL,
      updated_by_source: "dashboard",
    });
    expect(db.auditEvents).toHaveLength(1);
    expect(db.auditEvents[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      actor_source: "dashboard",
      action: "status_update",
    });
    expect(auditStatus(db.auditEvents[0], "before")).toBe("open");
    expect(auditStatus(db.auditEvents[0], "after")).toBe("fixed");
  });

  it("writes one status audit event per report on dashboard bulk status update", async () => {
    const env = await makeEnv([
      baseReport({ id: "report-1" }),
      baseReport({ id: "report-2" }),
    ]);

    const response = await callDashboard(env, "POST", "/bulk", {
      ids: ["report-1", "report-2"],
      status: "in_progress",
    });

    const db = env.DB as unknown as FakeD1Database;
    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    expect(db.auditEvents).toHaveLength(2);
    expect(db.auditEvents.map((event) => event.action)).toEqual(["status_update", "status_update"]);
    expect(db.auditEvents.map((event) => event.actor_source)).toEqual(["dashboard", "dashboard"]);
    expect(db.auditEvents.map((event) => auditStatus(event, "after"))).toEqual(["in_progress", "in_progress"]);
  });

  it("writes a delete audit event with actor metadata", async () => {
    const env = await makeEnv([baseReport()]);

    const response = await callDashboard(env, "DELETE", "/report-1");

    const db = env.DB as unknown as FakeD1Database;
    expect(response.status).toBe(200);
    expect(db.reports.get("report-1")?.deleted_at).toBe(NOW);
    expect(db.auditEvents).toHaveLength(1);
    expect(db.auditEvents[0]).toMatchObject({
      actor_email: ADMIN_EMAIL,
      actor_source: "dashboard",
      action: "delete",
    });
  });
});

describe("report audit schema", () => {
  it("keeps audit events and fixed report tracking columns in schema", () => {
    const schema = readFileSync(fileURLToPath(new URL("../../schema.sql", import.meta.url).href), "utf8");
    const migration = readFileSync(fileURLToPath(new URL("../../migrations/0003_add_report_attribution_audit.sql", import.meta.url).href), "utf8");
    const fixCommitMigration = readFileSync(fileURLToPath(new URL("../../migrations/0004_add_fix_commit_tracking.sql", import.meta.url).href), "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS report_audit_events");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS report_audit_events");
    expect(schema).toContain("fixed_by_email TEXT");
    expect(schema).toContain("fixed_at TEXT");
    expect(schema).toContain("fix_commit_sha TEXT");
    expect(schema).toContain("fix_commit_url TEXT");
    expect(fixCommitMigration).toContain("ADD COLUMN fixed_by_email TEXT");
    expect(fixCommitMigration).toContain("ADD COLUMN fix_commit_sha TEXT");
    expect(fixCommitMigration).toContain("ADD COLUMN fix_commit_url TEXT");
    expect(schema).not.toContain("reports_fixed_requires");
    expect(migration).not.toContain("fixed_by_email");
    expect(migration).not.toContain("reports_fixed_requires");
  });
});
