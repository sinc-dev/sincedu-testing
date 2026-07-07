import { readConfig } from "./config.js";
import { installDiagnostics } from "./diagnostics.js";
import {
  startElementPicker,
  captureViewport,
  captureScreenshotWithHighlights,
  resolveUniqueTarget,
  type CapturedTarget,
  type PickerHandle,
} from "./picker.js";
import { cachedEmail, getToken, hostSupabaseToken, signOut } from "./auth.js";
import {
  addReportComment,
  fetchAccess,
  fetchReportScreenshot,
  listReports,
  listReportComments,
  reportScreenshotCount,
  submitReport,
  submitReportLocal,
  updateReportStatus,
  type ReportComment,
  type ReportElement,
  type ReportSummary,
} from "./api.js";
import { WidgetUI, type CaptureView, type CaptureCardController } from "./ui.js";
import {
  reportBubbleText,
  reportHighlightTheme,
  reportHighlightView,
  reportReporterStack,
} from "./reportHighlights.js";

declare global {
  interface Window {
    SincTester?: {
      startPicker: () => void;
    };
  }
}

const scriptEl = document.currentScript as HTMLScriptElement | null;

// Sentinel returned by authorize() on localhost so the picker proceeds without a
// real token. The worker accepts reports from localhost origins unauthenticated,
// and the send path omits the Authorization header for this mode (see enqueueSend).
const LOCAL_TOKEN = "local-dev";
const IGNORE_ATTR = "data-sincedu-tester-ignore";
const HIGHLIGHT_Z = 2147483629;
const HIGHLIGHT_POPOVER_Z = HIGHLIGHT_Z + 2;
const REPORT_STATUSES = ["open", "investigating", "in_progress", "fixed", "resolved", "closed"];

interface HighlightScreenshot {
  url: string;
  isImage: boolean;
}

interface HighlightDetailState {
  loaded: boolean;
  loading: boolean;
  screenshots: HighlightScreenshot[];
  screenshotIndex: number;
  comments: ReportComment[];
  commentDraft: string;
  savingComment: boolean;
  updatingStatus: boolean;
  error: string | null;
}

function isLocalhost(): boolean {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
}

