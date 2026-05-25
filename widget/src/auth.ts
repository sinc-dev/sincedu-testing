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
