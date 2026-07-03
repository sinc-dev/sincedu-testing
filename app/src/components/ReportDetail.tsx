import { useEffect, useState } from "react";
import { cn } from "src/lib/utils";
import { STATUS_PILL_STYLES } from "src/lib/status";
import {
  getLogs,
  getReport,
  getReportAuditLog,
  getScreenshotPreviewAt,
  parseReportElements,
  patchReport,
  reportScreenshotCount,
  type ReportDetail as Detail,
  type ReportAuditEvent,
  type ReportElement,
  type ScreenshotPreview,
} from "../api";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Textarea } from "./ui/textarea";

const STATUSES = ["open", "investigating", "in_progress", "fixed", "resolved", "closed"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const TITLE_MAX = 120;

interface Props {
  id: string;
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onChanged: () => void;
}

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function shortTitle(value: string): string {
  const firstLine = value.split("\n").map((line) => line.trim()).find(Boolean) || "Report";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
}

function formatActor(source: string | null | undefined, email: string | null | undefined): string {
  if (!email) return "";
  return source ? `${email} via ${source}` : email;
}

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "";
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ");
}

function auditSummary(event: ReportAuditEvent): string {
  try {
    const before = event.before_json ? JSON.parse(event.before_json) as Record<string, unknown> : null;
    const after = event.after_json ? JSON.parse(event.after_json) as Record<string, unknown> : null;
    if (before?.status !== after?.status && typeof after?.status === "string") {
      return `Status: ${String(before?.status || "unknown").replace("_", " ")} -> ${after.status.replace("_", " ")}`;
    }
    if (after?.deleted_at) return "Report deleted";
  } catch {
    /* fall through */
  }
  return formatAction(event.action);
}

function isFixedTransition(event: ReportAuditEvent | null | undefined): event is ReportAuditEvent {
  if (!event?.after_json) return false;
  try {
    const after = JSON.parse(event.after_json) as Record<string, unknown>;
    return after.status === "fixed";
  } catch {
    return false;
  }
}

