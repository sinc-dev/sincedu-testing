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
  .iconbtn { background: none; border: none; cursor: pointer; color: #6b7280; font-size: 16px; line-height: 1; }
  .err { color: #dc2626; font-size: 12px; margin-top: 6px; }
  .menu { position: fixed; z-index: ${Z + 3}; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2); padding: 4px; min-width: 160px; }
  .menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; border: none; background: none; border-radius: 6px; font-size: 13px; color: #111827; cursor: pointer; }
  .menu button:hover { background: #f3f4f6; }
  .toast { position: fixed; z-index: ${Z + 4}; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #111827; color: #fff; padding: 10px 16px; border-radius: 9999px; font-size: 13px; box-shadow: 0 6px 16px rgba(0,0,0,.25); }
  .toast.ok { background: #047857; }
`;

const CROSSHAIR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;

const SEVERITIES = ["low", "medium", "high", "critical"];

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
    button.title = "Tester capture — pick an element & report";
    button.setAttribute("aria-label", "Tester capture");
    button.innerHTML = CROSSHAIR_SVG;
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

  showNoteCard(opts: {
    pointer: { x: number; y: number };
    selector: string;
    onSend: (result: NoteResult) => void;
    onCancel: () => void;
  }): NoteController {
    const { left, top } = clamp(opts.pointer, 300, 240);
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
      <textarea placeholder="Describe the issue…" maxlength="2000"></textarea>
      <div class="err" hidden></div>
      <div class="row" style="margin-top:8px">
        <select>${SEVERITIES.map((s) => `<option value="${s}"${s === "medium" ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>
        <button class="btn" data-act="send">Send</button>
      </div>`;
    this.root.appendChild(card);

    const textarea = card.querySelector("textarea")!;
    const select = card.querySelector("select")!;
    const sendBtn = card.querySelector('[data-act="send"]') as HTMLButtonElement;
    const errEl = card.querySelector(".err") as HTMLDivElement;
    textarea.focus();

    const close = () => card.remove();
    card.querySelector('[data-act="close"]')!.addEventListener("click", () => {
      close();
      opts.onCancel();
    });
    sendBtn.addEventListener("click", () => {
      if (!textarea.value.trim()) {
        errEl.hidden = false;
        errEl.textContent = "Add a note before sending.";
        return;
      }
      opts.onSend({ note: textarea.value.trim(), severity: select.value });
    });

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
