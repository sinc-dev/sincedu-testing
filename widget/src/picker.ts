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

// A "pass-through scrim" is a full-screen overlay/backdrop that sits on top of
// the content the tester is actually aiming at — e.g. a Radix/vaul/MUI dialog
// overlay, or any hand-rolled modal backdrop. These capture pointer hit-testing
// (pointer-events: auto) so a naive elementFromPoint returns the scrim instead
// of the element beneath it. We detect them structurally (positioned, covering
// ~the whole viewport, with no text content of their own) rather than by any
// framework-specific class/attribute, so picking works with or without Radix,
// vaul, MUI, or anything else.
function isPassThroughScrim(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el === document.body || el === document.documentElement) return false;
  const cs = getComputedStyle(el);
  if (cs.position !== "fixed" && cs.position !== "absolute") return false;
  if (cs.pointerEvents === "none" || cs.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  const coversViewport =
    (r.left <= 1 && r.top <= 1 && r.right >= innerWidth - 1 && r.bottom >= innerHeight - 1) ||
    (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9);
  if (!coversViewport) return false;
  // A real content surface (hero, full-screen panel) has its own text; a scrim
  // is empty or only wraps a smaller panel. If the tester is over that smaller
  // panel, elementsFromPoint returns it first anyway, so we never reach here.
  const hasOwnText = Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || "").trim().length > 0,
  );
  return !hasOwnText;
}

// Resolve the real element under the cursor, transparently skipping the widget's
// own UI and any full-screen overlay scrims. Uses elementsFromPoint (the full
// front-to-back hit stack) so it lands on the drawer panel / button / field the
// tester is pointing at, no matter what modal layer a framework painted on top.
function resolveTargetAt(x: number, y: number): Element | null {
  const stack: Element[] =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y)
      : ([document.elementFromPoint(x, y)].filter(Boolean) as Element[]);
  for (const el of stack) {
    if (!el || el === document.documentElement) continue;
    // Never pick the widget's own launcher / picker chrome.
    if (el.closest(`[${IGNORE_ATTR}]`)) continue;
    // See through full-screen backdrops to the content beneath.
    if (isPassThroughScrim(el)) continue;
    return el;
  }
  return document.body;
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

