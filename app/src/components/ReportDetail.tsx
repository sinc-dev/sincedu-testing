import { useEffect, useRef, useState } from "react";
import {
  getLogs,
  getReport,
  getScreenshotPreview,
  patchReport,
  type ReportDetail as Detail,
  type ScreenshotPreview,
} from "../api";

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

export function ReportDetail({ id, isAdmin, getToken, onClose, onChanged }: Props) {
  const [report, setReport] = useState<Detail | null>(null);
  const [shotPreview, setShotPreview] = useState<ScreenshotPreview | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<unknown[]>([]);
  const [networkLogs, setNetworkLogs] = useState<unknown[]>([]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [status, setStatus] = useState("open");
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const displayTitle = normalizeText(report?.title);
  const displayNote = normalizeText(report?.note);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 210);
  };

  useEffect(() => {
    let revoke: string | null = null;
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        const detail = await getReport(token, id);
        setReport(detail);
        setTitle(normalizeText(detail.title).replace(/\n+/g, " ").trim().slice(0, TITLE_MAX));
        setNote(normalizeText(detail.note));
        setSeverity(detail.severity || "");
        setPageUrl(detail.page_url || "");
        setStatus(detail.status);
        setResolution(detail.resolution || "");
        if (detail.console_count > 0) setConsoleLogs(await getLogs(token, id, "console"));
        if (detail.network_count > 0) setNetworkLogs(await getLogs(token, id, "network"));
        if (detail.screenshot_key) {
          const preview = await getScreenshotPreview(token, id);
          revoke = preview.url;
          setShotPreview(preview);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load report");
      }
    })();
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (revoke) URL.revokeObjectURL(revoke);
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
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`overlay ${closing ? "closing" : ""}`} onClick={requestClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-scroll">
          <div className="drawer-header">
            <h2>{shortTitle(displayTitle)}</h2>
            <button className="icon-btn drawer-close" type="button" onClick={requestClose} aria-label="Close" title="Close">
              ×
            </button>
          </div>
          {error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}
          {!report ? (
            <p className="muted">Loading…</p>
          ) : (
            <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
              <div className="muted">
                {report.reporter_email} · {new Date(report.created_at).toLocaleString()} · project: {report.project}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge tester">tester</span>
                <span className={`badge ${report.status}`}>{report.status.replace("_", " ")}</span>
                {report.severity ? <span className="badge">severity: {report.severity}</span> : null}
              </div>

              <div>
                <strong>Title</strong>
                <p className="drawer-title-full">{displayTitle}</p>
              </div>

              {displayNote ? (
                <div>
                  <strong>Note</strong>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{displayNote}</p>
                </div>
              ) : null}

              {report.element_selector ? (
                <div>
                  <strong>Element</strong>
                  <p className="mono" style={{ marginTop: 4, wordBreak: "break-all" }}>{report.element_selector}</p>
                  {report.element_text ? <p className="muted">“{report.element_text}”</p> : null}
                </div>
              ) : null}

              {report.page_url ? (
                <div>
                  <strong>Page</strong>
                  <p style={{ marginTop: 4 }}>
                    <a href={report.page_url} target="_blank" rel="noreferrer">{report.page_url}</a>
                  </p>
                </div>
              ) : null}

              {shotPreview ? (
                <div>
                  <strong>Screenshot</strong>
                  <a href={shotPreview.url} target="_blank" rel="noreferrer">
                    {shotPreview.isImage ? (
                      <img className="shot" src={shotPreview.url} alt="screenshot" style={{ marginTop: 4 }} />
                    ) : (
                      <span className="thumb-placeholder" style={{ marginTop: 4 }}>Open screenshot file</span>
                    )}
                  </a>
                </div>
              ) : null}

              {consoleLogs.length > 0 ? (
                <details>
                  <summary><strong>Console logs ({consoleLogs.length})</strong></summary>
                  <pre className="logs">{consoleLogs.map((e) => JSON.stringify(e)).join("\n")}</pre>
                </details>
              ) : null}

              {networkLogs.length > 0 ? (
                <details>
                  <summary><strong>Failed requests ({networkLogs.length})</strong></summary>
                  <pre className="logs">{networkLogs.map((e) => JSON.stringify(e)).join("\n")}</pre>
                </details>
              ) : null}

              {isAdmin ? (
                <div className="card edit-report-card">
                  <strong>Edit report</strong>
                  <label className="field">
                    <span>Title</span>
                    <input
                      className="input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={TITLE_MAX}
                    />
                  </label>
                  <label className="field">
                    <span>Note</span>
                    <textarea
                      className="input"
                      rows={5}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>URL</span>
                    <input
                      className="input"
                      value={pageUrl}
                      onChange={(e) => setPageUrl(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Severity</span>
                    <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                      <option value="">None</option>
                      {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </label>
                  <label className="field">
                    <span>Resolution</span>
                    <textarea
                      className="input"
                      rows={4}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                  </label>
                </div>
              ) : report.resolution ? (
                <div>
                  <strong>Resolution</strong>
                  <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{report.resolution}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
        {report && isAdmin ? (
          <div className="drawer-savebar">
            <button className="btn drawer-save" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
