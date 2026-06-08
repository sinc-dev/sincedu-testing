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
import { fetchAccess, submitReport, type ReportElement } from "./api.js";
import { WidgetUI, type CaptureView, type CaptureCardController } from "./ui.js";

declare global {
  interface Window {
    SincTester?: {
      startPicker: () => void;
    };
  }
}

const scriptEl = document.currentScript as HTMLScriptElement | null;

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
  // How the current session authorized: reuse the host's Supabase session, or
  // our /auth popup. Drives where the send path gets its (refreshed) token.
  let authMode: "host" | "popup" | null = null;
  let pending = 0;
  let sentTimer: number | null = null;
  // Object URLs for capture screenshots, so previews render and we can revoke.
  const shotUrls = new Map<CapturedTarget, string>();

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
          authMode = "host";
          return host;
        } catch {
          // Host token wasn't accepted (e.g. different project / expired) —
          // fall through to the popup.
        }
      }
    }

    // On localhost the /auth popup to testing.sincedu.com is unwanted — the
    // tester is expected to already be signed into the host app (same Supabase
    // project). Don't redirect; tell them to sign in to the app instead.
    if (isLocalhost()) {
      ui.showToast("Sign in to the app first to use tester capture");
      return null;
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
    authMode = "popup";
    return auth.token;
  }

  // A current token for the send path. Re-reads the host session (the host's
  // supabase-js auto-refreshes it) or refreshes via the popup cache.
  async function freshToken(): Promise<string | null> {
    if (authMode === "host") return hostSupabaseToken() || token;
    return (await getToken(config.authUrl))?.token || token;
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

      const fresh = await freshToken();
      if (!fresh) throw new Error("Sign-in required");

      await submitReport({
        apiBase: config.apiBase,
        token: fresh,
        project: config.project,
        note,
        severity,
        screenshots,
        elements,
        screenshotError,
      });

      pending -= 1;
      if (pending > 0) ui.setLauncherStatus({ pending });
      else flashSent();
      ui.showToast("Report sent", true);
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
      { label: "View my reports", onClick: () => window.open(config.reviewUrl, "_blank") },
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
