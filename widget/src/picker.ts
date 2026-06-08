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
  screenshot: File;
}

const HIGHLIGHT_COLOR = "#ef4444";
const Z = 2147483640;
const IGNORE_ATTR = "data-sincedu-tester-ignore";

function shouldIncludeInScreenshot(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  return !Boolean(node.closest(`[${IGNORE_ATTR}]`));
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

async function screenshotBody(): Promise<File> {
  const blob = await domToBlob(document.body, {
    type: "image/jpeg",
    quality: 0.82,
    scale: 0.75,
    backgroundColor: "#ffffff",
    filter: shouldIncludeInScreenshot,
  });
  return new File([blob], `screenshot-${Date.now()}.jpg`, { type: "image/jpeg" });
}

async function capture(el: HTMLElement): Promise<File> {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = `3px solid ${HIGHLIGHT_COLOR}`;
  el.style.outlineOffset = "2px";
  try {
    return await screenshotBody();
  } finally {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }
}

// Capture the current viewport with nothing highlighted — for when the tester
// just wants to attach what they're seeing rather than a specific element. The
// widget host carries the ignore attribute, so the launcher/card never appear.
export async function captureViewport(): Promise<CapturedTarget | null> {
  if (typeof document === "undefined") return null;
  try {
    const screenshot = await screenshotBody();
    return {
      selector: "(viewport)",
      text: "",
      rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      pointer: { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) },
      screenshot,
    };
  } catch {
    return null;
  }
}

// Interactive element picking: hover to highlight, click to select. Resolves
// with the element's selector/text/rect, the click pointer, and a screenshot
// with the element highlighted. Resolves null on Esc.
export function pickElementAndCapture(): Promise<CapturedTarget | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);

	    const highlight = document.createElement("div");
	    highlight.setAttribute(IGNORE_ATTR, "true");
	    highlight.style.cssText = `position:fixed;pointer-events:none;z-index:${Z};border:2px solid ${HIGHLIGHT_COLOR};background:rgba(239,68,68,0.12);border-radius:2px;transition:all 60ms ease;display:none`;

	    const hint = document.createElement("div");
	    hint.setAttribute(IGNORE_ATTR, "true");
	    hint.textContent = "Click an element to attach it · Esc to cancel";
    hint.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:${Z + 1};background:#111827;color:#fff;padding:8px 14px;border-radius:9999px;font:500 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);pointer-events:none`;

    document.body.appendChild(highlight);
    document.body.appendChild(hint);

    let current: Element | null = null;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      highlight.remove();
      hint.remove();
    };

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === highlight || el === hint) return;
      current = el;
      const r = el.getBoundingClientRect();
      highlight.style.display = "block";
      highlight.style.top = `${r.top}px`;
      highlight.style.left = `${r.left}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
        resolve(null);
      }
    };

    const onClick = async (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = current;
      if (!target) {
        cleanup();
        return resolve(null);
      }
      const r = target.getBoundingClientRect();
      const selector = buildSelector(target);
      const text = (target.textContent || "").trim().slice(0, 200);
      const pointer = { x: e.clientX, y: e.clientY };
      highlight.style.display = "none";
      hint.style.display = "none";
      try {
        const screenshot = await capture(target as HTMLElement);
        cleanup();
        resolve({
          selector,
          text,
          rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
          pointer,
          screenshot,
        });
      } catch {
        cleanup();
        resolve(null);
      }
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  });
}
