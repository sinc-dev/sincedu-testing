import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { completeOAuthRedirect, getAuthRedirectUrl, hasSupabaseConfig, supabase } from "./supabase";

function getUserName(user: User | null): string | null {
  if (!user) return null;
  const name = user.user_metadata?.full_name || user.user_metadata?.name;
  return typeof name === "string" && name.trim() ? name : null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void completeOAuthRedirect()
      .then(() => supabase.auth.getSession())
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) setError(sessionError.message);
        setUser(data.session?.user ?? null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to check sign-in");
      })
      .finally(() => {
        if (active) setReady(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
      if (session?.user) setError("");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(() => {
    setError("");
    if (!hasSupabaseConfig) {
      return Promise.reject(new Error("Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."));
    }
    return supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthRedirectUrl("/"),
        queryParams: { prompt: "select_account" },
      },
    }).then(({ error: signInError }) => {
      if (signInError) throw signInError;
    });
  }, []);

  const signOutUser = useCallback(() => {
    setError("");
    return supabase.auth.signOut().then(({ error: signOutError }) => {
      if (signOutError) throw signOutError;
    });
  }, []);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  return {
    user,
    ready,
    error,
    name: getUserName(user),
    signIn,
    signOut: signOutUser,
    getToken,
  };
}
