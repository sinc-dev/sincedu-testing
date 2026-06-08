import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseAnonKey || "placeholder", {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: "sincedu-testing-supabase-auth",
    flowType: "pkce",
  },
});

export function getAuthRedirectUrl(path = "/"): string {
  return `${window.location.origin}${path}`;
}

let oauthRedirectPromise: Promise<void> | null = null;

export async function completeOAuthRedirect(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  oauthRedirectPromise ??= (async () => {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const { data } = await supabase.auth.getSession();
      if (!data.session || !error.message.toLowerCase().includes("code verifier")) {
        throw error;
      }
    }

    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  })().finally(() => {
    oauthRedirectPromise = null;
  });

  return oauthRedirectPromise;
}
