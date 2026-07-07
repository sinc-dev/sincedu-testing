import { RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { reportHighlightView, reportReporterStack } from "../../../widget/src/reportHighlights";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

function widgetScriptUrl(): string {
  if (API_BASE) return `${API_BASE}/widget.js`;
  if (typeof window === "undefined") return "/widget.js";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:8788/widget.js";
  }
  return `${window.location.origin}/widget.js`;
}

function withCacheBust(url: string, key: number): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${key}`;
}

const sampleReports = [
  {
    status: "open",
    title: "Weekly report total is stale",
    note: "The summary card does not update after a new attendance entry is saved.",
    reporter_email: "local@localhost",
    created_at: "2026-07-03T12:00:00Z",
  },
  {
    status: "in_progress",
    title: "Copy wraps into the launcher",
    note: "Long text overlaps the floating control on smaller preview widths.",
    reporter_email: "joseph@studyinnc.com",
    created_at: "2026-07-03T11:00:00Z",
  },
  {
    status: "resolved",
    title: "Missing empty state",
    note: "The report area should show a clear placeholder before weekly data is available.",
    reporter_email: "qa@studyinnc.com",
    created_at: "2026-07-02T10:00:00Z",
  },
];

const STATUSES = ["open", "investigating", "in_progress", "fixed", "resolved", "closed"];
const sampleScreenshots = ["Attendance summary", "New entry form", "Stale total"];

export function WidgetPreview() {
  const [frameKey, setFrameKey] = useState(0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [sampleShotIndex, setSampleShotIndex] = useState(0);
  const [sampleStatuses, setSampleStatuses] = useState(sampleReports.map((report) => report.status));
  const [sampleComments, setSampleComments] = useState([
    {
      author_email: "qa@studyinnc.com",
      body: "Confirmed after adding a new attendance row.",
      created_at: "2026-07-03T12:20:00Z",
    },
  ]);
  const [sampleCommentDraft, setSampleCommentDraft] = useState("");
  const [sampleBubbleOpen, setSampleBubbleOpen] = useState(false);
  const [samplePopoverOpen, setSamplePopoverOpen] = useState(false);
  const visibleSampleReports = sampleReports.map((report, index) => ({ ...report, status: sampleStatuses[index] }));
  const sampleView = reportHighlightView(visibleSampleReports, sampleIndex);
  const sampleReporterStack = reportReporterStack(visibleSampleReports);
  const theme = sampleView.theme;
  const sampleBubbleExpanded = sampleBubbleOpen || samplePopoverOpen;
  const frameUrl = useMemo(() => {
    const params = new URLSearchParams({
      script: withCacheBust(widgetScriptUrl(), frameKey),
      review: typeof window === "undefined" ? "" : window.location.origin,
      project: "widget-preview",
    });
    return `/widget-preview-host.html?${params.toString()}`;
  }, [frameKey]);

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-col items-stretch justify-between gap-3.5 min-[821px]:flex-row min-[821px]:items-end">
        <div>
          <h1 className="m-0 mb-1 text-2xl leading-[1.1]">Widget preview</h1>
          <p className="text-[13px] text-muted-foreground">This frame loads the real embeddable widget script, not a recreated mock.</p>
        </div>
        <div className="flex flex-wrap justify-start gap-2 min-[821px]:justify-end">
          <Button variant="outline" type="button" onClick={() => setFrameKey((value) => value + 1)}>
            <RefreshCw size={15} />
            Reload widget
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Highlight hover sample</CardTitle>
          <CardDescription>
            Static example of the reported-element highlight, bubble, and paginated hover details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative min-h-[320px] overflow-visible rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,var(--muted))] p-5 pt-12">
            <div className="max-w-[640px] rounded-lg border bg-card p-5 shadow-sm">
              <h3 className="m-0 text-lg font-bold">Weekly report</h3>
              <p className="mt-2 max-w-[560px] text-sm leading-6 text-muted-foreground">
                Hover or focus the highlighted area to inspect submitted bug reports for this element.
              </p>
              <div className="mt-5 h-20 rounded-lg border border-dashed" />
            </div>

            <div
              className="group pointer-events-none absolute left-5 top-12 h-[156px] w-[min(640px,calc(100%-40px))] rounded-lg border-2 outline-none"
              tabIndex={0}
              style={{ borderColor: theme.border, backgroundColor: "transparent", boxShadow: theme.ring }}
              onMouseEnter={() => setSampleBubbleOpen(true)}
              onMouseLeave={() => setSampleBubbleOpen(false)}
              onFocus={() => setSampleBubbleOpen(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setSampleBubbleOpen(false);
                  setSamplePopoverOpen(false);
                }
              }}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("button")) return;
                setSamplePopoverOpen((value) => !value);
              }}
            >
              <div
                className={[
                  "pointer-events-auto absolute bottom-[calc(100%+6px)] left-0 flex cursor-pointer items-center overflow-hidden rounded-full text-[11px] font-bold text-white transition-[width,height,padding,box-shadow] duration-200 ease-out",
                  sampleBubbleExpanded
                    ? "h-7 w-[min(280px,calc(100vw-48px))] justify-start gap-1.5 px-2.5 shadow-[0_0_0_2px_rgba(255,255,255,.9),0_8px_18px_rgba(17,24,39,.18)]"
                    : "h-6 w-6 justify-center px-1.5 shadow-[0_0_0_2px_rgba(255,255,255,.82),0_4px_12px_rgba(17,24,39,.14)]",
                ].join(" ")}
                style={{ backgroundColor: theme.bubble }}
                onMouseEnter={() => setSampleBubbleOpen(true)}
              >
                {sampleBubbleExpanded ? (
                  <>
                    <span className="flex shrink-0 -space-x-1" aria-label={sampleReporterStack.label}>
                      {sampleReporterStack.avatars.map((avatar) => (
                        <span
                          key={avatar.key}
                          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white/90 text-[8px] font-extrabold leading-none"
                          aria-label={avatar.label}
                          style={{ backgroundColor: avatar.background, color: avatar.color }}
                        >
                          {avatar.initials}
                        </span>
                      ))}
                      {sampleReporterStack.extraCount > 0 ? (
                        <span
                          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white/90 px-1 text-[8px] font-extrabold leading-none text-white"
                          aria-label={`${sampleReporterStack.extraCount} more reporters`}
                          style={{ backgroundColor: theme.chip }}
                        >
                          +{sampleReporterStack.extraCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{sampleView.bubbleText}</span>
                    <span className="shrink-0 rounded-full px-2 py-0.5 font-bold" style={{ backgroundColor: theme.chip }}>{sampleView.moreLabel}</span>
                  </>
                ) : (
                  <span className="min-w-4 text-center font-extrabold">{sampleView.countLabel}</span>
                )}
              </div>

              <div
                className={`pointer-events-auto absolute bottom-[calc(100%+40px)] left-0 z-50 max-h-[calc(100vh-7rem)] w-[min(340px,calc(100vw-32px))] overflow-y-auto rounded-lg border bg-background p-3 text-left shadow-xl ${samplePopoverOpen ? "block" : "hidden"}`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-muted-foreground">
                  <select
                    className="h-7 max-w-36 cursor-pointer rounded-full border bg-background px-2 text-[11px] font-bold"
                    value={sampleStatuses[sampleIndex]}
                    aria-label="Change sample stage"
                    onChange={(event) => {
                      const next = event.target.value;
                      setSampleStatuses((current) => current.map((value, index) => index === sampleIndex ? next : value));
                    }}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>{status.replace("_", " ")}</option>
                    ))}
                  </select>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span>{sampleView.popoverCount}</span>
                    <Button
                      className="h-6 w-6 rounded-full p-0"
                      variant="outline"
                      size="icon"
                      type="button"
                      aria-label="Close report popover"
                      onClick={() => {
                        setSamplePopoverOpen(false);
                        setSampleBubbleOpen(false);
                      }}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                </div>
                <div className="mt-1 truncate text-[11px] font-semibold text-muted-foreground">{sampleView.popoverReporter}</div>
                <div className="mt-2 text-sm font-bold leading-tight">{sampleView.popoverTitle}</div>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{sampleView.popoverNote}</p>
                <div className="mt-3 overflow-hidden rounded-lg border bg-muted/30">
                  <div className="flex h-24 items-center justify-center bg-[linear-gradient(135deg,rgba(217,119,6,.16),rgba(37,99,235,.10))] text-xs font-bold text-muted-foreground">
                    {sampleScreenshots[sampleShotIndex]}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t bg-background px-2 py-1.5">
                    <span className="text-[11px] font-bold text-muted-foreground">{sampleShotIndex + 1} / {sampleScreenshots.length}</span>
                    <div className="flex gap-1.5">
                      <Button
                        className="h-6 rounded-full px-2 text-[11px]"
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={sampleShotIndex === 0}
                        onClick={() => setSampleShotIndex((value) => Math.max(0, value - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        className="h-6 rounded-full px-2 text-[11px]"
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={sampleShotIndex === sampleScreenshots.length - 1}
                        onClick={() => setSampleShotIndex((value) => Math.min(sampleScreenshots.length - 1, value + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 border-t pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-extrabold">Comments</div>
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-extrabold text-muted-foreground">
                      {sampleComments.length}
                    </span>
                  </div>
                  <div className="mt-2 grid max-h-24 gap-1.5 overflow-auto pr-0.5">
                    {sampleComments.map((comment, index) => (
                      <div key={`${comment.author_email}-${index}`} className="rounded-lg border bg-background p-2">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-muted-foreground">
                          <span className="truncate">{comment.author_email}</span>
                          <span className="shrink-0 text-muted-foreground/70">
                            {new Date(comment.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-xs font-medium leading-5">{comment.body}</div>
                      </div>
                    ))}
                  </div>
                  <form
                    className="mt-2 grid gap-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const body = sampleCommentDraft.trim();
                      if (!body) return;
                      setSampleComments((current) => [
                        { author_email: "joseph@studyinnc.com", body, created_at: new Date().toISOString() },
                        ...current,
                      ]);
                      setSampleCommentDraft("");
                    }}
                  >
                    <textarea
                      className="min-h-14 w-full resize-y rounded-lg border bg-background px-3 py-2 text-xs font-medium outline-none"
                      placeholder="Add comment"
                      rows={2}
                      value={sampleCommentDraft}
                      onChange={(event) => setSampleCommentDraft(event.target.value)}
                    />
                    <Button
                      className="h-8 justify-self-end rounded-full px-3 text-xs"
                      type="submit"
                      disabled={!sampleCommentDraft.trim()}
                    >
                      Add comment
                    </Button>
                  </form>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">{sampleView.popoverDate}</span>
                  <div className="flex gap-1.5">
                    <Button
                      className="h-6 rounded-full px-2 text-[11px]"
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={sampleIndex === 0}
                      onClick={() => setSampleIndex((value) => Math.max(0, value - 1))}
                    >
                      Prev
                    </Button>
                    <Button
                      className="h-6 rounded-full px-2 text-[11px]"
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={sampleIndex === sampleReports.length - 1}
                      onClick={() => setSampleIndex((value) => Math.min(sampleReports.length - 1, value + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Live script preview</CardTitle>
          <CardDescription>
            Use the floating control in the frame. The launcher, orbit menu, picker, and report input are rendered by <code>widget.js</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <iframe
            key={frameKey}
            className="block w-full min-h-[560px] rounded-lg border bg-card min-[821px]:min-h-[680px]"
            title="Live testing widget script preview"
            src={frameUrl}
          />
        </CardContent>
      </Card>
    </div>
  );
}
