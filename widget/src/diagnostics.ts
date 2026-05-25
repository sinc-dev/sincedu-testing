// Bounded ring buffers capturing recent console output and failed network
// requests in the host page, so tester reports can attach diagnostics.

export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error";
  message: string;
  at: string;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  at: string;
  responseSnippet?: string;
}

const MAX_CONSOLE = 100;
const MAX_NETWORK = 50;
const MAX_MESSAGE = 2000;
const MAX_SNIPPET = 500;

const consoleBuffer: ConsoleEntry[] = [];
const networkBuffer: NetworkEntry[] = [];
let installed = false;

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const TOKEN_QUERY = /([?&](?:token|access_token|refresh_token|api_key|apikey|key|signature|sig)=)[^&#\s]+/gi;

function redact(value: string): string {
  return value.replace(JWT_PATTERN, "[redacted-token]").replace(TOKEN_QUERY, "$1[redacted]");
}

function truncate(value: string, max: number): string {
  const r = redact(value);
  return r.length > max ? `${r.slice(0, max)}…` : r;
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function pushConsole(level: ConsoleEntry["level"], args: unknown[]) {
  consoleBuffer.push({ level, message: truncate(args.map(stringifyArg).join(" "), MAX_MESSAGE), at: new Date().toISOString() });
  if (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.splice(0, consoleBuffer.length - MAX_CONSOLE);
}

function pushNetwork(method: string, url: string, status: number, snippet?: string) {
  networkBuffer.push({
    method,
    url: truncate(url, MAX_MESSAGE),
    status,
    at: new Date().toISOString(),
    responseSnippet: snippet ? truncate(snippet, MAX_SNIPPET) : undefined,
  });
  if (networkBuffer.length > MAX_NETWORK) networkBuffer.splice(0, networkBuffer.length - MAX_NETWORK);
}

export function getConsoleEntries(): ConsoleEntry[] {
  return consoleBuffer.slice();
}
export function getNetworkEntries(): NetworkEntry[] {
  return networkBuffer.slice();
}

// Patches console.error/warn, window.fetch, and XMLHttpRequest to feed the
// buffers. Failed requests (status >= 400, excluding transient 401s) only.
export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  (["error", "warn"] as const).forEach((level) => {
    const original = console[level]?.bind(console);
    if (!original) return;
    console[level] = (...args: unknown[]) => {
      pushConsole(level, args);
      original(...args);
    };
  });

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      try {
        if (response.status >= 400 && response.status !== 401) {
          const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
          const url = input instanceof Request ? input.url : String(input);
          let snippet: string | undefined;
          try {
            snippet = await response.clone().text();
          } catch {
            snippet = undefined;
          }
          pushNetwork(method, url, response.status, snippet);
        }
      } catch {
        /* never break the host's fetch */
      }
      return response;
    };
  }

  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    const open = OriginalXHR.prototype.open;
    const send = OriginalXHR.prototype.send;
    OriginalXHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) {
      (this as unknown as { __tf?: { method: string; url: string } }).__tf = { method, url };
      // @ts-expect-error passthrough of the remaining args
      return open.call(this, method, url, ...rest);
    };
    OriginalXHR.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
      this.addEventListener("loadend", () => {
        const meta = (this as unknown as { __tf?: { method: string; url: string } }).__tf;
        if (meta && this.status >= 400 && this.status !== 401) {
          let snippet: string | undefined;
          try {
            snippet = typeof this.responseText === "string" ? this.responseText : undefined;
          } catch {
            snippet = undefined;
          }
          pushNetwork(meta.method.toUpperCase(), meta.url, this.status, snippet);
        }
      });
      // @ts-expect-error passthrough
      return send.apply(this, args);
    };
  }
}
