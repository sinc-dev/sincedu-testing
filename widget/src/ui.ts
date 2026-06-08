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
  .launcher-wrap { position: relative; display: inline-flex; }
  .launcher {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 9999px; border: none; cursor: pointer;
    background: #2e7d46; color: #fff; box-shadow: 0 6px 16px rgba(0,0,0,.25);
  }
  .launcher:hover { background: #256b3b; }
  .launcher.active { background: #1b5e2c; box-shadow: 0 0 0 3px rgba(46,125,70,.35); }
  .launcher svg { width: 22px; height: 22px; }
  .badge-count {
    position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px;
    display: flex; align-items: center; justify-content: center; border-radius: 9999px;
    background: #0ea5e9; color: #fff; font-size: 11px; font-weight: 600; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  }
  .badge-err {
    position: absolute; top: -4px; right: -4px; width: 14px; height: 14px; border-radius: 9999px;
    background: #dc2626; color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,.3);
  }
  .badge-sent {
    position: absolute; right: calc(100% + 8px); top: 50%; transform: translateY(-50%); white-space: nowrap;
    background: #059669; color: #fff; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 500; box-shadow: 0 2px 6px rgba(0,0,0,.25);
  }
  .card {
    position: fixed; z-index: ${Z + 2}; width: 320px; background: #fff; color: #111827;
    border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.28); padding: 12px;
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .between { justify-content: space-between; }
  .targets-label { font: 600 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .04em; color: #2e7d46; }
  .captures { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0; }
  .cap-thumb { position: relative; height: 48px; width: 48px; flex: none; padding: 0; overflow: hidden; cursor: zoom-in;
    border: 1px solid #d1d5db; border-radius: 6px; background: #f3f4f6; }
  .cap-thumb img { height: 100%; width: 100%; object-fit: cover; display: block; }
  .cap-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 6px;
    border-radius: 6px; background: #f3f4f6; font: 11px ui-monospace, monospace; color: #374151; }
  .cap-chip .sel { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cap-x { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 9999px;
    border: none; background: #111827; color: #fff; font-size: 11px; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .chip-x { border: none; background: none; color: #9ca3af; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
  .chip-x:hover { color: #dc2626; }
  .cap-add { display: inline-flex; align-items: center; gap: 2px; padding: 3px 8px; cursor: pointer;
    border: 1px dashed #d1d5db; border-radius: 6px; background: none; font-size: 11px; color: #6b7280; }
  .cap-add:hover { border-color: #2e7d46; color: #2e7d46; }
  textarea {
    width: 100%; min-height: 64px; resize: vertical; padding: 8px;
    border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; color: #111827;
  }
  select { height: 32px; border: 1px solid #d1d5db; border-radius: 8px; padding: 0 6px; font-size: 12px; flex: 1; }
  .btn { height: 32px; padding: 0 12px; border: none; border-radius: 8px; background: #2e7d46; color: #fff; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .btn:disabled { opacity: .5; cursor: default; }
  .iconsq { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: none;
    border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #6b7280; cursor: pointer; }
  .iconsq svg { width: 16px; height: 16px; }
  .iconsq:hover:not(:disabled) { color: #2e7d46; border-color: #2e7d46; }
  .iconsq:disabled { opacity: .45; cursor: default; }
  .iconsq.recording { color: #dc2626; border-color: #dc2626; background: #fef2f2; }
  .iconsq.recording svg { animation: tf-pulse 1.2s ease-in-out infinite; }
  @keyframes tf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  .iconbtn { background: none; border: none; cursor: pointer; color: #6b7280; font-size: 16px; line-height: 1; }
  .err { color: #dc2626; font-size: 12px; margin-top: 6px; }
  .menu { position: fixed; z-index: ${Z + 3}; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 4px; min-width: 160px; }
  .menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; border: none; background: none; border-radius: 6px; font-size: 13px; color: #111827; cursor: pointer; }
  .menu button:hover { background: #f3f4f6; }
  .toast { position: fixed; z-index: ${Z + 4}; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #111827; color: #fff; padding: 10px 16px; border-radius: 9999px; font-size: 13px; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
  .toast.ok { background: #047857; }
  .lightbox { position: fixed; inset: 0; z-index: ${Z + 5}; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.85); padding: 40px; cursor: zoom-out; }
  .lightbox img { max-height: 100%; max-width: 100%; border-radius: 6px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.5); }
`;

const CROSSHAIR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const MIC_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const CAMERA_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg>`;

const SEVERITIES = ["low", "medium", "high", "critical"];

// Mirror of the host-app sanitizer: strip control chars and angle brackets,
// cap at the same 2000-char limit the textarea enforces.
function sanitizePlainText(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[<>]/g, "")
    .slice(0, 2000);
}

// A capture entry as the card needs to render it.
export interface CaptureView {
  selector: string;
  screenshotUrl: string | null;
}

export interface CaptureCardOptions {
  pointer: { x: number; y: number };
  onSend: (result: { note: string; severity: string }) => void;
  onCancel: () => void;
  onAddAnother: () => void;
  onAttachViewport: () => void;
  onRemoveCapture: (index: number) => void;
  onPreview: (index: number) => void;
  // An image was pasted into the note — attach it as a screenshot capture.
  onPasteImage: (file: File) => void;
}

export interface CaptureCardController {
  setCaptures(captures: CaptureView[]): void;
  reposition(pointer: { x: number; y: number }): void;
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
  private launcherWrap: HTMLElement | null = null;

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
    const wrap = document.createElement("span");
    wrap.setAttribute(IGNORE_ATTR, "true");
    wrap.className = "launcher-wrap";

    const button = document.createElement("button");
    button.setAttribute(IGNORE_ATTR, "true");
    button.className = "launcher";
    button.title = "Tester capture — pick an element & report (⌥K)";
    button.setAttribute("aria-label", "Tester capture");
    button.innerHTML = CROSSHAIR_SVG;
    this.launcherButton = button;
    this.launcherWrap = wrap;
    button.addEventListener("click", opts.onClick);
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      opts.onContextMenu({ x: e.clientX, y: e.clientY });
    });
    wrap.appendChild(button);

    const hostEl = opts.mount ? document.querySelector(opts.mount) : null;
    if (hostEl) {
      hostEl.appendChild(wrap);
    } else {
      const corner = document.createElement("div");
      corner.setAttribute(IGNORE_ATTR, "true");
      corner.className = `corner ${opts.position}`;
      corner.appendChild(wrap);
      this.root.appendChild(corner);
    }
  }

  setLauncherActive(active: boolean): void {
    this.launcherButton?.classList.toggle("active", active);
    if (this.launcherButton) {
      this.launcherButton.title = active
        ? "Picker on — click an element, or Esc to cancel (⌥K)"
        : "Tester capture — pick an element & report (⌥K)";
    }
  }

  // Show a transient status badge on the launcher: pending count, error, or a
  // brief "sent" confirmation. Passing all-falsy clears the badge.
  setLauncherStatus(status: { pending?: number; error?: boolean; sent?: boolean }): void {
    const wrap = this.launcherWrap;
    if (!wrap) return;
    wrap.querySelector(".badge-count")?.remove();
    wrap.querySelector(".badge-err")?.remove();
    wrap.querySelector(".badge-sent")?.remove();
    if (status.pending && status.pending > 0) {
      const b = document.createElement("span");
      b.setAttribute(IGNORE_ATTR, "true");
      b.className = "badge-count";
      b.textContent = String(status.pending);
      wrap.appendChild(b);
    } else if (status.error) {
      const b = document.createElement("span");
      b.setAttribute(IGNORE_ATTR, "true");
      b.className = "badge-err";
      b.textContent = "!";
      wrap.appendChild(b);
    } else if (status.sent) {
      const b = document.createElement("span");
      b.setAttribute(IGNORE_ATTR, "true");
      b.className = "badge-sent";
      b.textContent = "Report sent ✓";
      wrap.appendChild(b);
    }
  }

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

  // The multi-capture note card. The captures row updates independently of the
  // textarea (via the returned controller) so adding/removing elements never
  // clobbers what the tester has typed.
  showCaptureCard(opts: CaptureCardOptions): CaptureCardController {
    const card = document.createElement("div");
    card.setAttribute(IGNORE_ATTR, "true");
    card.className = "card";
    const place = (pointer: { x: number; y: number }) => {
      const { left, top } = clamp(pointer, 320, 320);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    };
    place(opts.pointer);

    card.innerHTML = `
      <div class="row between">
        <span class="targets-label">targets (0)</span>
        <button class="iconbtn" data-act="close" aria-label="Cancel">×</button>
      </div>
      <div class="captures"></div>
      <textarea placeholder="Describe the issue… (Enter to send, ⌘/Ctrl+Enter for new line)" maxlength="2000"></textarea>
      <div class="err" hidden></div>
      <div class="row" style="margin-top:8px">
        <select>${SEVERITIES.map((s) => `<option value="${s}"${s === "medium" ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>
        <button class="iconsq" data-act="mic" type="button" aria-label="Dictate the description" aria-pressed="false" title="Dictate the description">${MIC_SVG}</button>
        <button class="iconsq" data-act="camera" type="button" aria-label="Attach viewport screenshot" title="Attach a screenshot of the current viewport">${CAMERA_SVG}</button>
        <button class="btn" data-act="send">Send</button>
      </div>`;
    this.root.appendChild(card);

    const label = card.querySelector(".targets-label") as HTMLSpanElement;
    const capturesEl = card.querySelector(".captures") as HTMLDivElement;
    const textarea = card.querySelector("textarea")!;
    const select = card.querySelector("select")!;
    const sendBtn = card.querySelector('[data-act="send"]') as HTMLButtonElement;
    const micBtn = card.querySelector('[data-act="mic"]') as HTMLButtonElement;
    const cameraBtn = card.querySelector('[data-act="camera"]') as HTMLButtonElement;
    const errEl = card.querySelector(".err") as HTMLDivElement;
    textarea.focus();

    // ---- Speech-to-text dictation (Chrome/Edge/Safari) ----
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
      let finalChars = 0;
      let interimTail = "";
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
        dictating = false;
        renderMic();
      }
    };
    micBtn.addEventListener("click", toggleDictation);

    // ---- Captures row (re-rendered on demand) ----
    const renderCaptures = (captures: CaptureView[]) => {
      label.textContent = `targets (${captures.length})`;
      capturesEl.replaceChildren();
      captures.forEach((cap, index) => {
        if (cap.screenshotUrl) {
          const thumb = document.createElement("div");
          thumb.className = "cap-thumb";
          thumb.title = cap.selector;
          const preview = document.createElement("button");
          preview.type = "button";
          preview.style.cssText = "display:block;height:100%;width:100%;border:none;padding:0;background:none;cursor:zoom-in";
          preview.setAttribute("aria-label", `Preview screenshot for ${cap.selector}`);
          const img = document.createElement("img");
          img.src = cap.screenshotUrl;
          img.alt = "";
          preview.appendChild(img);
          preview.addEventListener("click", () => opts.onPreview(index));
          const x = document.createElement("button");
          x.type = "button";
          x.className = "cap-x";
          x.textContent = "×";
          x.setAttribute("aria-label", `Remove ${cap.selector}`);
          x.addEventListener("click", () => opts.onRemoveCapture(index));
          thumb.appendChild(preview);
          thumb.appendChild(x);
          capturesEl.appendChild(thumb);
        } else {
          const chip = document.createElement("span");
          chip.className = "cap-chip";
          chip.title = cap.selector;
          const sel = document.createElement("span");
          sel.className = "sel";
          sel.textContent = cap.selector;
          const x = document.createElement("button");
          x.type = "button";
          x.className = "chip-x";
          x.textContent = "×";
          x.setAttribute("aria-label", `Remove ${cap.selector}`);
          x.addEventListener("click", () => opts.onRemoveCapture(index));
          chip.appendChild(sel);
          chip.appendChild(x);
          capturesEl.appendChild(chip);
        }
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "cap-add";
      add.setAttribute("aria-label", "Add another element");
      add.title = "Pick another element";
      add.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> add`;
      add.addEventListener("click", () => opts.onAddAnother());
      capturesEl.appendChild(add);
    };

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

    textarea.addEventListener("input", () => {
      const caret = textarea.selectionStart ?? textarea.value.length;
      const cleaned = sanitizePlainText(textarea.value);
      if (cleaned !== textarea.value) {
        textarea.value = cleaned;
        const next = Math.min(caret, cleaned.length);
        textarea.selectionStart = textarea.selectionEnd = next;
      }
    });

    // Paste an image from the clipboard (e.g. a screenshot) to attach it. Text
    // paste is left to the browser's default handling.
    textarea.addEventListener("paste", (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();
        const ext = (blob.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type });
        opts.onPasteImage(file);
        return;
      }
    });

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

    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        opts.onCancel();
      }
    });

    card.querySelector('[data-act="close"]')!.addEventListener("click", () => {
      close();
      opts.onCancel();
    });
    cameraBtn.addEventListener("click", () => opts.onAttachViewport());
    sendBtn.addEventListener("click", submit);

    renderCaptures([]);

    return {
      setCaptures: renderCaptures,
      reposition: place,
      setBusy: (busy) => {
        sendBtn.disabled = busy;
        cameraBtn.disabled = busy;
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
