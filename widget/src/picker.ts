import { domToBlob } from "modern-screenshot";

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturedTarget {
  selector: string;
  text: string;
  rect: ElementRect;
  pointer: { x: number; y: number };
  // Live reference to the picked element, used to outline it in the send-time
  // screenshot. Not serialized.
  element: Element;
  // Per-element screenshot captured manually (camera button). The main report
  // image is taken at Send time with every element outlined.
  screenshot?: File;
  // Set when a capture failed (e.g. canvas pixel limit). The report still
  // submits; the failure is surfaced to the tester.
  screenshotError?: string;
}

export interface PickerHandle {
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isActive: () => boolean;
}

export interface PickerOptions {
  onPick: (target: CapturedTarget) => void;
  onCancel?: () => void;
}

const HIGHLIGHT_COLOR = "#ef4444";
const Z = 2147483640;
const IGNORE_ATTR = "data-sincedu-tester-ignore";

// Browser canvas max edge varies (Chrome ~16k, Safari ~8k, iOS ~4k). Cap each
// edge below the lowest common limit to avoid silent empty-blob failures.
const MAX_CANVAS_EDGE_PX = 4096;
const MIN_VALID_BLOB_SIZE = 1024;

// Exclude the widget's own UI (launcher, cards, picker highlight/hint) from
// screenshots — every widget node carries IGNORE_ATTR.
function shouldIncludeInScreenshot(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  return !node.closest(`[${IGNORE_ATTR}]`);
}

function buildSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === Node.ELEMENT_NODE && depth < 5) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

// Outlines the given elements with the picker highlight color, captures the
// CURRENT VIEWPORT (not the full off-screen page) so:
//   - the image reflects what the tester actually sees,
//   - the canvas stays small/predictable (no browser pixel-limit failures),
//   - far-apart elements are captured together at the final UI state.
// Throws if the resulting blob is suspiciously small (modern-screenshot can
// silently return an empty image), so the caller can surface the failure.
export async function captureScreenshotWithHighlights(elements: Element[]): Promise<File> {
  const restorers: Array<() => void> = [];
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = `3px solid ${HIGHLIGHT_COLOR}`;
    el.style.outlineOffset = "2px";
    restorers.push(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    });
  }

  // Pull the first highlighted element into view if it's off-screen.
  const first = elements[0];
  if (first instanceof HTMLElement) {
    const rect = first.getBoundingClientRect();
    const offscreen =
      rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
    if (offscreen) {
      try {
        first.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
      } catch {
        first.scrollIntoView();
      }
    }
  }

  try {
    const viewportWidth = innerWidth;
    const viewportHeight = innerHeight;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    // Clamp output canvas to MAX_CANVAS_EDGE_PX on either axis.
    const longestEdge = Math.max(viewportWidth, viewportHeight);
    const maxScale = MAX_CANVAS_EDGE_PX / Math.max(longestEdge, 1);
    const scale = Math.max(0.25, Math.min(1, maxScale));

    // Render document.body but constrain to the viewport box and shift the body
    // up/left by the scroll offset so the visible region lands at (0,0).
    const blob = await domToBlob(document.body, {
      type: "image/jpeg",
      quality: 0.85,
      scale,
      width: viewportWidth,
      height: viewportHeight,
      backgroundColor: "#ffffff",
      filter: shouldIncludeInScreenshot,
      style: {
        transform: `translate(${-scrollX}px, ${-scrollY}px)`,
        transformOrigin: "top left",
      },
    });

    if (!blob || blob.size < MIN_VALID_BLOB_SIZE) {
      throw new Error("Screenshot capture returned an empty image.");
    }
    return new File([blob], `screenshot-${Date.now()}.jpg`, { type: "image/jpeg" });
  } finally {
    for (const restore of restorers) restore();
  }
}

// Capture just the current viewport with nothing highlighted — for when the
// tester wants to attach what they're seeing rather than a specific element.
export function captureViewport(): Promise<File> {
  return captureScreenshotWithHighlights([]);
}

// Starts a persistent element-picking mode. Hover highlights, click selects.
// Picking pauses the listeners (the caller resumes via the handle after
// handling the pick). Esc cancels the picker entirely.
export function startElementPicker(options: PickerOptions): PickerHandle {
  if (typeof document === "undefined") {
    return { stop: () => {}, pause: () => {}, resume: () => {}, isActive: () => false };
  }

  const highlight = document.createElement("div");
  highlight.setAttribute(IGNORE_ATTR, "true");
  highlight.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    `z-index:${Z}`,
    `border:2px solid ${HIGHLIGHT_COLOR}`,
    "background:rgba(239,68,68,0.12)",
    "border-radius:2px",
    "transition:all 60ms ease",
    "display:none",
  ].join(";");

  const hint = document.createElement("div");
  hint.setAttribute(IGNORE_ATTR, "true");
  hint.textContent = "Click an element to attach it · Esc to cancel";
  hint.style.cssText = [
    "position:fixed",
    "top:16px",
    "left:50%",
    "transform:translateX(-50%)",
    `z-index:${Z + 1}`,
    "background:#111827",
    "color:#fff",
    "padding:8px 14px",
    "border-radius:9999px",
    "font:500 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "box-shadow:0 4px 12px rgba(0,0,0,0.25)",
    "pointer-events:none",
  ].join(";");

  document.body.appendChild(highlight);
  document.body.appendChild(hint);

  let currentTarget: Element | null = null;
  let paused = false;
  let active = true;

  const onMove = (event: MouseEvent) => {
    if (paused) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === highlight || el === hint) return;
    // Ignore the widget's own UI.
    if (el.closest(`[${IGNORE_ATTR}]`)) return;
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (paused) return;
    if (event.key === "Escape") {
      // Stop propagation so a surrounding Radix Dialog/Drawer doesn't also act
      // on the Escape and close itself.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      stop();
      options.onCancel?.();
    }
  };

  // Radix popovers / headless menus / click-outside libs dismiss on
  // pointerdown / mousedown, not click. Swallow the earlier events too so the
  // underlying UI doesn't react to picker selections.
  const swallowPointer = (event: Event) => {
    if (paused) return;
    const el = event.target as Element | null;
    if (el && el.closest(`[${IGNORE_ATTR}]`)) return;
    event.preventDefault();
    event.stopPropagation();
    (event as MouseEvent).stopImmediatePropagation?.();
  };

  const onClick = (event: MouseEvent) => {
    if (paused) return;
    const el = event.target as Element | null;
    if (el && el.closest(`[${IGNORE_ATTR}]`)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const target = currentTarget;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    pause();
    options.onPick({
      selector: buildSelector(target),
      text: (target.textContent || "").trim().slice(0, 200),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      pointer: { x: event.clientX, y: event.clientY },
      element: target,
    });
  };

  const pause = () => {
    paused = true;
    highlight.style.display = "none";
    hint.style.display = "none";
  };

  const resume = () => {
    if (!active) return;
    paused = false;
    currentTarget = null;
    hint.style.display = "block";
  };

  const stop = () => {
    if (!active) return;
    active = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", swallowPointer, true);
    document.removeEventListener("mousedown", swallowPointer, true);
    document.removeEventListener("mouseup", swallowPointer, true);
    document.removeEventListener("keydown", onKeyDown, true);
    highlight.remove();
    hint.remove();
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerdown", swallowPointer, true);
  document.addEventListener("mousedown", swallowPointer, true);
  document.addEventListener("mouseup", swallowPointer, true);
  document.addEventListener("keydown", onKeyDown, true);

  return { stop, pause, resume, isActive: () => active };
}
