const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

export interface AccessInfo {
  isTester: boolean;
  isAdmin: boolean;
  email: string;
  name: string | null;
}

export interface ReportRow {
  id: string;
  project: string;
  reporter_email: string;
  reporter_name: string | null;
  title: string;
  note: string | null;
  severity: string | null;
  status: string;
  page_url: string | null;
  element_selector: string | null;
  console_count: number;
  network_count: number;
  screenshot_key: string | null;
  updated_by_email: string | null;
  updated_by_source: string | null;
  fixed_at: string | null;
  fixed_by_email: string | null;
  fix_commit_sha: string | null;
  fix_commit_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportDetail extends ReportRow {
  user_agent: string | null;
  element_text: string | null;
  element_rect: string | null;
  elements: string | null;          // json array of {selector,text,rect}
  screenshot_keys: string | null;   // json array of R2 keys
  resolution: string | null;
  latest_fixed_event: ReportAuditEvent | null;
}

export interface ReportElement {
  selector: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number } | null;
}

export interface ReportAuditEvent {
  id: string;
  report_id: string;
  actor_email: string;
  actor_source: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

// Parse the elements JSON, falling back to the legacy single-element fields.
export function parseReportElements(detail: ReportDetail): ReportElement[] {
  if (detail.elements) {
    try {
      const parsed = JSON.parse(detail.elements);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e): e is ReportElement => Boolean(e) && typeof e === "object" && typeof e.selector === "string")
          .map((e) => ({ selector: e.selector, text: e.text ?? "", rect: e.rect ?? null }));
      }
    } catch {
      /* fall through */
    }
  }
  if (detail.element_selector) {
    let rect: ReportElement["rect"] = null;
    if (detail.element_rect) {
      try {
        rect = JSON.parse(detail.element_rect);
      } catch {
        rect = null;
      }
    }
    return [{ selector: detail.element_selector, text: detail.element_text ?? "", rect }];
  }
  return [];
}

// How many screenshots this report has (new multi key list or legacy single).
export function reportScreenshotCount(detail: ReportDetail): number {
  if (detail.screenshot_keys) {
    try {
      const parsed = JSON.parse(detail.screenshot_keys);
      if (Array.isArray(parsed)) {
        const n = parsed.filter((k) => typeof k === "string" && k.length > 0).length;
        if (n > 0) return n;
      }
    } catch {
      /* fall through */
    }
  }
  return detail.screenshot_key ? 1 : 0;
}

export interface TesterRow {
  id: string;
  email: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface McpTokenRow {
  id: string;
  name: string;
  last_four: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ScreenshotPreview {
  url: string;
  contentType: string;
  isImage: boolean;
}

export interface AnalyticsBreakdownItem {
  name: string;
  count: number;
}

export interface AnalyticsTrendPoint {
  date: string;
  count: number;
}

export interface ProjectAnalytics {
  project: string;
  total: number;
  open: number;
  active: number;
  done: number;
  withLogs: number;
  withScreenshots: number;
  lastReportAt: string | null;
  primaryDomain: string | null;
  byStatus: AnalyticsBreakdownItem[];
  bySeverity: AnalyticsBreakdownItem[];
  byReporter: AnalyticsBreakdownItem[];
  byDomain: AnalyticsBreakdownItem[];
}

export interface AnalyticsTotals {
  reports: number;
  projects: number;
  open: number;
  active: number;
  done: number;
  withLogs: number;
  withScreenshots: number;
  lastReportAt: string | null;
}

export interface ReportAnalytics {
  period: {
    days: number;
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  };
  totals: AnalyticsTotals;
  periodTotals: AnalyticsTotals;
  previousPeriodTotals: AnalyticsTotals;
  byStatus: AnalyticsBreakdownItem[];
  bySeverity: AnalyticsBreakdownItem[];
  byReporter: AnalyticsBreakdownItem[];
  byDomain: AnalyticsBreakdownItem[];
  recentTrend: AnalyticsTrendPoint[];
  projects: ProjectAnalytics[];
}

async function authFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body.trim();

    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
        message = [parsed.error, parsed.message]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .join(": ");
      } catch {
        message = body;
      }
    }

    throw new Error(`${res.status}${message ? ` ${message}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export async function getAccess(token: string): Promise<AccessInfo> {
  return json(await authFetch("/api/reports/access", token));
}

export async function listReports(token: string): Promise<ReportRow[]> {
  const limit = 500;
  const reports: ReportRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const data = await json<{ reports: ReportRow[]; total?: number; limit?: number; offset?: number }>(
      await authFetch(`/api/reports?${params.toString()}`, token),
    );
    reports.push(...data.reports);
    total = data.total ?? reports.length;
    const pageSize = data.limit ?? limit;
    if (data.reports.length === 0 || pageSize <= 0) break;
    offset += data.reports.length;
  }

  return reports;
}

