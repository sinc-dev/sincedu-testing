export interface WidgetConfig {
  apiBase: string;
  authUrl: string;
  project: string;
  mount: string | null;
  position: string;
  reviewUrl: string;
  // When "supabase", reuse the host app's existing Supabase session (same
  // project) instead of opening the /auth popup. Falls back to the popup if no
  // valid host session is found or it isn't accepted.
  hostAuth: string | null;
}

function scriptOrigin(scriptEl: HTMLScriptElement | null): string {
  if (scriptEl?.src) {
    try {
      return new URL(scriptEl.src).origin;
    } catch {
      /* fall through */
    }
  }
  return window.location.origin;
}

// Reads configuration from the <script> tag's data-* attributes.
// - apiBase defaults to the origin the widget.js was served from (the worker).
// - authUrl is the page on OUR domain that performs Supabase sign-in (so the
//   host app's domain never needs to be an auth redirect domain).
export function readConfig(scriptEl: HTMLScriptElement | null): WidgetConfig {
  const ds = scriptEl?.dataset ?? {};
  const apiBase = (ds.api || scriptOrigin(scriptEl)).replace(/\/$/, "");
  const reviewUrl = (ds.reviewUrl || "https://testing.sincedu.com").replace(/\/$/, "");
  const authUrl = (ds.authUrl || `${reviewUrl}/auth`).replace(/\/$/, "");
  return {
    apiBase,
    authUrl,
    project: ds.project || "default",
    mount: ds.mount || null,
    position: ds.position || "bottom-right",
    reviewUrl,
    hostAuth: ds.hostAuth || null,
  };
}