function boot() {
  const config = readConfig(scriptEl);
  installDiagnostics();
  const ui = new WidgetUI();

  // ---- Session state ----
  let pickerHandle: PickerHandle | null = null;
  let captures: CapturedTarget[] = [];
  let card: CaptureCardController | null = null;
  let token: string | null = null;
  let authorizedEmail: string | null = null;
  // How the current session authorized: reuse the host's Supabase session, our
  // /auth popup, or unauthenticated local dev. Drives where the send path gets
  // its (refreshed) token.
  let authMode: "host" | "popup" | "local" | null = null;
  let pending = 0;
  let sentTimer: number | null = null;
  let reportHighlightsOn = false;
  let reportHighlightCount = 0;
  let reportHighlightRefreshFrame: number | null = null;
  // Object URLs for capture screenshots, so previews render and we can revoke.
  const shotUrls = new Map<CapturedTarget, string>();
  const reportHighlightOverlays: HTMLDivElement[] = [];
  const reportHighlightDisposers: Array<() => void> = [];
  const reportHighlightDetails = new Map<string, HighlightDetailState>();

  const urlFor = (cap: CapturedTarget): string | null => {
    if (!cap.screenshot) return null;
    let url = shotUrls.get(cap);
    if (!url) {
      url = URL.createObjectURL(cap.screenshot);
      shotUrls.set(cap, url);
    }
    return url;
  };

  const revokeUrl = (cap: CapturedTarget) => {
    const url = shotUrls.get(cap);
    if (url) URL.revokeObjectURL(url);
    shotUrls.delete(cap);
  };

  const captureViews = (): CaptureView[] =>
    captures.map((cap) => ({ selector: cap.selector, screenshotUrl: urlFor(cap) }));

  const refreshCard = () => card?.setCaptures(captureViews());

  const canonicalPageUrl = (value: string): string | null => {
    try {
      const url = new URL(value, window.location.href);
      if (url.pathname.endsWith("/widget-preview-host.html")) {
        url.searchParams.delete("script");
      }
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  };

  const clearReportHighlights = () => {
    for (const overlay of reportHighlightOverlays) overlay.remove();
    reportHighlightOverlays.splice(0);
    for (const dispose of reportHighlightDisposers) dispose();
    reportHighlightDisposers.splice(0);
    for (const detail of reportHighlightDetails.values()) {
      for (const shot of detail.screenshots) URL.revokeObjectURL(shot.url);
    }
    reportHighlightDetails.clear();
    if (reportHighlightRefreshFrame !== null) {
      window.cancelAnimationFrame(reportHighlightRefreshFrame);
      reportHighlightRefreshFrame = null;
    }
    window.removeEventListener("scroll", scheduleReportHighlightRefresh, true);
    window.removeEventListener("resize", scheduleReportHighlightRefresh);
  };

  const hideReportHighlights = () => {
    reportHighlightsOn = false;
    clearReportHighlights();
    reportHighlightCount = 0;
    ui.setHighlightControlState({ active: false });
  };

  const clipsContent = (value: string): boolean => (
    value === "auto" || value === "scroll" || value === "hidden" || value === "clip"
  );

  const intersectRects = (a: DOMRect, b: DOMRect): DOMRect | null => {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  };

  const visibleTargetRect = (target: Element): DOMRect | null => {
    let rect: DOMRect | null = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    rect = intersectRects(rect, new DOMRect(0, 0, window.innerWidth, window.innerHeight));
    if (!rect) return null;

    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      if (parent === document.body || parent === document.documentElement) continue;
      const style = window.getComputedStyle(parent);
      if (!clipsContent(style.overflow) && !clipsContent(style.overflowX) && !clipsContent(style.overflowY)) {
        continue;
      }
      rect = intersectRects(rect, parent.getBoundingClientRect());
      if (!rect) return null;
    }

    return rect;
  };

  const moveReportHighlightOverlays = () => {
    for (const overlay of reportHighlightOverlays) {
      const selector = overlay.dataset.selector;
      const target = selector ? resolveUniqueTarget(selector) : null;
      if (!(target instanceof Element)) {
        overlay.style.display = "none";
        continue;
      }
      const rect = visibleTargetRect(target);
      if (!rect) {
        overlay.style.display = "none";
        continue;
      }
      overlay.style.display = "block";
      overlay.style.left = `${Math.round(rect.left)}px`;
      overlay.style.top = `${Math.round(rect.top)}px`;
      overlay.style.width = `${Math.round(rect.width)}px`;
      overlay.style.height = `${Math.round(rect.height)}px`;

      const bubble = overlay.querySelector<HTMLElement>(".sincedu-report-highlight-bubble");
      if (bubble) {
        const placeBelow = rect.top < 44;
        bubble.style.bottom = placeBelow ? "auto" : "calc(100% + 6px)";
        bubble.style.top = placeBelow ? "calc(100% + 6px)" : "auto";
        const alignRight = rect.left > window.innerWidth - 280;
        bubble.style.left = alignRight ? "auto" : "0";
        bubble.style.right = alignRight ? "0" : "auto";
      }

      const popover = overlay.querySelector<HTMLElement>(".sincedu-report-highlight-popover");
      if (popover) {
        const margin = 8;
        const popoverWidth = Math.min(320, Math.max(220, window.innerWidth - margin * 2));
        const anchorRect = bubble?.getBoundingClientRect() || rect;
        popover.style.width = `${popoverWidth}px`;
        popover.style.left = `${Math.round(clamp(anchorRect.left, margin, window.innerWidth - popoverWidth - margin) - rect.left)}px`;
        popover.style.right = "auto";
        popover.style.bottom = "auto";

        const popoverHeight = popover.offsetHeight || 280;
        const belowTop = anchorRect.bottom + 8;
        const aboveTop = anchorRect.top - popoverHeight - 8;
        const preferredTop = belowTop + popoverHeight <= window.innerHeight - margin ? belowTop : aboveTop;
        const clampedTop = clamp(preferredTop, margin, Math.max(margin, window.innerHeight - popoverHeight - margin));
        popover.style.top = `${Math.round(clampedTop - rect.top)}px`;
      }
    }
  };

  function scheduleReportHighlightRefresh() {
    if (!reportHighlightsOn || reportHighlightRefreshFrame !== null) return;
    reportHighlightRefreshFrame = window.requestAnimationFrame(() => {
      reportHighlightRefreshFrame = null;
      moveReportHighlightOverlays();
    });
  }

  const currentUserReports = (reports: ReportSummary[]): ReportSummary[] => {
    const email = authorizedEmail || cachedEmail();
    if (!email) return reports;
    const normalized = email.trim().toLowerCase();
    const allowedEmails = new Set([normalized]);
    if (isLocalhost()) allowedEmails.add("local@localhost");
    return reports.filter((report) => allowedEmails.has((report.reporter_email || "").trim().toLowerCase()));
  };

  const currentPageReports = (reports: ReportSummary[]): ReportSummary[] => {
    const here = canonicalPageUrl(window.location.href);
    return reports.filter((report) => {
      if (!report.page_url || !report.element_selector) return false;
      return canonicalPageUrl(report.page_url) === here;
    });
  };

  const clamp = (value: number, min: number, max: number): number => (
    Math.max(min, Math.min(max, value))
  );

  const highlightDetailFor = (reportId: string): HighlightDetailState => {
    let detail = reportHighlightDetails.get(reportId);
    if (!detail) {
      detail = {
        loaded: false,
        loading: false,
        screenshots: [],
        screenshotIndex: 0,
        comments: [],
        commentDraft: "",
        savingComment: false,
        updatingStatus: false,
        error: null,
      };
      reportHighlightDetails.set(reportId, detail);
    }
    return detail;
  };

  const loadHighlightDetail = async (report: ReportSummary, render: () => void) => {
    const detail = highlightDetailFor(report.id);
    if (detail.loaded || detail.loading) return;
    detail.loading = true;
    detail.error = null;
    render();
    try {
      const fresh = await freshToken();
      if (!fresh) throw new Error("Sign-in required");
      const count = reportScreenshotCount(report);
      const [comments, screenshots] = await Promise.all([
        listReportComments(config.apiBase, fresh, report.id),
        Promise.all(Array.from({ length: count }, async (_, index) => {
          const blob = await fetchReportScreenshot(config.apiBase, fresh, report.id, index);
          return {
            url: URL.createObjectURL(blob),
            isImage: (blob.type || "").startsWith("image/"),
          };
        })),
      ]);
      detail.comments = comments;
      detail.screenshots = screenshots;
      detail.loaded = true;
    } catch (error) {
      detail.error = error instanceof Error ? error.message : "Failed to load report details";
    } finally {
      detail.loading = false;
      render();
    }
  };

  const renderReportPopoverPage = (
    root: HTMLElement,
    reports: ReportSummary[],
    index: number,
    setIndex: (next: number) => void,
    onClose: () => void,
  ) => {
    const report = reports[index];
    const view = reportHighlightView(reports, index);
    const detail = highlightDetailFor(report.id);
    const render = () => renderReportPopoverPage(root, reports, index, setIndex, onClose);
    root.replaceChildren();

    const meta = document.createElement("div");
    meta.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:10px",
      "color:#6b7280",
      "font:600 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");

    const status = document.createElement("select");
    status.disabled = detail.updatingStatus;
    status.setAttribute("aria-label", "Change report stage");
    status.style.cssText = [
      "height:26px",
      "max-width:142px",
      "border:1px solid #e5e7eb",
      "border-radius:999px",
      "background:#fff",
      "color:#374151",
      "font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "padding:0 8px",
      "cursor:pointer",
    ].join(";");
    for (const value of REPORT_STATUSES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.replace("_", " ");
      status.appendChild(option);
    }
    // Set value only after the options exist — assigning to select.value with no
    // matching option is silently ignored and leaves the first option selected.
    status.value = report.status || "open";
    status.addEventListener("change", async () => {
      const previous = report.status;
      const next = status.value;
      report.status = next;
      detail.updatingStatus = true;
      detail.error = null;
      render();
      try {
        const fresh = await freshToken();
        if (!fresh) throw new Error("Sign-in required");
        await updateReportStatus(config.apiBase, fresh, report.id, next);
      } catch (error) {
        report.status = previous;
        detail.error = error instanceof Error ? error.message : "Failed to update stage";
      } finally {
        detail.updatingStatus = false;
        render();
      }
    });
    const count = document.createElement("span");
    count.textContent = view.popoverCount;
    const metaActions = document.createElement("div");
    metaActions.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:6px",
      "flex:0 0 auto",
    ].join(";");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close report popover");
    closeButton.textContent = "×";
    closeButton.style.cssText = [
      "width:24px",
      "height:24px",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "border:1px solid #e5e7eb",
      "border-radius:999px",
      "background:#fff",
      "color:#4b5563",
      "font:800 16px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "cursor:pointer",
    ].join(";");
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    });

    metaActions.append(count, closeButton);
    meta.append(status, metaActions);

    const reporter = document.createElement("div");
    reporter.textContent = view.popoverReporter;
    reporter.style.cssText = [
      "margin-top:6px",
      "color:#6b7280",
      "font:600 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow:hidden",
      "text-overflow:ellipsis",
      "white-space:nowrap",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = view.popoverTitle;
    title.style.cssText = [
      "margin-top:7px",
      "color:#111827",
      "font:700 13px/1.25 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow-wrap:anywhere",
    ].join(";");

    const note = document.createElement("div");
    note.textContent = view.popoverNote;
    note.style.cssText = [
      "margin-top:5px",
      "color:#374151",
      "font:500 12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "display:-webkit-box",
      "-webkit-line-clamp:3",
      "-webkit-box-orient:vertical",
      "overflow:hidden",
    ].join(";");

    const screenshotWrap = document.createElement("div");
    screenshotWrap.style.cssText = [
      "margin-top:10px",
      "border:1px solid #e5e7eb",
      "border-radius:8px",
      "overflow:hidden",
      "background:#f9fafb",
    ].join(";");
    if (detail.loading && !detail.loaded) {
      screenshotWrap.textContent = "Loading screenshots...";
      screenshotWrap.style.padding = "14px";
      screenshotWrap.style.color = "#6b7280";
      screenshotWrap.style.font = "600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    } else if (detail.screenshots.length > 0) {
      const safeShotIndex = Math.max(0, Math.min(detail.screenshots.length - 1, detail.screenshotIndex));
      detail.screenshotIndex = safeShotIndex;
      const shot = detail.screenshots[safeShotIndex];
      const shotLink = document.createElement("a");
      shotLink.href = shot.url;
      shotLink.target = "_blank";
      shotLink.rel = "noreferrer";
      shotLink.style.cssText = "display:block";
      if (shot.isImage) {
        const img = document.createElement("img");
        img.src = shot.url;
        img.alt = `Screenshot ${safeShotIndex + 1}`;
        img.style.cssText = [
          "display:block",
          "width:100%",
          "height:120px",
          "object-fit:cover",
        ].join(";");
        shotLink.appendChild(img);
      } else {
        shotLink.textContent = "Open screenshot file";
        shotLink.style.cssText += ";padding:18px;text-align:center;color:#374151;font:700 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      }
      screenshotWrap.appendChild(shotLink);
      if (detail.screenshots.length > 1) {
        const shotControls = document.createElement("div");
        shotControls.style.cssText = [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "gap:8px",
          "padding:7px 8px",
          "border-top:1px solid #e5e7eb",
          "background:#fff",
        ].join(";");
        const shotCount = document.createElement("span");
        shotCount.textContent = `${safeShotIndex + 1} / ${detail.screenshots.length}`;
        shotCount.style.cssText = "color:#6b7280;font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        const shotButtons = document.createElement("div");
        shotButtons.style.cssText = "display:flex;gap:5px";
        for (const [label, delta] of [["Prev", -1], ["Next", 1]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.disabled = label === "Prev" ? safeShotIndex === 0 : safeShotIndex === detail.screenshots.length - 1;
          button.style.cssText = [
            "height:24px",
            "padding:0 8px",
            "border:1px solid #e5e7eb",
            "border-radius:999px",
            "background:#fff",
            "color:#374151",
            "font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
            "cursor:pointer",
            button.disabled ? "opacity:.45;cursor:default" : "",
          ].join(";");
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled) return;
            detail.screenshotIndex = safeShotIndex + delta;
            render();
          });
          shotButtons.appendChild(button);
        }
        shotControls.append(shotCount, shotButtons);
        screenshotWrap.appendChild(shotControls);
      }
    } else if (detail.loaded) {
      screenshotWrap.textContent = "No screenshots submitted";
      screenshotWrap.style.padding = "12px";
      screenshotWrap.style.color = "#6b7280";
      screenshotWrap.style.font = "600 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    }

    const comments = document.createElement("div");
    comments.style.cssText = [
      "margin-top:10px",
      "border-top:1px solid #e5e7eb",
      "padding-top:10px",
    ].join(";");
    const commentsHeader = document.createElement("div");
    commentsHeader.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
    ].join(";");
    const commentsTitle = document.createElement("div");
    commentsTitle.textContent = "Comments";
    commentsTitle.style.cssText = "color:#374151;font:800 12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const commentsCount = document.createElement("span");
    commentsCount.textContent = `${detail.comments.length}`;
    commentsCount.style.cssText = "min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#f3f4f6;color:#4b5563;font:800 10px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    commentsHeader.append(commentsTitle, commentsCount);

    const commentsList = document.createElement("div");
    commentsList.style.cssText = [
      "display:grid",
      "gap:7px",
      "margin-top:8px",
      "max-height:128px",
      "overflow:auto",
      "padding-right:2px",
    ].join(";");
    if (detail.comments.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = detail.loaded ? "No comments yet" : "Loading comments...";
      empty.style.cssText = [
        "border:1px dashed #d1d5db",
        "border-radius:8px",
        "padding:9px",
        "color:#6b7280",
        "background:#f9fafb",
        "font:600 11px/1.25 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      ].join(";");
      commentsList.appendChild(empty);
    } else {
      for (const comment of detail.comments) {
        const item = document.createElement("div");
        item.style.cssText = "border:1px solid #e5e7eb;border-radius:9px;padding:8px;background:#fff";
        const meta = document.createElement("div");
        meta.style.cssText = [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "gap:8px",
          "color:#6b7280",
          "font:700 10px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        ].join(";");
        const author = document.createElement("span");
        author.textContent = comment.author_email;
        author.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        const commentDate = document.createElement("span");
        commentDate.textContent = comment.created_at ? new Date(comment.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
        commentDate.style.cssText = "flex:0 0 auto;color:#9ca3af";
        meta.append(author, commentDate);
        const body = document.createElement("div");
        body.textContent = comment.body;
        body.style.cssText = "margin-top:5px;color:#111827;font:500 12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:pre-wrap;overflow-wrap:anywhere";
        item.append(meta, body);
        commentsList.appendChild(item);
      }
    }

    const commentForm = document.createElement("form");
    commentForm.style.cssText = "display:grid;gap:6px;margin-top:8px";
    const commentInput = document.createElement("textarea");
    commentInput.value = detail.commentDraft;
    commentInput.placeholder = "Add comment";
    commentInput.rows = 2;
    commentInput.style.cssText = [
      "width:100%",
      "min-height:54px",
      "resize:vertical",
      "border:1px solid #e5e7eb",
      "border-radius:9px",
      "padding:8px 9px",
      "color:#111827",
      "background:#fff",
      "font:500 12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "outline:none",
    ].join(";");
    const commentButton = document.createElement("button");
    commentButton.type = "submit";
    commentButton.textContent = detail.savingComment ? "Adding..." : "Add comment";
    commentButton.disabled = detail.savingComment || detail.commentDraft.trim().length === 0;
    commentButton.style.cssText = [
      "height:30px",
      "justify-self:end",
      "padding:0 12px",
      "border:1px solid #e5e7eb",
      "border-radius:999px",
      "background:#111827",
      "color:#fff",
      "font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      commentButton.disabled ? "opacity:.45;cursor:default" : "cursor:pointer",
    ].join(";");
    commentInput.addEventListener("input", () => {
      detail.commentDraft = commentInput.value;
      commentButton.disabled = detail.savingComment || detail.commentDraft.trim().length === 0;
      commentButton.style.opacity = commentButton.disabled ? ".45" : "1";
      commentButton.style.cursor = commentButton.disabled ? "default" : "pointer";
    });
    commentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = detail.commentDraft.trim();
      if (!body) return;
      detail.savingComment = true;
      detail.error = null;
      render();
      try {
        const fresh = await freshToken();
        if (!fresh) throw new Error("Sign-in required");
        const comment = await addReportComment(config.apiBase, fresh, report.id, body);
        detail.comments.unshift(comment);
        detail.commentDraft = "";
      } catch (error) {
        detail.error = error instanceof Error ? error.message : "Failed to add comment";
      } finally {
        detail.savingComment = false;
        render();
      }
    });
    commentForm.append(commentInput, commentButton);
    comments.append(commentsHeader, commentsList, commentForm);

    const errorEl = document.createElement("div");
    if (detail.error) {
      errorEl.textContent = detail.error;
      errorEl.style.cssText = "margin-top:8px;color:#b91c1c;font:700 11px/1.3 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-wrap:anywhere";
    }

    const footer = document.createElement("div");
    footer.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
      "margin-top:10px",
    ].join(";");

    const date = document.createElement("span");
    date.textContent = view.popoverDate;
    date.style.cssText = "color:#6b7280;font:500 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    footer.appendChild(date);

    if (reports.length > 1) {
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;gap:5px";
      for (const [label, delta] of [["Prev", -1], ["Next", 1]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = label === "Prev" ? index === 0 : index === reports.length - 1;
        button.style.cssText = [
          "height:24px",
          "padding:0 8px",
          "border:1px solid #e5e7eb",
          "border-radius:999px",
          "background:#fff",
          "color:#374151",
          "font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "cursor:pointer",
          button.disabled ? "opacity:.45;cursor:default" : "",
        ].join(";");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!button.disabled) setIndex(index + delta);
        });
        controls.appendChild(button);
      }
      footer.appendChild(controls);
    }

    root.append(meta, reporter, title, note);
    if (detail.loading || detail.loaded) root.appendChild(screenshotWrap);
    root.append(comments);
    if (detail.error) root.appendChild(errorEl);
    root.appendChild(footer);
    void loadHighlightDetail(report, render);
  };

  const showReportHighlights = (reports: ReportSummary[]) => {
    clearReportHighlights();
    const reportsBySelector = new Map<string, ReportSummary[]>();
    for (const report of reports) {
      const selector = report.element_selector;
      if (!selector) continue;
      const group = reportsBySelector.get(selector);
      if (group) group.push(report);
      else reportsBySelector.set(selector, [report]);
    }

    for (const [selector, selectorReports] of reportsBySelector) {
      const target = resolveUniqueTarget(selector);
      if (!target) continue;

      const theme = reportHighlightTheme(selectorReports);
      const reporterStack = reportReporterStack(selectorReports);
      const overlay = document.createElement("div");
      overlay.setAttribute(IGNORE_ATTR, "true");
      overlay.dataset.selector = selector;
      overlay.setAttribute("aria-label", selectorReports.map(reportBubbleText).join("; "));
      overlay.tabIndex = 0;
      overlay.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        `z-index:${HIGHLIGHT_Z}`,
        `border:2px solid ${theme.border}`,
        "background:transparent",
        `box-shadow:${theme.ring}`,
        "border-radius:4px",
      ].join(";");

      const bubble = document.createElement("div");
      bubble.className = "sincedu-report-highlight-bubble";
      bubble.style.cssText = [
        "position:absolute",
        "left:0",
        "bottom:calc(100% + 6px)",
        "display:flex",
        "pointer-events:auto",
        "align-items:center",
        "gap:5px",
        "max-width:min(280px,calc(100vw - 16px))",
        "box-sizing:border-box",
        "width:24px",
        "height:24px",
        "justify-content:center",
        "padding:0 7px",
        "border-radius:999px",
        `background:${theme.bubble}`,
        "color:#fff",
        "font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "box-shadow:0 0 0 2px rgba(255,255,255,.82),0 4px 12px rgba(17,24,39,.14)",
        "white-space:nowrap",
        "overflow:hidden",
        "cursor:pointer",
        "will-change:width,height,padding,box-shadow",
        "transition:width .24s cubic-bezier(.16,1,.3,1),height .24s cubic-bezier(.16,1,.3,1),padding .24s cubic-bezier(.16,1,.3,1),box-shadow .2s ease",
      ].join(";");

      const text = document.createElement("span");
      text.textContent = reportBubbleText(selectorReports[0]);
      text.style.cssText = [
        "flex:1 1 auto",
        "min-width:0",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "display:none",
      ].join(";");

      const avatarStack = document.createElement("span");
      avatarStack.setAttribute("aria-label", reporterStack.label);
      avatarStack.style.cssText = [
        "flex:0 0 auto",
        "display:none",
        "align-items:center",
        "margin-right:1px",
      ].join(";");
      reporterStack.avatars.forEach((avatar, avatarIndex) => {
        const avatarEl = document.createElement("span");
        avatarEl.textContent = avatar.initials;
        avatarEl.setAttribute("aria-label", avatar.label);
        avatarEl.style.cssText = [
          "display:inline-flex",
          "align-items:center",
          "justify-content:center",
          "width:18px",
          "height:18px",
          avatarIndex > 0 ? "margin-left:-5px" : "margin-left:0",
          "border:1.5px solid rgba(255,255,255,.9)",
          "border-radius:999px",
          `background:${avatar.background}`,
          `color:${avatar.color}`,
          "font:800 8px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "letter-spacing:0",
          "box-sizing:border-box",
        ].join(";");
        avatarStack.appendChild(avatarEl);
      });
      if (reporterStack.extraCount > 0) {
        const extra = document.createElement("span");
        extra.textContent = `+${reporterStack.extraCount}`;
        extra.setAttribute("aria-label", `${reporterStack.extraCount} more reporters`);
        extra.style.cssText = [
          "display:inline-flex",
          "align-items:center",
          "justify-content:center",
          "height:18px",
          "min-width:18px",
          "margin-left:-5px",
          "padding:0 4px",
          "border:1.5px solid rgba(255,255,255,.9)",
          "border-radius:999px",
          `background:${theme.chip}`,
          "color:#fff",
          "font:800 8px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "box-sizing:border-box",
        ].join(";");
        avatarStack.appendChild(extra);
      }
      if (reporterStack.avatars.length > 0) bubble.appendChild(avatarStack);

      bubble.appendChild(text);

      const moreCount = selectorReports.length - 1;
      const count = document.createElement("span");
      count.textContent = `${selectorReports.length}`;
      count.style.cssText = [
        "flex:0 0 auto",
        "min-width:16px",
        "text-align:center",
        "font-weight:800",
      ].join(";");
      bubble.appendChild(count);

      const more = document.createElement("span");
      more.textContent = moreCount > 0 ? `+${moreCount} more` : "";
      more.style.cssText = [
        "flex:0 0 auto",
        "overflow:hidden",
        "padding:2px 6px",
        "border-radius:999px",
        `background:${theme.chip}`,
        "font-weight:700",
        "display:none",
      ].join(";");
      if (moreCount > 0) bubble.appendChild(more);

      overlay.appendChild(bubble);

      const popover = document.createElement("div");
      popover.className = "sincedu-report-highlight-popover";
      popover.style.cssText = [
        "position:absolute",
        "left:0",
        "bottom:calc(100% + 38px)",
        "display:none",
        "pointer-events:auto",
        "width:min(320px,calc(100vw - 16px))",
        "box-sizing:border-box",
        "padding:10px",
        "border:1px solid #e5e7eb",
        "border-radius:10px",
        "background:#fff",
        "color:#111827",
        "box-shadow:0 14px 32px rgba(17,24,39,.24)",
        "text-align:left",
        "opacity:0",
        "transform:translateY(4px) scale(.98)",
        "transform-origin:bottom left",
        "transition:opacity .14s ease,transform .18s cubic-bezier(.16,1,.3,1)",
      ].join(";");
      let popoverIndex = 0;
      let closeReportPopover = () => {};
      const setPopoverIndex = (next: number) => {
        popoverIndex = Math.max(0, Math.min(selectorReports.length - 1, next));
        // Resolve closeReportPopover at click time — it is reassigned to the real
        // close handler below, after this first render runs.
        renderReportPopoverPage(popover, selectorReports, popoverIndex, setPopoverIndex, () => closeReportPopover());
      };
      setPopoverIndex(0);
      popover.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      overlay.appendChild(popover);

      let popoverOpen = false;
      const setBubbleExpanded = (expanded: boolean) => {
        if (reporterStack.avatars.length > 0) avatarStack.style.display = expanded ? "flex" : "none";
        text.style.display = expanded ? "block" : "none";
        count.style.display = expanded ? "none" : "block";
        if (moreCount > 0) more.style.display = expanded ? "block" : "none";
        const maxExpandedWidth = Math.max(24, Math.min(280, window.innerWidth - 16));
        const expandedWidth = Math.min(maxExpandedWidth, Math.ceil(bubble.scrollWidth));
        bubble.style.width = expanded ? `${expandedWidth}px` : "24px";
        bubble.style.height = expanded ? "28px" : "24px";
        bubble.style.padding = expanded ? "0 10px" : "0 7px";
        bubble.style.justifyContent = expanded ? "flex-start" : "center";
        bubble.style.boxShadow = expanded
          ? "0 0 0 2px rgba(255,255,255,.9),0 8px 18px rgba(17,24,39,.18)"
          : "0 0 0 2px rgba(255,255,255,.82),0 4px 12px rgba(17,24,39,.14)";
      };
      const setPopoverOpen = (open: boolean) => {
        popoverOpen = open;
        overlay.style.zIndex = String(open ? HIGHLIGHT_POPOVER_Z : HIGHLIGHT_Z);
        popover.style.display = open ? "block" : "none";
        moveReportHighlightOverlays();
        window.requestAnimationFrame(() => {
          moveReportHighlightOverlays();
          popover.style.opacity = open ? "1" : "0";
          popover.style.transform = open ? "translateY(0) scale(1)" : "translateY(4px) scale(.98)";
        });
        setBubbleExpanded(open || overlay.matches(":hover") || overlay.matches(":focus-within"));
      };
      closeReportPopover = () => setPopoverOpen(false);
      overlay.addEventListener("mouseenter", () => setBubbleExpanded(true));
      overlay.addEventListener("mouseleave", () => {
        if (!popoverOpen) setBubbleExpanded(false);
      });
      overlay.addEventListener("focusin", () => setBubbleExpanded(true));
      overlay.addEventListener("focusout", (event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && overlay.contains(nextTarget)) return;
        window.setTimeout(() => {
          const active = document.activeElement;
          if (active && overlay.contains(active)) return;
          if (popoverOpen && active === document.body) {
            setBubbleExpanded(true);
            return;
          }
          setPopoverOpen(false);
          setBubbleExpanded(false);
        }, 0);
      });
      overlay.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        event.stopPropagation();
        setPopoverOpen(!popoverOpen);
      });
      overlay.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setPopoverOpen(!popoverOpen);
      });

      document.body.appendChild(overlay);
      const onDocumentClick = (event: MouseEvent) => {
        if (!popoverOpen || overlay.contains(event.target as Node | null)) return;
        setPopoverOpen(false);
        if (!overlay.matches(":hover") && !overlay.matches(":focus-within")) setBubbleExpanded(false);
      };
      document.addEventListener("click", onDocumentClick);
      reportHighlightDisposers.push(() => document.removeEventListener("click", onDocumentClick));
      reportHighlightOverlays.push(overlay);
    }
    moveReportHighlightOverlays();
    window.addEventListener("scroll", scheduleReportHighlightRefresh, true);
    window.addEventListener("resize", scheduleReportHighlightRefresh);
    reportHighlightCount = reportHighlightOverlays.length;
    ui.setHighlightControlState({ active: true, count: reportHighlightCount });
    ui.showToast(
      reportHighlightCount === 1
        ? "Highlighted 1 reported element"
        : `Highlighted ${reportHighlightCount} reported elements`,
      true,
    );
  };

  // Tear down the whole session: picker, card, captures, object URLs.
  const endSession = () => {
    pickerHandle?.stop();
    pickerHandle = null;
    card?.close();
    card = null;
    for (const cap of captures) revokeUrl(cap);
    captures = [];
    ui.setLauncherActive(false);
  };

  // Sign in + allowlist gate, shared by every capture entry point.
  async function authorize(): Promise<string | null> {
    // Preferred: reuse the host app's existing Supabase session (same project),
    // so the tester is never bounced to our /auth popup.
    if (config.hostAuth === "supabase") {
      const host = hostSupabaseToken();
      if (host) {
        try {
          const access = await fetchAccess(config.apiBase, host);
          if (!access.isTester) {
            ui.showToast("Your account isn't on the tester allowlist");
            return null;
          }
          token = host;
          authorizedEmail = access.email || null;
          authMode = "host";
          return host;
        } catch {
          // Host token wasn't accepted (e.g. different project / expired) —
          // fall through to the popup.
        }
      }
    }

    // On localhost, allow capture without any sign-in. The worker accepts
    // reports from localhost origins and attributes them to a local reporter,
    // so local dev needs neither a tester account nor the /auth popup.
    if (isLocalhost()) {
      token = null;
      authorizedEmail = "local@localhost";
      authMode = "local";
      return LOCAL_TOKEN;
    }

    const auth = await getToken(config.authUrl);
    if (!auth) {
      ui.showToast("Sign-in required");
      return null;
    }
    const access = await fetchAccess(config.apiBase, auth.token);
    if (!access.isTester) {
      ui.showToast("Your account isn't on the tester allowlist");
      return null;
    }
    token = auth.token;
    authorizedEmail = access.email || auth.email || null;
    authMode = "popup";
    return auth.token;
  }

  // A current token for the send path. Re-reads the host session (the host's
  // supabase-js auto-refreshes it) or refreshes via the popup cache.
  async function freshToken(): Promise<string | null> {
    if (authMode === "local") return LOCAL_TOKEN;
    if (authMode === "host") return hostSupabaseToken() || token;
    return (await getToken(config.authUrl))?.token || token;
  }

  async function toggleReportHighlights() {
    if (reportHighlightsOn) {
      hideReportHighlights();
      return;
    }

    await enableReportHighlights();
  }

  async function enableReportHighlights() {
    if (reportHighlightsOn) return;
    const auth = await authorize();
    if (!auth) return;
    if (authMode === "local") {
      ui.setHighlightControlState({ active: false });
      ui.showToast("Submitted report highlights need a signed-in account");
      return;
    }

    reportHighlightsOn = true;
    await loadReportHighlightsForCurrentPage({ keepToggleOnError: false });
  }

  async function reloadReportHighlightsForNavigation() {
    if (!reportHighlightsOn) return;
    clearReportHighlights();
    reportHighlightCount = 0;
    await loadReportHighlightsForCurrentPage({ keepToggleOnError: true });
  }

  async function loadReportHighlightsForCurrentPage({ keepToggleOnError }: { keepToggleOnError: boolean }) {
    if (!reportHighlightsOn) return;
    ui.setHighlightControlState({ active: true, loading: true, count: reportHighlightCount });
    try {
      const highlightPageUrl = canonicalPageUrl(window.location.href);
      if (!highlightPageUrl) throw new Error("Could not determine page URL");
      const fresh = await freshToken();
      if (!fresh) throw new Error("Sign-in required");
      const reports = currentPageReports(await listReports(config.apiBase, fresh, {
        project: config.project,
        pageUrl: highlightPageUrl,
        limit: 500,
      }));
      if (!reportHighlightsOn || canonicalPageUrl(window.location.href) !== highlightPageUrl) return;
      showReportHighlights(reports);
    } catch (error) {
      reportHighlightsOn = keepToggleOnError;
      clearReportHighlights();
      reportHighlightCount = 0;
      ui.setHighlightControlState({ active: keepToggleOnError, error: true });
      ui.showToast(error instanceof Error ? error.message : "Failed to load reported elements");
    }
  }

  async function openReportsDrawer() {
    const drawer = ui.showReportsDrawer();
    drawer.setLoading();
    try {
      const auth = await authorize();
      if (!auth) {
        drawer.setError("Sign in to view your reports.");
        return;
      }
      if (authMode === "local") {
        drawer.setError("Report review needs a signed-in tester account.");
        return;
      }
      const fresh = await freshToken();
      if (!fresh) throw new Error("Sign-in required");
      drawer.setReports(currentUserReports(await listReports(config.apiBase, fresh)));
    } catch (error) {
      drawer.setError(error instanceof Error ? error.message : "Failed to load reports");
    }
  }

  const openCard = (pointer: { x: number; y: number }) => {
    if (card) {
      refreshCard();
      return;
    }
    card = ui.showCaptureCard({
      pointer,
      onSend: ({ note, severity }) => {
        const targets = captures.slice();
        // Detach captures from the session so endSession doesn't revoke the
        // screenshots we still need for the async send.
        captures = [];
        const urls = new Map(shotUrls);
        shotUrls.clear();
        endSession();
        // Revoke preview URLs now that the card is gone — the send re-uses the
        // File objects, not the object URLs.
        for (const url of urls.values()) URL.revokeObjectURL(url);
        void enqueueSend(targets, note, severity);
        // Keep the session going: immediately re-arm the picker so the tester
        // can pick the next element without re-toggling the launcher. The send
        // runs async in the background.
        beginPicker();
      },
      onCancel: () => endSession(),
      onAddAnother: () => {
        // Resume the running picker, or start one if the card was opened from a
        // viewport-only capture (context menu) with no picker behind it.
        if (pickerHandle?.isActive()) pickerHandle.resume();
        else beginPicker();
      },
      onAttachViewport: () => void attachViewport(),
      onRemoveCapture: (index) => {
        const [removed] = captures.splice(index, 1);
        if (removed) revokeUrl(removed);
        if (captures.length === 0) {
          card?.close();
          card = null;
          pickerHandle?.resume();
        } else {
          refreshCard();
        }
      },
      onPreview: (index) => {
        const url = urlFor(captures[index]);
        if (url) ui.showLightbox(url);
      },
      onPasteImage: (file) => {
        captures.push({
          selector: "(pasted image)",
          text: "",
          rect: { x: 0, y: 0, width: 0, height: 0 },
          pointer: { x: 0, y: 0 },
          element: document.body,
          screenshot: file,
        });
        refreshCard();
        ui.showToast("Image attached", true);
      },
    });
    refreshCard();
  };

  // Capture the current viewport and add it as a screenshot-only entry.
  async function attachViewport() {
    try {
      const file = await captureViewport();
      const synthetic: CapturedTarget = {
        selector: "(viewport)",
        text: "",
        rect: { x: 0, y: 0, width: innerWidth, height: innerHeight },
        pointer: { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) },
        element: document.body,
        screenshot: file,
      };
      captures.push(synthetic);
      refreshCard();
    } catch {
      card?.setError("Screenshot capture failed");
    }
  }

  function flashSent() {
    ui.setLauncherStatus({ sent: true });
    if (sentTimer) window.clearTimeout(sentTimer);
    sentTimer = window.setTimeout(() => {
      if (pending === 0) ui.setLauncherStatus({});
    }, 3000);
  }

  // Take the send-time screenshot (all picked elements outlined) and submit.
  async function enqueueSend(targets: CapturedTarget[], note: string, severity: string) {
    if (targets.length === 0) return;
    pending += 1;
    ui.setLauncherStatus({ pending });

    try {
      // Synthetic captures (viewport / pasted image) use a placeholder element;
      // only outline & report real picked DOM elements (selectors not in parens).
      const isReal = (t: CapturedTarget) => !t.selector.startsWith("(");
      const realElements = targets
        .filter((t) => isReal(t) && t.element instanceof Element && document.contains(t.element))
        .map((t) => t.element);

      const manualShots = targets
        .map((t) => t.screenshot)
        .filter((s): s is File => Boolean(s));

      // Take a fresh overview (all picked elements outlined) when there are real
      // elements to show. A viewport/pasted-only report already carries its image.
      let sendTimeShot: File | null = null;
      // Carry forward any capture-time failure (e.g. a drag-to-select area whose
      // screenshot couldn't be taken) so the report records why an image is
      // missing rather than dropping the reason.
      let screenshotError = targets.map((t) => t.screenshotError).find(Boolean);
      if (realElements.length > 0 || manualShots.length === 0) {
        try {
          sendTimeShot = await captureScreenshotWithHighlights(realElements);
          screenshotError = undefined;
        } catch (err) {
          screenshotError = err instanceof Error ? err.message : "Screenshot capture failed";
        }
      }

      const screenshots = sendTimeShot ? [sendTimeShot, ...manualShots] : manualShots;

      const elements: ReportElement[] = targets
        .filter(isReal)
        .map((t) => ({ selector: t.selector, text: t.text, rect: t.rect }));

      // Local dev with a configured sink: write to the local codebase instead of
      // the worker/R2.
      if (authMode === "local" && config.localSink) {
        await submitReportLocal(config.localSink, {
          project: config.project,
          note,
          severity,
          screenshots,
          elements,
          screenshotError,
        });
      } else {
        const fresh = await freshToken();
        if (!fresh) throw new Error("Sign-in required");

        await submitReport({
          apiBase: config.apiBase,
          // Local dev submits unauthenticated; send no bearer (worker trusts the origin).
          token: authMode === "local" ? "" : fresh,
          project: config.project,
          note,
          severity,
          screenshots,
          elements,
          screenshotError,
        });
      }

      pending -= 1;
      if (pending > 0) ui.setLauncherStatus({ pending });
      else flashSent();
    } catch (error) {
      pending -= 1;
      ui.setLauncherStatus(pending > 0 ? { pending } : { error: true });
      ui.showToast(error instanceof Error ? error.message : "Failed to send report");
    }
  }

  // Start (or restart) the element picker for the current session. Assumes the
  // tester is already authorized.
  function beginPicker() {
    ui.setLauncherActive(true);
    pickerHandle = startElementPicker({
      onPick: (target) => {
        captures.push(target);
        if (card) refreshCard();
        else openCard(target.pointer);
      },
      onCancel: () => endSession(),
    });
  }

  async function startPicker() {
    // Toggle off if already running.
    if (pickerHandle?.isActive()) {
      endSession();
      return;
    }
    const auth = await authorize();
    if (!auth) return;
    beginPicker();
  }

  // Viewport-only flow from the context menu: capture, then open the card.
  async function captureViewportFlow() {
    if (pickerHandle?.isActive() || card) return;
    const auth = await authorize();
    if (!auth) return;
    try {
      const file = await captureViewport();
      const synthetic: CapturedTarget = {
        selector: "(viewport)",
        text: "",
        rect: { x: 0, y: 0, width: innerWidth, height: innerHeight },
        pointer: { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) },
        element: document.body,
        screenshot: file,
      };
      captures.push(synthetic);
      openCard(synthetic.pointer);
    } catch {
      ui.showToast("Screenshot capture failed");
    }
  }

  function openContextMenu(pointer: { x: number; y: number }) {
    const email = cachedEmail();
    ui.showContextMenu(pointer, [
      ...(email ? [{ label: email, onClick: () => undefined }] : []),
      { label: "Capture viewport screenshot", onClick: () => void captureViewportFlow() },
      { label: "View my reports", onClick: () => void openReportsDrawer() },
      {
        label: "Sign out",
        onClick: () => {
          signOut(config.authUrl);
          ui.showToast("Signed out");
        },
      },
    ]);
  }

  ui.mountLauncher({
    mount: config.mount,
    position: config.position,
    onClick: () => void startPicker(),
    onContextMenu: openContextMenu,
    onOpenReports: () => void openReportsDrawer(),
    onToggleHighlights: () => void toggleReportHighlights(),
    onCaptureViewport: () => void captureViewportFlow(),
    onSignOut: () => {
      signOut(config.authUrl);
      ui.showToast("Signed out");
    },
  });

  let lastPageUrl = canonicalPageUrl(window.location.href);
  const checkPageNavigation = () => {
    const nextPageUrl = canonicalPageUrl(window.location.href);
    if (nextPageUrl === lastPageUrl) return;
    lastPageUrl = nextPageUrl;
    void reloadReportHighlightsForNavigation();
  };
  const schedulePageNavigationCheck = () => window.setTimeout(checkPageNavigation, 0);
  const wrapHistoryMethod = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = ((...args: Parameters<History["pushState"]>) => {
      const result = original.apply(history, args);
      schedulePageNavigationCheck();
      return result;
    }) as History[typeof method];
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", schedulePageNavigationCheck);
  window.addEventListener("hashchange", schedulePageNavigationCheck);

  void enableReportHighlights();

  // ⌥K toggles the picker, unless the user is typing in a field.
  window.addEventListener("keydown", (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.code !== "KeyK") return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
      return;
    }
    event.preventDefault();
    void startPicker();
  });

  window.SincTester = { startPicker: () => void startPicker() };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
