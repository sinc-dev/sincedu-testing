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

// Read a stored value that may be chunked across `<base>.0`, `<base>.1`, … as
// @supabase/ssr does for large sessions. Returns the reassembled string.
function readStorageValue(base: string): string {
  if (localStorage.getItem(`${base}.0`) == null) {
    return localStorage.getItem(base) ?? "";
  }
  let combined = "";
  for (let i = 0; ; i += 1) {
    const part = localStorage.getItem(`${base}.${i}`);
    if (part == null) break;
    combined += part;
  }
  return combined;
}

// When embedded in an app that already runs Supabase auth on the SAME project
// the worker verifies against, reuse that live session instead of opening our
// /auth popup. Scans localStorage for a persisted Supabase session under any
// storageKey (supabase-js: `sb-<ref>-auth-token`; @supabase/ssr / custom keys),
// handling both base64-wrapped values and chunked `<key>.N` storage.
export function hostSupabaseToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const bases = new Set<string>();
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) bases.add(key.replace(/\.\d+$/, ""));
    }
    for (const base of bases) {
      const raw = readStorageValue(base);
      if (!raw) continue;
      const text = decodeMaybeBase64(raw);
      if (!text.includes("access_token")) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const session = parsed?.currentSession ?? parsed;
      const access = session?.access_token;
      if (typeof access !== "string" || !access) continue;
      // expires_at is in seconds. Skip expired / near-expiry sessions.
      const expiresAt: number =
        typeof session?.expires_at === "number" ? session.expires_at * 1000 : decodeExpiry(access);
      if (expiresAt && expiresAt < Date.now() + 30000) continue;
      return access;
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