export async function getReportAnalytics(token: string, days = 14): Promise<ReportAnalytics> {
  const params = new URLSearchParams({ days: String(days) });
  return json(await authFetch(`/api/reports/analytics?${params.toString()}`, token));
}

export async function getReport(token: string, id: string): Promise<ReportDetail> {
  const data = await json<{ report: ReportDetail }>(await authFetch(`/api/reports/${id}`, token));
  return data.report;
}

export async function getReportAuditLog(token: string, id: string): Promise<ReportAuditEvent[]> {
  const data = await json<{ events: ReportAuditEvent[] }>(await authFetch(`/api/reports/${id}/audit`, token));
  return data.events;
}

export async function getScreenshotPreview(token: string, id: string): Promise<ScreenshotPreview> {
  return fetchScreenshot(`/api/reports/${id}/screenshot`, token);
}

export async function getScreenshotPreviewAt(token: string, id: string, index: number): Promise<ScreenshotPreview> {
  return fetchScreenshot(`/api/reports/${id}/screenshot/${index}`, token);
}

async function fetchScreenshot(path: string, token: string): Promise<ScreenshotPreview> {
  const res = await authFetch(path, token);
  if (!res.ok) throw new Error("no screenshot");
  const blob = await res.blob();
  const contentType = blob.type || res.headers.get("Content-Type") || "";
  return {
    url: URL.createObjectURL(blob),
    contentType,
    isImage: contentType.startsWith("image/"),
  };
}

export async function getLogs<T = unknown>(token: string, id: string, type: "console" | "network"): Promise<T[]> {
  const res = await authFetch(`/api/reports/${id}/logs/${type}`, token);
  if (!res.ok) return [];
  return res.json() as Promise<T[]>;
}

export async function patchReport(
  token: string,
  id: string,
  body: {
    title?: string;
    note?: string;
    severity?: string | null;
    page_url?: string | null;
    status?: string;
    resolution?: string | null;
    fix_commit_sha?: string | null;
    fix_commit_url?: string | null;
  },
): Promise<void> {
  await json(await authFetch(`/api/reports/${id}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function bulkPatchReports(
  token: string,
  body: { ids: string[]; status?: string; delete?: boolean },
): Promise<number> {
  const data = await json<{ updated: number }>(await authFetch("/api/reports/bulk", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return data.updated;
}

export async function deleteReport(token: string, id: string): Promise<void> {
  await json(await authFetch(`/api/reports/${id}`, token, { method: "DELETE" }));
}

export async function listTesters(token: string): Promise<TesterRow[]> {
  const data = await json<{ testers: TesterRow[] }>(await authFetch("/api/allowlist", token));
  return data.testers;
}

export async function addTester(token: string, email: string, note: string): Promise<void> {
  await json(await authFetch("/api/allowlist", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, note: note || undefined }),
  }));
}

export async function removeTester(token: string, id: string): Promise<void> {
  await json(await authFetch(`/api/allowlist/${id}`, token, { method: "DELETE" }));
}

export function getMcpEndpoint(): string {
  if (/^https?:\/\//i.test(API_BASE)) return `${API_BASE}/api/mcp`;
  if (typeof window !== "undefined") return `${window.location.origin}${API_BASE}/api/mcp`;
  return `${API_BASE}/api/mcp`;
}

export async function listMcpTokens(token: string): Promise<McpTokenRow[]> {
  const data = await json<{ tokens: McpTokenRow[] }>(await authFetch("/api/mcp/tokens", token));
  return data.tokens;
}

export async function createMcpToken(token: string, name: string): Promise<{ token: McpTokenRow; secret: string }> {
  return json(await authFetch("/api/mcp/tokens", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }));
}

export async function revokeMcpToken(token: string, id: string): Promise<void> {
  await json(await authFetch(`/api/mcp/tokens/${id}`, token, { method: "DELETE" }));
}
