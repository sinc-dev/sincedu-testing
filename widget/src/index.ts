import { readConfig } from "./config.js";
import { installDiagnostics } from "./diagnostics.js";
import { pickElementAndCapture } from "./picker.js";
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

  async function startPicker() {
    if (picking) return;
    picking = true;
    try {
      // 1) Identity — sign in via our /auth popup (host domain never touches the auth provider).
      const auth = await getToken(config.authUrl);
      if (!auth) {
        ui.showToast("Sign-in required");
        return;
      }

      // 2) Gate on allowlist (server is source of truth).
      const access = await fetchAccess(config.apiBase, auth.token);
      if (!access.isTester) {
        ui.showToast("Your account isn't on the tester allowlist");
        return;
      }

      // 3) Pick element + capture screenshot.
      const captured = await pickElementAndCapture();
      if (!captured) return;

      // 4) Inline note box at the cursor.
      const controller = ui.showNoteCard({
        pointer: captured.pointer,
        selector: captured.selector,
        onCancel: () => undefined,
        onSend: async ({ note, severity }) => {
          controller.setBusy(true);
          try {
            const fresh = (await getToken(config.authUrl)) || auth;
            await submitReport({ apiBase: config.apiBase, token: fresh.token, project: config.project, note, severity, captured });
            controller.close();
            ui.showToast("Report sent", true);
          } catch (error) {
            controller.setBusy(false);
            controller.setError(error instanceof Error ? error.message : "Failed to send");
          }
        },
      });
    } finally {
      picking = false;
    }
  }

  function openContextMenu(pointer: { x: number; y: number }) {
    const email = cachedEmail();
    ui.showContextMenu(pointer, [
      ...(email ? [{ label: email, onClick: () => undefined }] : []),
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

  window.SincTester = { startPicker: () => void startPicker() };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