// Capture an arbitrary rectangular region of the page (viewport coordinates) —
// used by the drag-to-select-area gesture. Renders document.body shifted so the
// region's top-left lands at (0,0) and clipped to the region's size.
export async function captureArea(area: ElementRect): Promise<File> {
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;

  // Clamp the output canvas to MAX_CANVAS_EDGE_PX; allow up to 2x for crisp
  // captures of small regions (retina-quality), but never exceed the edge cap.
  const longestEdge = Math.max(area.width, area.height);
  const maxScale = MAX_CANVAS_EDGE_PX / Math.max(longestEdge, 1);
  const scale = Math.max(0.5, Math.min(2, maxScale));

  const blob = await domToBlob(document.body, {
    type: "image/jpeg",
    quality: 0.9,
    scale,
    width: area.width,
    height: area.height,
    backgroundColor: "#ffffff",
    filter: shouldIncludeInScreenshot,
    style: {
      transform: `translate(${-(scrollX + area.x)}px, ${-(scrollY + area.y)}px)`,
      transformOrigin: "top left",
    },
  });

  if (!blob || blob.size < MIN_VALID_BLOB_SIZE) {
    throw new Error("Area capture returned an empty image.");
  }
  return new File([blob], `area-${Date.now()}.jpg`, { type: "image/jpeg" });
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
  const HINT_DEFAULT = "Click or press Enter on an element · drag to select an area · Esc to cancel";
  const HINT_AREA = "Release to capture area · Esc to cancel";
  hint.textContent = HINT_DEFAULT;
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

  // Drag-to-select-area state. A press that moves past DRAG_THRESHOLD becomes an
  // area selection (marquee); a press that doesn't is treated as an element click.
  const DRAG_THRESHOLD = 6;
  let startPt: { x: number; y: number } | null = null;
  let pressing = false;
  let isArea = false;
  // A selection happens on mouseup; the browser then fires a synthetic `click`.
  // Swallow that one click so it can't activate the underlying page element.
  let suppressClick = false;

  const showHover = (event: MouseEvent) => {
    // resolveTargetAt already skips the widget's own UI and any full-screen
    // overlay scrims, so the highlight tracks the real element underneath.
    const el = resolveTargetAt(event.clientX, event.clientY);
    if (!el || el === highlight || el === hint) return;
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    highlight.style.transition = "all 60ms ease";
    highlight.style.display = "block";
    highlight.style.top = `${rect.top}px`;
    highlight.style.left = `${rect.left}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  };

  // Marquee rect (in viewport coords) from the drag start to the current point.
  const areaRectFrom = (start: { x: number; y: number }, event: MouseEvent): ElementRect => ({
    x: Math.min(start.x, event.clientX),
    y: Math.min(start.y, event.clientY),
    width: Math.abs(event.clientX - start.x),
    height: Math.abs(event.clientY - start.y),
  });

  const onMove = (event: MouseEvent) => {
    if (paused) return;
    if (pressing && startPt) {
      const moved = Math.hypot(event.clientX - startPt.x, event.clientY - startPt.y);
      if (!isArea && moved > DRAG_THRESHOLD) {
        isArea = true;
        hint.textContent = HINT_AREA;
        highlight.style.transition = "none";
      }
      if (isArea) {
        const r = areaRectFrom(startPt, event);
        highlight.style.display = "block";
        highlight.style.top = `${r.y}px`;
        highlight.style.left = `${r.x}px`;
        highlight.style.width = `${r.width}px`;
        highlight.style.height = `${r.height}px`;
      }
      return; // suppress hover-highlight while a press is in progress
    }
    showHover(event);
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
      return;
    }
    // Enter selects the currently-highlighted element (keyboard equivalent of a
    // click), using the element's center as the pointer position.
    if (event.key === "Enter" && currentTarget && !pressing) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const rect = currentTarget.getBoundingClientRect();
      commitElement(currentTarget, {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      });
    }
  };

  // Swallow events targeting the underlying page so Radix popovers / headless
  // menus / click-outside libs don't react to picker gestures. Selection logic
  // lives in onDown/onUp (a press that moves = area; a press that doesn't =
  // element); plain `click` is swallowed since selection happens on mouseup.
  const swallow = (event: Event): boolean => {
    if (paused) return false;
    const el = event.target as Element | null;
    if (el && el.closest(`[${IGNORE_ATTR}]`)) return false;
    event.preventDefault();
    event.stopPropagation();
    (event as MouseEvent).stopImmediatePropagation?.();
    return true;
  };

  const onDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (!swallow(event)) return;
    startPt = { x: event.clientX, y: event.clientY };
    pressing = true;
    isArea = false;
  };

  // Commit a specific element as a pick. Shared by the click path and the
  // keyboard (Enter) path.
  const commitElement = (target: Element | null, pointer: { x: number; y: number }) => {
    if (!target || target.closest(`[${IGNORE_ATTR}]`)) return;
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
      pointer,
      element: target,
    });
  };

  // Select the element currently under the cursor (the no-drag / click path).
  const pickElement = (event: MouseEvent) => {
    commitElement(currentTarget || resolveTargetAt(event.clientX, event.clientY), {
      x: event.clientX,
      y: event.clientY,
    });
  };

  // Capture the dragged rectangle as a screenshot-only entry. The synthetic,
  // parenthesized selector marks it as non-element so the send path treats the
  // captured image as the report image rather than outlining a DOM node.
  const pickArea = async (start: { x: number; y: number }, event: MouseEvent) => {
    const area = areaRectFrom(start, event);
    if (area.width < 8 || area.height < 8) {
      resume();
      return;
    }
    pause();
    try {
      const screenshot = await captureArea(area);
      options.onPick({
        selector: `(area ${Math.round(area.width)}×${Math.round(area.height)})`,
        text: "",
        rect: { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) },
        pointer: { x: event.clientX, y: event.clientY },
        element: document.body,
        screenshot,
      });
    } catch {
      resume();
    }
  };

  const onUp = (event: MouseEvent) => {
    if (!pressing) {
      swallow(event);
      return;
    }
    const wasArea = isArea;
    const start = startPt;
    pressing = false;
    isArea = false;
    startPt = null;
    if (!swallow(event)) return;
    suppressClick = true;
    if (wasArea && start) void pickArea(start, event);
    else pickElement(event);
  };

  // Click runs after a selecting mouseup — eat it once so it never reaches the
  // page. Otherwise behave like swallow (protect the underlying UI while active).
  const onClick = (event: MouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      (event as MouseEvent).stopImmediatePropagation?.();
      return;
    }
    swallow(event);
  };

  const pause = () => {
    paused = true;
    pressing = false;
    isArea = false;
    startPt = null;
    highlight.style.display = "none";
    hint.style.display = "none";
  };

  const resume = () => {
    if (!active) return;
    paused = false;
    currentTarget = null;
    hint.textContent = HINT_DEFAULT;
    hint.style.display = "block";
  };

  const stop = () => {
    if (!active) return;
    active = false;
    // Pointer events (not mouse events): canceling pointerdown suppresses the
    // compatibility mousedown/mouseup, so the gesture must be driven by pointers.
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("pointerup", onUp, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    highlight.remove();
    hint.remove();
  };

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  return { stop, pause, resume, isActive: () => active };
}
