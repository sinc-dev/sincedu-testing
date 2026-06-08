const Z = 2147483630;
const IGNORE_ATTR = "data-sincedu-tester-ignore";

const STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .corner { position: fixed; z-index: ${Z}; }
  .corner.bottom-right { right: 20px; bottom: 20px; }
  .corner.bottom-left { left: 20px; bottom: 20px; }
  .corner.top-right { right: 20px; top: 20px; }
  .corner.top-left { left: 20px; top: 20px; }
  .launcher {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 9999px; border: none; cursor: pointer;
    background: #2e7d46; color: #fff; box-shadow: 0 6px 16px rgba(0,0,0,.25);
  }
  .launcher:hover { background: #256b3b; }
  .launcher.active { background: #1b5e2c; box-shadow: 0 0 0 3px rgba(46,125,70,.35); }
  .launcher svg { width: 22px; height: 22px; }
  .card {
    position: fixed; z-index: ${Z + 2}; width: 300px; background: #fff; color: #111827;
    border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.28); padding: 12px;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .between { justify-content: space-between; }
  .selector { font: 11px ui-monospace, monospace; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea {
    width: 100%; min-height: 64px; resize: vertical; margin-top: 8px; padding: 8px;
    border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; color: #111827;
  }
  select { height: 32px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0 6px; font-size: 12px; flex: 1; }
  .btn { height: 32px; padding: 0 12px; border: none; border-radius: 8px; background: #2e7d46; color: #fff; font-size: 13px; cursor: pointer; }
  .btn:disabled { opacity: .5; cursor: default; }
  .mic { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none;
    border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #6b7280; cursor: pointer; }
  .mic svg { width: 16px; height: 16px; }
  .mic:hover:not(:disabled) { color: #2e7d46; border-color: #2e7d46; }
  .mic:disabled { opacity: .45; cursor: default; }
  .mic.recording { color: #dc2626; border-color: #dc2626; background: #fef2f2; }
  .mic.recording svg { animation: tf-pulse 1.2s ease-in-out infinite; }
  @keyframes tf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .iconbtn { background: none; border: none; cursor: pointer; color: #6b7280; font-size: 16px; line-height: 1; }
  .err { color: #dc2626; font-size: 12px; margin-top: 6px; }
  .menu { position: fixed; z-index: ${Z + 3}; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 4px; min-width: 160px; }
  .menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; border: none; background: none; border-radius: 6px; font-size: 13px; color: #111827; cursor: pointer; }
  .menu button:hover { background: #f3f4f6; }
  .toast { position: fixed; z-index: ${Z + 4}; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #111827; color: #fff; padding: 10px 16px; border-radius: 9999px; font-size: 13px; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
  .toast.ok { background: #047857; }
  .shot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .shot-thumb { height: 44px; width: 64px; flex: none; padding: 0; overflow: hidden; cursor: zoom-in;
    border: 1px solid #d1d5db; border-radius: 6px; background: #f3f4f6; }
  .shot-thumb img { height: 100%; width: 100%; object-fit: cover; display: block; }
  .shot-retake { padding: 0; border: none; background: none; cursor: pointer; font-size: 12px; color: #2e7d46; }
  .shot-retake:hover { text-decoration: underline; }
  .lightbox { position: fixed; inset: 0; z-index: ${Z + 5}; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.85); padding: 40px; cursor: zoom-out; }
  .lightbox img { max-height: 100%; max-width: 100%; border-radius: 6px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.5); }
`;

const CROSSHAIR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;

// lucide `mic` / `mic-off`, inlined (the widget has no icon dependency).
const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const MIC_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;

const SEVERITIES = ["low", "medium", "high", "critical"];

// Mirror of the host-app sanitizer: strip control chars and angle brackets,
// cap at the same 2000-char limit the textarea enforces.
function sanitizePlainText(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, 2000);
}

export interface NoteResult {
  note: string;
  severity: string;
}

export interface NoteController {
  setBusy(busy: boolean): void;
  setError(message: string): void;
  close(): void;
}

function clamp(pointer: { x: number; y: number }, w: number, h: number) {
  const m = 8;
  let left = pointer.x + 12;
  if (left + w + m > innerWidth) left = pointer.x - w - 12;
  left = Math.max(m, Math.min(left, innerWidth - w - m));
  let top = pointer.y + 12;
  if (top + h + m > innerHeight) top = pointer.y - h - 12;
  top = Math.max(m, Math.min(top, innerHeight - h - m));
  return { left, top };
}

export class WidgetUI {
  private root: ShadowRoot;
  private launcherButton: HTMLButtonElement | null = null;

	  constructor() {
	    const host = document.createElement("div");
	    host.id = "sincedu-tester-widget";
	    host.setAttribute(IGNORE_ATTR, "true");
	    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.root.appendChild(style);
  }

  mountLauncher(opts: {
    mount: string | null;
    position: string;
    onClick: () => void;
    onContextMenu: (pointer: { x: number; y: number }) => void;
  }): void {
	    const button = document.createElement("button");
	    button.setAttribute(IGNORE_ATTR, "true");
	    button.className = "launcher";
    button.title = "Tester capture — pick an element & report (⌥K)";
    button.setAttribute("aria-label", "Tester capture");
    button.innerHTML = CROSSHAIR_SVG;
    this.launcherButton = button;
    button.addEventListener("click", opts.onClick);
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      opts.onContextMenu({ x: e.clientX, y: e.clientY });
    });

    const hostEl = opts.mount ? document.querySelector(opts.mount) : null;
    if (hostEl) {
      // Render into the host's element (e.g. app bar). Inherits host styles.
      hostEl.appendChild(button);
    } else {
	      const corner = document.createElement("div");
	      corner.setAttribute(IGNORE_ATTR, "true");
	      corner.className = `corner ${opts.position}`;
      corner.appendChild(button);
      this.root.appendChild(corner);
    }
  }

  // Highlight the launcher while the element picker is actively running.
  setLauncherActive(active: boolean): void {
    this.launcherButton?.classList.toggle("active", active);
    if (this.launcherButton) {
      this.launcherButton.title = active
        ? "Picker on — click an element, or Esc to cancel (⌥K)"
        : "Tester capture — pick an element & report (⌥K)";
    }
  }

  // Fullscreen preview of the captured screenshot. Click anywhere or press
  // Esc to dismiss.
  showLightbox(url: string): void {
	    const box = document.createElement("div");
	    box.setAttribute(IGNORE_ATTR, "true");
	    box.className = "lightbox";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Screenshot preview";
    img.addEventListener("click", (e) => e.stopPropagation());
    box.appendChild(img);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const dismiss = () => {
      box.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    box.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey, true);
    this.root.appendChild(box);
  }

  showNoteCard(opts: {
    pointer: { x: number; y: number };
    selector: string;
    screenshotUrl?: string | null;
    onSend: (result: NoteResult) => void;
    onCancel: () => void;
    onRetake?: () => void;
  }): NoteController {
    const { left, top } = clamp(opts.pointer, 300, opts.screenshotUrl ? 320 : 240);
	    const card = document.createElement("div");
	    card.setAttribute(IGNORE_ATTR, "true");
	    card.className = "card";
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.innerHTML = `
      <div class="row between">
        <span class="selector" title="${opts.selector}">${opts.selector}</span>
        <button class="iconbtn" data-act="close" aria-label="Cancel">×</button>
      </div>
      ${opts.screenshotUrl ? `
      <div class="shot">
        <button class="shot-thumb" data-act="zoom" type="button" aria-label="Preview screenshot"><img src="${opts.screenshotUrl}" alt=""></button>
        ${opts.onRetake ? `<button class="shot-retake" data-act="retake" type="button">Retake</button>` : ""}
      </div>` : ""}
      <textarea placeholder="Describe the issue… (Enter to send, ⌘/Ctrl+Enter for new line)" maxlength="2000"></textarea>
      <div class="err" hidden></div>
      <div class="row" style="margin-top:8px">
        <select>${SEVERITIES.map((s) => `<option value="${s}"${s === "medium" ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>
        <button class="mic" data-act="mic" type="button" aria-label="Dictate the description" aria-pressed="false" title="Dictate the description">${MIC_SVG}</button>
        <button class="btn" data-act="send">Send</button>
      </div>`;
    this.root.appendChild(card);

    const textarea = card.querySelector("textarea")!;
    const select = card.querySelector("select")!;
    const sendBtn = card.querySelector('[data-act="send"]') as HTMLButtonElement;
    const micBtn = card.querySelector('[data-act="mic"]') as HTMLButtonElement;
    const errEl = card.querySelector(".err") as HTMLDivElement;
    textarea.focus();

    // Speech-to-text dictation via the Web Speech API (Chrome/Edge/Safari).
    // Unsupported browsers (Firefox today) get a disabled mic with a tooltip.
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let recognition: any = null;
    let dictating = false;
    if (!SpeechRecognitionCtor) {
      micBtn.disabled = true;
      micBtn.title = "Speech-to-text not supported in this browser";
    }
    const renderMic = () => {
      micBtn.classList.toggle("recording", dictating);
      micBtn.innerHTML = dictating ? MIC_OFF_SVG : MIC_SVG;
      micBtn.setAttribute("aria-pressed", String(dictating));
      micBtn.title = dictating ? "Stop dictation" : "Dictate the description";
    };
    const stopDictation = () => {
      try {
        recognition?.stop?.();
      } catch {
        /* noop */
      }
      dictating = false;
      renderMic();
    };
    const toggleDictation = () => {
      if (!SpeechRecognitionCtor) return;
      if (dictating) {
        stopDictation();
        return;
      }
      const r = new SpeechRecognitionCtor();
      r.lang = navigator.language || "en-US";
      r.continuous = true;
      r.interimResults = true;
      // Append dictation to the LIVE textarea value, committing only the newly
      // finalized delta and rewriting just the interim tail. We never rebuild
      // from a snapshot of the whole transcript, so manual edits/deletions the
      // user makes mid-session are preserved instead of being clobbered.
      let finalChars = 0; // length of finalized transcript already committed
      let interimTail = ""; // interim text we last appended at the end
      r.onresult = (event: any) => {
        let finals = "";
        let interim = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finals += transcript;
          else interim += transcript;
        }
        const newFinal = finals.slice(finalChars);
        finalChars = finals.length;

        // Strip the interim tail we wrote last time (if still present), so we
        // edit only our own region and leave the user's text intact.
        let value = textarea.value;
        if (interimTail && value.endsWith(interimTail)) {
          value = value.slice(0, value.length - interimTail.length);
        }
        if (newFinal) {
          const sep = value.length > 0 && !/\s$/.test(value) ? " " : "";
          value += sep + newFinal;
        }
        const interimSep = interim && value.length > 0 && !/\s$/.test(value) ? " " : "";
        interimTail = interim ? interimSep + interim : "";
        textarea.value = sanitizePlainText(value + interimTail);
      };
      r.onerror = () => {
        dictating = false;
        renderMic();
      };
      r.onend = () => {
        dictating = false;
        renderMic();
      };
      try {
        r.start();
        recognition = r;
        dictating = true;
        renderMic();
      } catch {
        // Already started or permission denied — leave UI idle.
        dictating = false;
        renderMic();
      }
    };
    micBtn.addEventListener("click", toggleDictation);

    const close = () => {
      stopDictation();
      card.remove();
    };
    const submit = () => {
      if (!textarea.value.trim()) {
        errEl.hidden = false;
        errEl.textContent = "Add a note before sending.";
        return;
      }
      stopDictation();
      opts.onSend({ note: sanitizePlainText(textarea.value).trim(), severity: select.value });
    };

    // Keep the field clean as the user types (mirrors host-app behavior),
    // preserving the caret when characters are stripped.
    textarea.addEventListener("input", () => {
      const caret = textarea.selectionStart ?? textarea.value.length;
      const cleaned = sanitizePlainText(textarea.value);
      if (cleaned !== textarea.value) {
        textarea.value = cleaned;
        const next = Math.min(caret, cleaned.length);
        textarea.selectionStart = textarea.selectionEnd = next;
      }
    });

    // Enter sends; Ctrl/⌘+Enter inserts a newline; Shift+Enter = browser default.
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const value = textarea.value;
        const start = textarea.selectionStart ?? value.length;
        const end = textarea.selectionEnd ?? value.length;
        textarea.value = `${value.slice(0, start)}\n${value.slice(end)}`;
        const caret = start + 1;
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = caret;
        });
        return;
      }
      if (event.shiftKey) return;
      event.preventDefault();
      submit();
    });

    card.querySelector('[data-act="close"]')!.addEventListener("click", () => {
      close();
      opts.onCancel();
    });
    if (opts.screenshotUrl) {
      card.querySelector('[data-act="zoom"]')?.addEventListener("click", () => {
        this.showLightbox(opts.screenshotUrl as string);
      });
      card.querySelector('[data-act="retake"]')?.addEventListener("click", () => {
        close();
        opts.onRetake?.();
      });
    }
    sendBtn.addEventListener("click", submit);

    return {
      setBusy: (busy) => {
        sendBtn.disabled = busy;
        sendBtn.textContent = busy ? "Sending…" : "Send";
      },
      setError: (message) => {
        errEl.hidden = false;
        errEl.textContent = message;
      },
      close,
    };
  }

  showContextMenu(pointer: { x: number; y: number }, items: Array<{ label: string; onClick: () => void }>): void {
	    const menu = document.createElement("div");
	    menu.setAttribute(IGNORE_ATTR, "true");
	    menu.className = "menu";
    const { left, top } = clamp(pointer, 180, 8 + items.length * 34);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    items.forEach((item) => {
      const b = document.createElement("button");
      b.textContent = item.label;
      b.addEventListener("click", () => {
        menu.remove();
        item.onClick();
      });
      menu.appendChild(b);
    });
    this.root.appendChild(menu);
    const dismiss = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  }

  showToast(message: string, ok = false): void {
	    const toast = document.createElement("div");
	    toast.setAttribute(IGNORE_ATTR, "true");
	    toast.className = `toast${ok ? " ok" : ""}`;
    toast.textContent = message;
    this.root.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }
}
