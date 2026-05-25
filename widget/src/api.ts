import type { CapturedTarget } from "./picker.js";
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

export interface SubmitInput {
  apiBase: string;
  token: string;
  project: string;
  note: string;
  severity: string;
  captured: CapturedTarget;
}

export async function submitReport(input: SubmitInput): Promise<{ id: string }> {
  const { apiBase, token, project, note, severity, captured } = input;
  const form = new FormData();
  form.append("project", project);
  form.append("screenshot", captured.screenshot);
  form.append(
    "meta",
    JSON.stringify({
      note,
      severity,
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
      elementSelector: captured.selector,
      elementText: captured.text,
      elementRect: captured.rect,
      consoleLogs: getConsoleEntries(),
      networkLogs: getNetworkEntries(),
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
