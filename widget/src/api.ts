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
      pageUrl: window.location.href,
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

  const res = await fetch(`${apiBase}/api/reports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`submit failed (${res.status}) ${detail}`.trim());
  }
  return res.json();
}
