import { readConfig } from "./config.js";
import { installDiagnostics } from "./diagnostics.js";
import {
  startElementPicker,
  captureViewport,
  captureScreenshotWithHighlights,
  type CapturedTarget,
  type PickerHandle,
} from "./picker.js";
import { cachedEmail, getToken, hostSupabaseToken, signOut } from "./auth.js";
import {
  fetchAccess,
  listReports,
  submitReport,
  submitReportLocal,
  type ReportElement,
  type ReportSummary,
} from "./api.js";
import { WidgetUI, type CaptureView, type CaptureCardController } from "./ui.js";

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
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  };

  const clearReportHighlights = () => {
    for (const overlay of reportHighlightOverlays) overlay.remove();
    reportHighlightOverlays.splice(0);
    if (reportHighlightRefreshFrame !== null) {
      window.cancelAnimationFrame(reportHighlightRefreshFrame);
      reportHighlightRefreshFrame = null;
    }
    window.removeEventListener("scroll", scheduleReportHighlightRefresh, true);
    window.removeEventListener("resize", scheduleReportHighlightRefresh);
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
      const target = selector ? document.querySelector(selector) : null;
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
    return reports.filter((report) => (report.reporter_email || "").trim().toLowerCase() === normalized);
  };

  const currentPageReports = (reports: ReportSummary[]): ReportSummary[] => {
    const here = canonicalPageUrl(window.location.href);
    return reports.filter((report) => {
      if (!report.page_url || !report.element_selector) return false;
      return canonicalPageUrl(report.page_url) === here;
    });
  };

  const showReportHighlights = (reports: ReportSummary[]) => {
    clearReportHighlights();
    const seen = new Set<string>();
    for (const report of reports) {
      const selector = report.element_selector;
      if (!selector || seen.has(selector)) continue;
      let target: Element | null = null;
      try {
        target = document.querySelector(selector);
      } catch {
        continue;
      }
      if (!target || target.closest(`[${IGNORE_ATTR}]`)) continue;
      seen.add(selector);

      const overlay = document.createElement("div");
      overlay.setAttribute(IGNORE_ATTR, "true");
      overlay.dataset.selector = selector;
      overlay.title = report.title || "Submitted bug report";
      overlay.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        `z-index:${HIGHLIGHT_Z}`,
        "border:2px solid #dc2626",
        "background:rgba(220,38,38,.10)",
        "box-shadow:0 0 0 3px rgba(220,38,38,.18)",
        "border-radius:4px",
      ].join(";");
      document.body.appendChild(overlay);
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
      reportHighlightsOn = false;
      clearReportHighlights();
      reportHighlightCount = 0;
      ui.setHighlightControlState({ active: false });
      return;
    }

    const auth = await authorize();
    if (!auth) return;
    if (authMode === "local") {
      ui.setHighlightControlState({ active: false });
      ui.showToast("Submitted report highlights need a signed-in account");
      return;
    }

    reportHighlightsOn = true;
    ui.setHighlightControlState({ active: true, loading: true });
    try {
      const fresh = await freshToken();
      if (!fresh) throw new Error("Sign-in required");
      const reports = currentPageReports(currentUserReports(await listReports(config.apiBase, fresh)));
      showReportHighlights(reports);
    } catch (error) {
      reportHighlightsOn = false;
      clearReportHighlights();
      reportHighlightCount = 0;
      ui.setHighlightControlState({ active: false, error: true });
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
      let screenshotError: string | undefined;
      if (realElements.length > 0 || manualShots.length === 0) {
        try {
          sendTimeShot = await captureScreenshotWithHighlights(realElements);
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
      ui.showToast(authMode === "local" && config.localSink ? "Saved locally" : "Report sent", true);
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
