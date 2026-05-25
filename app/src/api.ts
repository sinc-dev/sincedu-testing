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
  created_at: string;
  updated_at: string;
}

export interface ReportDetail extends ReportRow {
  user_agent: string | null;
  element_text: string | null;
  element_rect: string | null;
  resolution: string | null;
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
  const data = await json<{ reports: ReportRow[] }>(await authFetch("/api/reports", token));
  return data.reports;
}

export async function getReport(token: string, id: string): Promise<ReportDetail> {
  const data = await json<{ report: ReportDetail }>(await authFetch(`/api/reports/${id}`, token));
  return data.report;
}

export async function getScreenshotPreview(token: string, id: string): Promise<ScreenshotPreview> {
  const res = await authFetch(`/api/reports/${id}/screenshot`, token);
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