export function ReportDetail({ id, isAdmin, getToken, onClose, onChanged }: Props) {
  const [report, setReport] = useState<Detail | null>(null);
  const [elements, setElements] = useState<ReportElement[]>([]);
  const [shots, setShots] = useState<ScreenshotPreview[]>([]);
  const [auditEvents, setAuditEvents] = useState<ReportAuditEvent[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<unknown[]>([]);
  const [networkLogs, setNetworkLogs] = useState<unknown[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [status, setStatus] = useState("open");
  const [resolution, setResolution] = useState("");
  const [fixCommitSha, setFixCommitSha] = useState("");
  const [fixCommitUrl, setFixCommitUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const displayTitle = normalizeText(report?.title);
  const displayNote = normalizeText(report?.note);
  const latestFixedEvent = auditEvents.find(isFixedTransition) ?? report?.latest_fixed_event ?? null;

  useEffect(() => {
    let revokeUrls: string[] = [];
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const detail = await getReport(token, id);
        setReport(detail);
        setElements(parseReportElements(detail));
        setTitle(normalizeText(detail.title).replace(/\n+/g, " ").trim().slice(0, TITLE_MAX));
        setNote(normalizeText(detail.note));
        setSeverity(detail.severity || "");
        setPageUrl(detail.page_url || "");
        setStatus(detail.status);
        setResolution(detail.resolution || "");
        setFixCommitSha(detail.fix_commit_sha || "");
        setFixCommitUrl(detail.fix_commit_url || "");
        setAuditEvents(await getReportAuditLog(token, id).catch(() => []));
        if (detail.console_count > 0) setConsoleLogs(await getLogs(token, id, "console"));
        if (detail.network_count > 0) setNetworkLogs(await getLogs(token, id, "network"));
        const count = reportScreenshotCount(detail);
        const previews: ScreenshotPreview[] = [];
        for (let i = 0; i < count; i += 1) {
          try {
            const preview = await getScreenshotPreviewAt(token, id, i);
            previews.push(preview);
            revokeUrls.push(preview.url);
          } catch {
            /* skip missing screenshot */
          }
        }
        setShots(previews);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report");
      }
    })();
    return () => {
      for (const url of revokeUrls) URL.revokeObjectURL(url);
    };
  }, [id, getToken]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      await patchReport(token, id, {
        title: title.trim(),
        note: note.trim(),
        severity: severity || null,
        page_url: pageUrl.trim() || null,
        status,
        resolution: resolution.trim() || null,
        fix_commit_sha: fixCommitSha.trim() || null,
        fix_commit_url: fixCommitUrl.trim() || null,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <SheetContent className="flex w-full min-w-0 flex-col overflow-hidden p-0 sm:max-w-[720px]">
        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          <SheetHeader className="mb-4 border-b pb-4 text-left">
            <SheetTitle>{shortTitle(displayTitle)}</SheetTitle>
          </SheetHeader>
          {error ? <Alert variant="destructive" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {!report ? (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          ) : (
            <div className="mt-3 grid max-w-full min-w-0 gap-4 [overflow-wrap:anywhere] [&>*]:min-w-0">
              <div className="text-[13px] text-muted-foreground">
                {report.reporter_email} · {new Date(report.created_at).toLocaleString()} · project: {report.project}
              </div>

              {(report.updated_by_email || latestFixedEvent) ? (
                <div className="text-[13px] text-muted-foreground">
                  {report.updated_by_email ? (
                    <span>
                      Updated by {formatActor(report.updated_by_source, report.updated_by_email)}
                      {" · "}
                      {new Date(report.updated_at).toLocaleString()}
                    </span>
                  ) : null}
                  {report.updated_by_email && latestFixedEvent ? <span> · </span> : null}
                  {latestFixedEvent ? (
                    <span>
                      Latest fixed transition by {formatActor(latestFixedEvent.actor_source, latestFixedEvent.actor_email)}
                      {" · "}
                      {new Date(latestFixedEvent.created_at).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Badge className="rounded-full border border-accent-foreground/30 bg-accent capitalize text-accent-foreground">tester</Badge>
                <Badge variant="outline" className={cn("rounded-full capitalize", STATUS_PILL_STYLES[report.status])}>{report.status.replace("_", " ")}</Badge>
                {report.severity ? <Badge variant="outline" className="rounded-full capitalize">severity: {report.severity}</Badge> : null}
                {report.fix_commit_sha ? (
                  <Badge variant="outline" className="rounded-full capitalize">
                    fix: {shortSha(report.fix_commit_sha)}
                  </Badge>
                ) : report.status === "fixed" ? (
                  <Badge variant="outline" className="rounded-full capitalize">fix commit missing</Badge>
                ) : null}
              </div>

              {(report.fixed_at || report.fix_commit_sha) ? (
                <div>
                  <strong>Fix tracking</strong>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {report.fixed_at ? `Fixed ${new Date(report.fixed_at).toLocaleString()}` : "Marked fixed"}
                    {report.fixed_by_email ? ` by ${report.fixed_by_email}` : ""}
                    {report.fix_commit_sha ? " · " : ""}
                    {report.fix_commit_sha ? (
                      report.fix_commit_url ? (
                        <a href={report.fix_commit_url} target="_blank" rel="noreferrer">
                          {shortSha(report.fix_commit_sha)}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{report.fix_commit_sha}</span>
                      )
                    ) : null}
                  </p>
                </div>
              ) : null}

              <div>
                <strong>Title</strong>
                <p className="mt-1 whitespace-pre-wrap leading-[1.4] [overflow-wrap:anywhere]">{displayTitle}</p>
              </div>

              {displayNote ? (
                <div>
                  <strong>Note</strong>
                  <p className="mt-1 whitespace-pre-wrap">{displayNote}</p>
                </div>
              ) : null}

              {elements.length > 0 ? (
                <div>
                  <strong>{elements.length > 1 ? `Elements (${elements.length})` : "Element"}</strong>
                  <div className="mt-1 grid gap-2">
                    {elements.map((el, i) => (
                      <div key={`${el.selector}-${i}`}>
                        <p className="break-all font-mono text-xs">{el.selector}</p>
                        {el.text ? <p className="text-[13px] text-muted-foreground">“{el.text}”</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {report.page_url ? (
                <div>
                  <strong>Page</strong>
                  <p className="mt-1">
                    <a href={report.page_url} target="_blank" rel="noreferrer">{report.page_url}</a>
                  </p>
                </div>
              ) : null}

              {shots.length > 0 ? (
                <div>
                  <strong>{shots.length > 1 ? `Screenshots (${shots.length})` : "Screenshot"}</strong>
                  <div className="mt-1 grid gap-2">
                    {shots.map((shot, i) => (
                      <a key={i} href={shot.url} target="_blank" rel="noreferrer">
                        {shot.isImage ? (
                          <img className="w-full rounded-md border" src={shot.url} alt={`screenshot ${i + 1}`} />
                        ) : (
                          <span className="inline-flex items-center justify-center rounded-md border border-dashed bg-muted/45 px-3 py-2 text-[11px] font-medium text-muted-foreground">Open screenshot file</span>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {consoleLogs.length > 0 ? (
                <details>
                  <summary><strong>Console logs ({consoleLogs.length})</strong></summary>
                  <pre className="max-h-[240px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-[oklch(0.26_0.028_150.77)] p-3 font-mono text-xs text-[oklch(0.94_0.01_72.66)] [overflow-wrap:anywhere]">{consoleLogs.map((e) => JSON.stringify(e)).join("\n")}</pre>
                </details>
              ) : null}

              {networkLogs.length > 0 ? (
                <details>
                  <summary><strong>Failed requests ({networkLogs.length})</strong></summary>
                  <pre className="max-h-[240px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-[oklch(0.26_0.028_150.77)] p-3 font-mono text-xs text-[oklch(0.94_0.01_72.66)] [overflow-wrap:anywhere]">{networkLogs.map((e) => JSON.stringify(e)).join("\n")}</pre>
                </details>
              ) : null}

              {auditEvents.length > 0 ? (
                <details open={isAdmin}>
                  <summary><strong>Audit log ({auditEvents.length})</strong></summary>
                  <div className="mt-2 grid gap-2">
                    {auditEvents.map((event) => (
                      <div key={event.id} className="text-[13px] text-muted-foreground">
                        <strong>{auditSummary(event)}</strong>
                        <br />
                        {formatActor(event.actor_source, event.actor_email)} · {new Date(event.created_at).toLocaleString()}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {isAdmin ? (
                <Card className="grid max-w-full gap-2.5 overflow-hidden [&_*]:min-w-0">
                  <CardHeader><CardTitle className="text-sm">Edit report</CardTitle></CardHeader>
                  <CardContent className="grid gap-3">
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Title</Label>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={TITLE_MAX}
                    />
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Note</Label>
                    <Textarea
                      rows={5}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>URL</Label>
                    <Input
                      value={pageUrl}
                      onChange={(e) => setPageUrl(e.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Severity</Label>
                    <Select value={severity || "none"} onValueChange={(value) => setSeverity(value === "none" ? "" : value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Resolution</Label>
                    <Textarea
                      rows={4}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Fix commit SHA</Label>
                    <Input
                      value={fixCommitSha}
                      onChange={(e) => setFixCommitSha(e.target.value)}
                      placeholder="e.g. 1a2b3c4d"
                    />
                  </div>
                  <div className="grid min-w-0 gap-[5px]">
                    <Label>Fix commit URL</Label>
                    <Input
                      value={fixCommitUrl}
                      onChange={(e) => setFixCommitUrl(e.target.value)}
                      placeholder="https://github.com/org/repo/commit/..."
                    />
                  </div>
                  </CardContent>
                </Card>
              ) : report.resolution ? (
                <div>
                  <strong>Resolution</strong>
                  <p className="mt-1 whitespace-pre-wrap">{report.resolution}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
        {report && isAdmin ? (
          <div className="border-t bg-background p-4">
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
