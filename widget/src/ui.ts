import type { ReportSummary } from "./api.js";

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
  .launcher-wrap { position: relative; display: inline-block; width: 88px; height: 88px; }
  .launcher-core { position: absolute; inset: 0; }
  .menu-ring {
    position: absolute; left: 5px; top: 5px; width: 78px; height: 78px; border-radius: 9999px;
    appearance: none; -webkit-appearance: none; padding: 0;
    border: none; outline: none; box-shadow: none; background: transparent; color: #6b7280; cursor: pointer;
    opacity: .98;
  }
  .menu-ring:focus-visible { outline: 3px solid rgba(46,125,70,.35); outline-offset: 2px; }
  .menu-ring-dot {
    position: absolute; width: 4px; height: 4px; border-radius: 9999px; pointer-events: none;
    background: #9ca3af; box-shadow: 0 1px 2px rgba(0,0,0,.16), 0 0 0 1px rgba(255,255,255,.9);
    opacity: 0;
    transform: translate(13px, 13px) scale(.55);
    transition: opacity 150ms ease, transform 190ms cubic-bezier(.16, 1, .3, 1), background 120ms ease;
  }
  .launcher-core:hover .menu-ring-dot,
  .launcher-core:focus-within .menu-ring-dot,
  .launcher-wrap.open .menu-ring-dot {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
  .launcher-core:hover .menu-ring-dot, .launcher-wrap.open .menu-ring-dot { background: #6b7280; }
  .menu-ring-dot.one { left: 25px; top: 29px; }
  .menu-ring-dot.two { left: 31px; top: 24px; }
  .menu-ring-dot.three { left: 38px; top: 20px; }
  .launcher {
    position: absolute; left: 29px; top: 29px; display: inline-flex; align-items: center; justify-content: center;
    width: 54px; height: 54px; border-radius: 9999px; border: 2px solid rgba(255,255,255,.95); cursor: pointer;
    background: #2e7d46; color: #fff; box-shadow: 0 8px 20px rgba(0,0,0,.28);
    touch-action: none;
  }
  .launcher:hover { background: #256b3b; }
  .launcher.active { background: #1b5e2c; box-shadow: 0 0 0 3px rgba(46,125,70,.35); }
  .launcher svg { width: 26px; height: 26px; }
  .corner.dragging .launcher { cursor: grabbing; }
  .orbit {
    position: absolute; left: 27px; top: 27px; width: 36px; height: 36px;
    opacity: 0; pointer-events: none; transform: translate(0, 0) scale(.78);
    transition: opacity 120ms ease, transform 160ms ease;
  }
  .launcher-wrap.open .orbit { opacity: 1; pointer-events: auto; transform: translate(var(--orbit-x), var(--orbit-y)) scale(1); }
  .orbit-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 9999px; border: 1px solid rgba(255,255,255,.9);
    background: #fff; color: #1f2937; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.2);
  }
  .orbit-btn svg { width: 18px; height: 18px; }
  .orbit-btn:hover:not(:disabled) { color: #2e7d46; border-color: #2e7d46; }
  .orbit-btn.active { background: #fef2f2; color: #dc2626; border-color: #fca5a5; }
  .orbit-btn.loading { color: #6b7280; cursor: progress; }
  .orbit-btn.error { background: #fef2f2; color: #dc2626; border-color: #fca5a5; }
  .orbit-btn:disabled { opacity: .55; cursor: default; }
  .orbit-label {
    position: absolute; right: calc(100% + 8px); top: 50%; transform: translate(4px, -50%) scale(.96);
    max-width: 180px; padding: 5px 8px; border-radius: 9999px; background: #111827; color: #fff;
    font-size: 11px; font-weight: 500; line-height: 1; white-space: nowrap; pointer-events: none;
    opacity: 0; box-shadow: 0 4px 12px rgba(0,0,0,.22);
    transition: opacity 120ms ease, transform 140ms ease;
  }
  .orbit:hover .orbit-label, .orbit:focus-within .orbit-label {
    opacity: 1; transform: translate(0, -50%) scale(1);
  }
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
  .card-titlebar { cursor: grab; user-select: none; touch-action: none; margin: -4px -4px 0; padding: 4px; border-radius: 8px; }
  .card.dragging .card-titlebar { cursor: grabbing; }
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
  .reports-backdrop { position: fixed; inset: 0; z-index: ${Z + 5}; background: rgba(17,24,39,.18); opacity: 0; transition: opacity 140ms ease; }
  .reports-backdrop.open { opacity: 1; }
  .reports-drawer {
    position: fixed; z-index: ${Z + 6}; top: 0; right: 0; width: min(390px, calc(100vw - 24px)); height: 100dvh;
    display: grid; grid-template-rows: auto minmax(0, 1fr); background: #fff; color: #111827;
    border-left: 1px solid #e5e7eb; box-shadow: -18px 0 42px rgba(0,0,0,.22);
    transform: translateX(102%); transition: transform 180ms cubic-bezier(.16, 1, .3, 1);
  }
  .reports-drawer.open { transform: translateX(0); }
  .reports-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid #e5e7eb; }
  .reports-title { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
  .reports-subtitle { margin: 4px 0 0; color: #6b7280; font-size: 12px; line-height: 1.35; }
  .reports-close { width: 30px; height: 30px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; color: #6b7280; cursor: pointer; font-size: 18px; line-height: 1; }
  .reports-close:hover { color: #111827; border-color: #9ca3af; }
  .reports-body { min-height: 0; overflow: auto; padding: 12px; }
  .reports-state { margin: 0; padding: 18px 8px; color: #6b7280; font-size: 13px; line-height: 1.45; text-align: center; }
  .report-list { display: grid; gap: 8px; }
  .report-item { display: grid; gap: 7px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; }
  .report-item-title { margin: 0; color: #111827; font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
  .report-item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: #6b7280; font-size: 11px; }
  .report-status { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 9999px; background: #f3f4f6; color: #374151; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
  .report-status.open { background: #fef2f2; color: #b91c1c; }
  .report-status.fixed, .report-status.resolved, .report-status.closed { background: #ecfdf5; color: #047857; }
  .report-status.investigating, .report-status.in_progress { background: #fffbeb; color: #b45309; }
  .report-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6b7280; font-size: 11px; }
`;

const CROSSHAIR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
const LIST_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const HIGHLIGHT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v4h4l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0L7.4 9.4a2 2 0 0 1 0-2.8L12 2l10 10Z"/></svg>`;
const SIGN_OUT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`;
const MIC_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const MIC_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
const CAMERA_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/></svg>`;

const SEVERITIES = ["low", "medium", "high", "critical"];

function installWidgetEventBoundary(el: HTMLElement): void {
  // The widget may be used while the host app has a modal Drawer/Dialog open.
  // Radix/vaul-style focus scopes and outside-click handlers listen at the
  // document level, so widget interactions must not bubble out as dismiss or
  // focus-leaving signals for the host app.
  for (const type of ["pointerdown", "mousedown", "touchstart", "click", "focusin", "focusout"]) {
    el.addEventListener(type, (event) => event.stopPropagation());
  }

  // Focus events from inside a shadow root are retargeted to the shadow host.
  // A document-level Radix FocusScope can see that retargeted focus before the
  // host's own listener runs and immediately pull focus back into its drawer.
  // Stop widget focus events at window capture, while leaving pointer/click
  // events alone so widget controls still receive normal clicks.
  for (const type of ["focusin", "focusout"]) {
    window.addEventListener(
      type,
      (event) => {
        if (event.composedPath().includes(el)) event.stopPropagation();
      },
      true,
    );
  }
}

function attachWidgetShadow(host: HTMLElement): ShadowRoot {
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLES;
  root.appendChild(style);
  return root;
}

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

export interface ReportsDrawerController {
  setLoading: () => void;
  setReports: (reports: ReportSummary[]) => void;
  setError: (message: string) => void;
  close: () => void;
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

function clampFixedPosition(el: HTMLElement, left: number, top: number) {
  const m = 8;
  const rect = el.getBoundingClientRect();
  const width = rect.width || el.offsetWidth || 44;
  const height = rect.height || el.offsetHeight || 44;
  return {
    left: Math.max(m, Math.min(left, innerWidth - width - m)),
    top: Math.max(m, Math.min(top, innerHeight - height - m)),
  };
}

function makeFixedDraggable(
  el: HTMLElement,
  handle: HTMLElement,
  options: { allowInteractiveStart?: boolean; onDragStart?: () => void } = {},
) {
  const DRAG_THRESHOLD = 4;
  let pointerId: number | null = null;
  let startPointer = { x: 0, y: 0 };
  let startPos = { left: 0, top: 0 };
  let dragging = false;
  let suppressClick = false;

  const moveTo = (left: number, top: number) => {
    const next = clampFixedPosition(el, left, top);
    el.style.left = `${next.left}px`;
    el.style.top = `${next.top}px`;
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (!options.allowInteractiveStart && target?.closest("button, textarea, select, input, a")) return;
    const rect = el.getBoundingClientRect();
    pointerId = event.pointerId;
    startPointer = { x: event.clientX, y: event.clientY };
    startPos = { left: rect.left, top: rect.top };
    dragging = false;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  });

  handle.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    const dx = event.clientX - startPointer.x;
    const dy = event.clientY - startPointer.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      suppressClick = true;
      options.onDragStart?.();
      el.classList.add("dragging");
    }
    event.preventDefault();
    moveTo(startPos.left + dx, startPos.top + dy);
  });

  const finish = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    if (dragging) {
      event.preventDefault();
      el.classList.remove("dragging");
    }
    dragging = false;
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  };

  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    },
    true,
  );

  return { moveTo };
}

export class WidgetUI {
  private root: ShadowRoot;
  private launcherButton: HTMLButtonElement | null = null;
  private launcherWrap: HTMLElement | null = null;
  private highlightButton: HTMLButtonElement | null = null;
  private orbitOpen = false;

  constructor() {
    const host = document.createElement("div");
    host.id = "sincedu-tester-widget";
    host.setAttribute(IGNORE_ATTR, "true");
    document.body.appendChild(host);

    installWidgetEventBoundary(host);
    this.root = attachWidgetShadow(host);
  }

  mountLauncher(opts: {
    mount: string | null;
    position: string;
    onClick: () => void;
    onContextMenu: (pointer: { x: number; y: number }) => void;
    onOpenReports: () => void;
    onToggleHighlights: () => void;
    onCaptureViewport: () => void;
    onSignOut: () => void;
  }): void {
    const wrap = document.createElement("span");
    wrap.setAttribute(IGNORE_ATTR, "true");
    wrap.className = "launcher-wrap";
    installWidgetEventBoundary(wrap);

    const core = document.createElement("span");
    core.setAttribute(IGNORE_ATTR, "true");
    core.className = "launcher-core";

    const menuButton = document.createElement("button");
    menuButton.setAttribute(IGNORE_ATTR, "true");
    menuButton.className = "menu-ring";
    menuButton.type = "button";
    menuButton.title = "Open testing widget menu";
    menuButton.setAttribute("aria-label", "Open testing widget menu");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.innerHTML = `
      <span class="menu-ring-dot one"></span>
      <span class="menu-ring-dot two"></span>
      <span class="menu-ring-dot three"></span>
    `;
    const setOrbitOpen = (open: boolean) => {
      this.orbitOpen = open;
      wrap.classList.toggle("open", open);
      menuButton.setAttribute("aria-expanded", String(open));
    };
    menuButton.addEventListener("click", () => {
      setOrbitOpen(!this.orbitOpen);
    });

    const button = document.createElement("button");
    button.setAttribute(IGNORE_ATTR, "true");
    button.className = "launcher";
    button.title = "Tester capture — pick an element & report (⌥K)";
    button.setAttribute("aria-label", "Tester capture");
    button.innerHTML = CROSSHAIR_SVG;
    this.launcherButton = button;
    this.launcherWrap = wrap;
    let longPressTimer: number | null = null;
    let suppressPickerClick = false;
    const clearLongPress = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      clearLongPress();
      longPressTimer = window.setTimeout(() => {
        suppressPickerClick = true;
        setOrbitOpen(true);
      }, 450);
    });
    button.addEventListener("pointermove", clearLongPress);
    button.addEventListener("pointerup", clearLongPress);
    button.addEventListener("pointercancel", clearLongPress);
    button.addEventListener("click", (event) => {
      if (suppressPickerClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressPickerClick = false;
        return;
      }
      opts.onClick();
    });
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      opts.onContextMenu({ x: e.clientX, y: e.clientY });
    });

    const makeOrbitButton = (
      className: string,
      label: string,
      title: string,
      icon: string,
      offset: { x: number; y: number },
      onClick: () => void,
    ) => {
      const slot = document.createElement("span");
      slot.setAttribute(IGNORE_ATTR, "true");
      slot.className = "orbit";
      slot.style.setProperty("--orbit-x", `${offset.x}px`);
      slot.style.setProperty("--orbit-y", `${offset.y}px`);
      const action = document.createElement("button");
      action.setAttribute(IGNORE_ATTR, "true");
      action.className = `orbit-btn ${className}`;
      action.type = "button";
      action.title = title;
      action.setAttribute("aria-label", label);
      action.innerHTML = icon;
      action.addEventListener("click", () => {
        onClick();
        setOrbitOpen(false);
        wrap.classList.remove("open");
        menuButton.setAttribute("aria-expanded", "false");
      });
      slot.appendChild(action);
      const text = document.createElement("span");
      text.setAttribute(IGNORE_ATTR, "true");
      text.className = "orbit-label";
      text.textContent = label;
      slot.appendChild(text);
      return { slot, action };
    };

    const viewport = makeOrbitButton(
      "viewport-action",
      "Capture viewport screenshot",
      "Capture viewport screenshot",
      CAMERA_SVG,
      { x: -10, y: -58 },
      opts.onCaptureViewport,
    );

    const reports = makeOrbitButton(
      "reports-action",
      "View my submitted bug reports",
      "View my submitted bug reports",
      LIST_SVG,
      { x: -52, y: -34 },
      opts.onOpenReports,
    );

    const highlight = makeOrbitButton(
      "highlight-action",
      "Highlight reported elements on this page",
      "Highlight elements I reported on this page",
      HIGHLIGHT_SVG,
      { x: -62, y: 16 },
      opts.onToggleHighlights,
    );
    highlight.action.setAttribute("aria-pressed", "false");
    this.highlightButton = highlight.action;

    const signOut = makeOrbitButton(
      "signout-action",
      "Sign out of testing widget",
      "Sign out",
      SIGN_OUT_SVG,
      { x: -22, y: 50 },
      opts.onSignOut,
    );

    core.appendChild(menuButton);
    core.appendChild(button);
    wrap.appendChild(core);
    wrap.appendChild(viewport.slot);
    wrap.appendChild(reports.slot);
    wrap.appendChild(highlight.slot);
    wrap.appendChild(signOut.slot);

    const hostEl = opts.mount ? document.querySelector(opts.mount) : null;
    if (hostEl) {
      const mountHost = document.createElement("span");
      mountHost.id = "sincedu-tester-widget-mounted";
      mountHost.setAttribute(IGNORE_ATTR, "true");
      mountHost.style.display = "inline-flex";
      mountHost.style.verticalAlign = "middle";
      installWidgetEventBoundary(mountHost);
      hostEl.appendChild(mountHost);
      this.root = attachWidgetShadow(mountHost);
      this.root.appendChild(wrap);
    } else {
      const corner = document.createElement("div");
      corner.setAttribute(IGNORE_ATTR, "true");
      corner.className = `corner ${opts.position}`;
      corner.appendChild(wrap);
      this.root.appendChild(corner);
      makeFixedDraggable(corner, button, {
        allowInteractiveStart: true,
        onDragStart: () => {
          corner.classList.remove("bottom-right", "bottom-left", "top-right", "top-left");
          corner.style.right = "auto";
          corner.style.bottom = "auto";
        },
      });
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

  setHighlightControlState(state: { active?: boolean; loading?: boolean; error?: boolean; count?: number }): void {
    const button = this.highlightButton;
    if (!button) return;
    const active = Boolean(state.active);
    const loading = Boolean(state.loading);
    const error = Boolean(state.error);
    button.classList.toggle("active", active);
    button.classList.toggle("loading", loading);
    button.classList.toggle("error", error);
    button.disabled = loading;
    button.setAttribute("aria-pressed", String(active));
    if (loading) {
      button.title = "Loading your reported elements";
    } else if (error) {
      button.title = "Could not load reported elements";
    } else if (active) {
      const count = state.count ?? 0;
      button.title = count === 1 ? "1 reported element highlighted" : `${count} reported elements highlighted`;
    } else {
      button.title = "Highlight elements I reported on this page";
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

  showReportsDrawer(): ReportsDrawerController {
    this.root.querySelector(".reports-backdrop")?.remove();
    this.root.querySelector(".reports-drawer")?.remove();

    const backdrop = document.createElement("div");
    backdrop.setAttribute(IGNORE_ATTR, "true");
    backdrop.className = "reports-backdrop";

    const drawer = document.createElement("aside");
    drawer.setAttribute(IGNORE_ATTR, "true");
    drawer.className = "reports-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-labelledby", "sincedu-reports-title");
    drawer.innerHTML = `
      <div class="reports-head">
        <div>
          <h2 id="sincedu-reports-title" class="reports-title">My reports</h2>
          <p class="reports-subtitle">Reports submitted from your tester account.</p>
        </div>
        <button class="reports-close" type="button" aria-label="Close reports drawer">×</button>
      </div>
      <div class="reports-body"><p class="reports-state">Loading reports…</p></div>
    `;

    const body = drawer.querySelector(".reports-body") as HTMLDivElement;
    const close = () => {
      backdrop.classList.remove("open");
      drawer.classList.remove("open");
      window.setTimeout(() => {
        backdrop.remove();
        drawer.remove();
      }, 180);
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const setState = (message: string) => {
      body.replaceChildren();
      const state = document.createElement("p");
      state.className = "reports-state";
      state.textContent = message;
      body.appendChild(state);
    };
    const formatDate = (value: string): string => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };
    const pageLabel = (value: string | null): string => {
      if (!value) return "No page URL";
      try {
        const url = new URL(value);
        return `${url.hostname}${url.pathname}`;
      } catch {
        return value;
      }
    };

    drawer.querySelector(".reports-close")?.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    this.root.appendChild(backdrop);
    this.root.appendChild(drawer);
    requestAnimationFrame(() => {
      backdrop.classList.add("open");
      drawer.classList.add("open");
    });

    return {
      setLoading: () => setState("Loading reports…"),
      setError: (message) => setState(message),
      setReports: (reports) => {
        body.replaceChildren();
        if (reports.length === 0) {
          setState("No reports found for this account.");
          return;
        }
        const list = document.createElement("div");
        list.className = "report-list";
        for (const report of reports) {
          const item = document.createElement("article");
          item.className = "report-item";

          const title = document.createElement("p");
          title.className = "report-item-title";
          title.textContent = report.title || report.element_selector || "Untitled report";

          const meta = document.createElement("div");
          meta.className = "report-item-meta";
          const status = document.createElement("span");
          status.className = `report-status ${report.status || "open"}`;
          status.textContent = (report.status || "open").replace("_", " ");
          const project = document.createElement("span");
          project.textContent = report.project || "default";
          const date = document.createElement("span");
          date.textContent = formatDate(report.created_at);
          meta.append(status, project, date);

          const url = document.createElement("div");
          url.className = "report-url";
          url.textContent = pageLabel(report.page_url);

          item.append(title, meta, url);
          list.appendChild(item);
        }
        body.appendChild(list);
      },
      close,
    };
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
      <div class="row between card-titlebar">
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
    const titlebar = card.querySelector(".card-titlebar") as HTMLDivElement;
    makeFixedDraggable(card, titlebar);

    let keepTextFocus = true;
    let focusRestoreTimer: number | null = null;
    const hasWidgetFocus = () => {
      const activeInWidget = this.root.activeElement;
      return activeInWidget instanceof Element && card.contains(activeInWidget);
    };
    const restoreTextFocus = () => {
      if (!keepTextFocus || !card.isConnected || hasWidgetFocus()) return;
      textarea.focus({ preventScroll: true });
    };
    const scheduleTextFocusRestore = () => {
      if (!keepTextFocus || focusRestoreTimer !== null) return;
      queueMicrotask(restoreTextFocus);
      requestAnimationFrame(restoreTextFocus);
      focusRestoreTimer = window.setTimeout(() => {
        focusRestoreTimer = null;
        restoreTextFocus();
      }, 0);
    };
    const onDocumentFocusChange = () => scheduleTextFocusRestore();
    document.addEventListener("focusin", onDocumentFocusChange, true);
    document.addEventListener("focusout", onDocumentFocusChange, true);
    textarea.focus({ preventScroll: true });
    scheduleTextFocusRestore();

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
      keepTextFocus = false;
      if (focusRestoreTimer !== null) {
        window.clearTimeout(focusRestoreTimer);
        focusRestoreTimer = null;
      }
      document.removeEventListener("focusin", onDocumentFocusChange, true);
      document.removeEventListener("focusout", onDocumentFocusChange, true);
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
