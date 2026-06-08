import { readConfig } from "./config.js";
import { installDiagnostics } from "./diagnostics.js";
import { pickElementAndCapture, captureViewport, type CapturedTarget } from "./picker.js";
import { cachedEmail, getToken, signOut } from "./auth.js";
import { fetchAccess, submitReport } from "./api.js";
import { WidgetUI } from "./ui.js";

declare global {
  interface Window {
    SincTester?: {
      startPicker: () => void;
    };
  }
}

const scriptEl = document.currentScript as HTMLScriptElement | null;

function boot() {
  const config = readConfig(scriptEl);
  installDiagnostics();
  const ui = new WidgetUI();
  let picking = false;
  // True while the note card is open, so the ⌥K shortcut / re-entry don't
  // start a second picker on top of an in-progress report.
  let noteOpen = false;

  // Sign in + allowlist gate, shared by every capture entry point. Returns the
  // auth handle, or null after showing the appropriate toast.
  async function authorize(): Promise<{ token: string } | null> {
    // Identity — sign in via our /auth popup (host domain never touches the auth provider).
    const auth = await getToken(config.authUrl);
    if (!auth) {
      ui.showToast("Sign-in required");
      return null;
    }
    // Allowlist (server is source of truth).
    const access = await fetchAccess(config.apiBase, auth.token);
    if (!access.isTester) {
      ui.showToast("Your account isn't on the tester allowlist");
      return null;
    }
    return auth;
  }

  // Inline note box at the cursor, with a screenshot preview/lightbox and an
  // optional "Retake" that re-runs the same capture flow.
  function openNoteCard(captured: CapturedTarget, auth: { token: string }, restart?: () => void) {
    const screenshotUrl = URL.createObjectURL(captured.screenshot);
    let revoked = false;
    const revoke = () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(screenshotUrl);
    };

    const controller = ui.showNoteCard({
      pointer: captured.pointer,
      selector: captured.selector,
      screenshotUrl,
      onRetake: restart
        ? () => {
            noteOpen = false;
            revoke();
            restart();
          }
        : undefined,
      onCancel: () => {
        noteOpen = false;
        revoke();
      },
      onSend: async ({ note, severity }) => {
        controller.setBusy(true);
        try {
          const fresh = (await getToken(config.authUrl)) || auth;
          await submitReport({ apiBase: config.apiBase, token: fresh.token, project: config.project, note, severity, captured });
          controller.close();
          noteOpen = false;
          revoke();
          ui.showToast("Report sent", true);
        } catch (error) {
          controller.setBusy(false);
          controller.setError(error instanceof Error ? error.message : "Failed to send");
        }
      },
    });
    noteOpen = true;
  }

  async function startPicker() {
    if (picking || noteOpen) return;
    picking = true;
    try {
      const auth = await authorize();
      if (!auth) return;

      // Pick an element + capture screenshot. Highlight the launcher while the
      // picker is live; clear it however the pick resolves (Esc too).
      ui.setLauncherActive(true);
      let captured: CapturedTarget | null = null;
      try {
        captured = await pickElementAndCapture();
      } finally {
        ui.setLauncherActive(false);
      }
      if (!captured) return;

      openNoteCard(captured, auth, () => void startPicker());
    } finally {
      picking = false;
    }
  }

  // Capture the whole viewport (no element to highlight) and open the note box.
  async function captureViewportFlow() {
    if (picking || noteOpen) return;
    picking = true;
    try {
      const auth = await authorize();
      if (!auth) return;
      const captured = await captureViewport();
      if (!captured) {
        ui.showToast("Screenshot capture failed");
        return;
      }
      openNoteCard(captured, auth, () => void captureViewportFlow());
    } finally {
      picking = false;
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

  // Keyboard shortcut: Option/Alt + K starts the picker. Skips when the user
  // is typing in a field so it doesn't fire mid-form-fill. Uses event.code so
  // the binding survives Option-altered layouts on macOS (where Option+K
  // produces "˚" for event.key).
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
