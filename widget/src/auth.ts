// Cross-domain auth client. Instead of running auth on the host page, we open a
// popup to our own /auth page, which signs in and postMessages the access token
// back. The host domain is never involved in the auth provider redirect.

const MESSAGE_TYPE = "sincedu-tester-auth";
const POPUP_TIMEOUT_MS = 120000;

export interface TokenInfo {
  token: string;
  email: string | null;
}

let cached: { token: string; email: string | null; expiresAt: number } | null = null;

function decodeExpiry(token: string): number {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(decodeURIComponent(escape(atob(payload)))) as { exp?: number };
    return (json.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function openAuthPopup(authUrl: string, params: Record<string, string>): Window | null {
  const url = new URL(authUrl);
  url.searchParams.set("o", window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const features = "width=480,height=640,menubar=no,toolbar=no,location=yes";
  return window.open(url.toString(), "sincedu-tester-auth", features);
}

// Opens the auth popup and resolves with the token posted back, or null on
// cancel/timeout/blocked-popup.
function requestTokenFromPopup(authUrl: string): Promise<TokenInfo | null> {
  return new Promise((resolve) => {
    let authOrigin: string;
    try {
      authOrigin = new URL(authUrl).origin;
    } catch {
      return resolve(null);
    }

    const popup = openAuthPopup(authUrl, {});
    if (!popup) return resolve(null);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== authOrigin) return;
      const data = event.data as { type?: string; token?: string; email?: string } | null;
      if (!data || data.type !== MESSAGE_TYPE || !data.token) return;
      cleanup();
      resolve({ token: data.token, email: data.email ?? null });
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, POPUP_TIMEOUT_MS);

    const poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        resolve(null);
      }
    }, 500);

    function cleanup() {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      window.clearInterval(poll);
      try {
        popup?.close();
      } catch {
        /* ignore */
      }
    }

    window.addEventListener("message", onMessage);
  });
}

// Returns a valid access token, reusing the cached one until it nears expiry.
export async function getToken(authUrl: string): Promise<TokenInfo | null> {
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return { token: cached.token, email: cached.email };
  }
  const result = await requestTokenFromPopup(authUrl);
  if (!result) return null;
  cached = { token: result.token, email: result.email, expiresAt: decodeExpiry(result.token) };
  return result;
}

export function cachedEmail(): string | null {
  return cached?.email ?? null;
}

function decodeMaybeBase64(value: string): string {
  if (!value.startsWith("base64-")) return value;
  const b64 = value.slice(7);
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    try {
      return atob(b64);
    } catch {
      return "";
    }
  }
}

// Reassemble values chunked across `<base>.0`, `<base>.1`, … (as @supabase/ssr
// does for large sessions) from an arbitrary key→value source.
function collectSessionStrings(keys: string[], get: (key: string) => string | null): string[] {
  const bases = new Set<string>();
  for (const key of keys) bases.add(key.replace(/\.\d+$/, ""));
  const out: string[] = [];
  for (const base of bases) {
    let raw: string;
    if (get(`${base}.0`) != null) {
      let combined = "";
      for (let i = 0; ; i += 1) {
        const part = get(`${base}.${i}`);
        if (part == null) break;
        combined += part;
      }
      raw = combined;
    } else {
      raw = get(base) ?? "";
    }
    if (raw) out.push(decodeMaybeBase64(raw));
  }
  return out;
}

function cookieMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (document.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const value = part.slice(idx + 1).trim();
    try {
      map.set(name, decodeURIComponent(value));
    } catch {
      map.set(name, value);
    }
  }
  return map;
}

function accessTokenFromSession(text: string): string | null {
  if (!text.includes("access_token")) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  // Some @supabase/ssr versions store an array [access_token, refresh_token, …];
  // others store the session object (optionally under `currentSession`).
  let access: unknown;
  let expSec: number | undefined;
  if (Array.isArray(parsed) && typeof parsed[0] === "string") {
    access = parsed[0];
  } else {
    const session = parsed?.currentSession ?? parsed;
    access = session?.access_token;
    expSec = typeof session?.expires_at === "number" ? session.expires_at : undefined;
  }
  if (typeof access !== "string" || !access) return null;
  const expiresAt = expSec ? expSec * 1000 : decodeExpiry(access);
  if (expiresAt && expiresAt < Date.now() + 30000) return null;
  return access;
}

// When embedded in an app that already runs Supabase auth on the SAME project
// the worker verifies against, reuse that live session instead of opening our
// /auth popup. Scans BOTH localStorage and cookies (@supabase/ssr stores the
// session in cookies) under any storageKey, handling base64-wrapped and chunked
// `<key>.N` storage.
export function hostSupabaseToken(): string | null {
  try {
    const candidates: string[] = [];

    if (typeof localStorage !== "undefined") {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) keys.push(key);
      }
      candidates.push(...collectSessionStrings(keys, (k) => localStorage.getItem(k)));
    }

    if (typeof document !== "undefined" && document.cookie) {
      const cookies = cookieMap();
      candidates.push(
        ...collectSessionStrings([...cookies.keys()], (k) => (cookies.has(k) ? cookies.get(k)! : null)),
      );
    }

    for (const text of candidates) {
      const access = accessTokenFromSession(text);
      if (access) return access;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Signs out on our domain (clears the persisted session) and drops the cache.
export function signOut(authUrl: string): void {
  cached = null;
  const popup = openAuthPopup(authUrl, { signout: "1" });
  // The /auth page closes itself after signing out; close as a fallback.
  window.setTimeout(() => {
    try {
      popup?.close();
    } catch {
      /* ignore */
    }
  }, 3000);
}
