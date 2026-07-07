import { getConsoleEntries, getNetworkEntries } from "./diagnostics.js";

export interface AccessInfo {
  isTester: boolean;
  isAdmin: boolean;
  email: string;
  name: string | null;
}

export async function fetchAccess(apiBase: string, token: string): Promise<AccessInfo> {
  const res = await fetch(`${apiBase}/api/reports/access`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`access check failed (${res.status})`);
  return res.json();
}

export interface ReportSummary {
  id: string;
  project: string | null;
  reporter_email: string | null;
  title: string;
  note?: string | null;
  status: string;
  page_url: string | null;
  element_selector: string | null;
  screenshot_key?: string | null;
  screenshot_keys?: string | null;
  created_at: string;
}

export interface ReportComment {
  id: string;
  report_id: string;
  author_email: string;
  body: string;
  created_at: string;
}

export interface ListReportsOptions {
  project?: string;
  pageUrl?: string;
  limit?: number;
  offset?: number;
}

export async function listReports(
  apiBase: string,
  token: string,
  options: ListReportsOptions = {},
): Promise<ReportSummary[]> {
  const params = new URLSearchParams();
  if (options.project) params.set("project", options.project);
  if (options.pageUrl) params.set("pageUrl", options.pageUrl);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  const res = await fetch(`${apiBase}/api/reports${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`reports load failed (${res.status})`);
  const data = await res.json() as { reports?: ReportSummary[] };
  return Array.isArray(data.reports) ? data.reports : [];
}

export function reportScreenshotCount(report: Pick<ReportSummary, "screenshot_key" | "screenshot_keys">): number {
  if (report.screenshot_keys) {
    try {
      const parsed = JSON.parse(report.screenshot_keys);
      if (Array.isArray(parsed)) {
        const count = parsed.filter((key) => typeof key === "string" && key.length > 0).length;
        if (count > 0) return count;
      }
    } catch {
      /* fall through */
    }
  }
  return report.screenshot_key ? 1 : 0;
}

export async function fetchReportScreenshot(apiBase: string, token: string, id: string, index: number): Promise<Blob> {
  const res = await fetch(`${apiBase}/api/reports/${encodeURIComponent(id)}/screenshot/${index}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`screenshot load failed (${res.status})`);
  return res.blob();
}

export async function listReportComments(apiBase: string, token: string, id: string): Promise<ReportComment[]> {
  const res = await fetch(`${apiBase}/api/reports/${encodeURIComponent(id)}/comments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`comments load failed (${res.status})`);
  const data = await res.json() as { comments?: ReportComment[] };
  return Array.isArray(data.comments) ? data.comments : [];
}

export async function addReportComment(apiBase: string, token: string, id: string, body: string): Promise<ReportComment> {
  const res = await fetch(`${apiBase}/api/reports/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`comment save failed (${res.status})`);
  const data = await res.json() as { comment?: ReportComment };
  if (!data.comment) throw new Error("comment save failed");
  return data.comment;
}

export async function updateReportStatus(apiBase: string, token: string, id: string, status: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/reports/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`stage update failed (${res.status})`);
}

function currentReportPageUrl(): string {
  try {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith("/widget-preview-host.html")) {
      url.searchParams.delete("script");
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return window.location.href;
  }
}

export interface ReportElement {
  selector: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface SubmitInput {
  apiBase: string;
  token: string;
  project: string;
  note: string;
  severity: string;
  // [send-time overview, ...any manually attached viewport shots]
  screenshots: File[];
  elements: ReportElement[];
  screenshotError?: string;
}

export async function submitReport(input: SubmitInput): Promise<{ id: string }> {
  const { apiBase, token, project, note, severity, screenshots, elements, screenshotError } = input;
  const form = new FormData();
  form.append("project", project);
  for (const shot of screenshots) form.append("screenshots", shot);

  const primary = elements[0];
  form.append(
    "meta",
    JSON.stringify({
      note,
      severity,
      pageUrl: currentReportPageUrl(),
      userAgent: navigator.userAgent,
      // Legacy single-element fields mirror the primary pick for back-compat.
      elementSelector: primary?.selector,
      elementText: primary?.text,
      elementRect: primary?.rect,
      elements,
      consoleLogs: getConsoleEntries(),
      networkLogs: getNetworkEntries(),
      screenshotError: screenshotError || undefined,
      screenshotCount: screenshots.length,
    }),
  );

  // Local dev passes an empty token — submit without a bearer (the worker
  // authorizes by localhost origin instead).
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/api/reports`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`submit failed (${res.status}) ${detail}`.trim());
  }
  return res.json();
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read screenshot"));
    reader.onload = () => {
      const result = String(reader.result || "");
      // Strip the data URL prefix ("data:image/jpeg;base64,") — keep raw base64.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Local-dev submission: POST the report to a host-provided sink URL (e.g. a Vite
 * dev-server endpoint) as JSON with inline base64 screenshots, so it can be
 * written straight to the local codebase. Never touches the worker or R2.
 */
export async function submitReportLocal(
  endpoint: string,
  input: Omit<SubmitInput, "apiBase" | "token">,
): Promise<{ id: string }> {
  const { project, note, severity, screenshots, elements, screenshotError } = input;
  const shots = await Promise.all(
    screenshots.map(async (file) => ({
      type: file.type || "image/jpeg",
      base64: await fileToBase64(file),
    })),
  );
  const primary = elements[0];
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project,
      note,
      severity,
      pageUrl: currentReportPageUrl(),
      userAgent: navigator.userAgent,
      elementSelector: primary?.selector,
      elementText: primary?.text,
      elementRect: primary?.rect,
      elements,
      consoleLogs: getConsoleEntries(),
      networkLogs: getNetworkEntries(),
      screenshotError: screenshotError || undefined,
      screenshots: shots,
      createdAt: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`local save failed (${res.status}) ${detail}`.trim());
  }
  return res.json().catch(() => ({ id: "local" }));
}
