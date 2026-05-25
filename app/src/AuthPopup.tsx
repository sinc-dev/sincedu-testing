import { useEffect, useState } from "react";
import { completeOAuthRedirect, getAuthRedirectUrl, hasSupabaseConfig, supabase } from "./supabase";

const MESSAGE_TYPE = "sincedu-tester-auth";

function isValidOrigin(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Runs inside the popup opened by the widget. Signs the tester in with Supabase
// and posts the access token back to the widget's opener window, so the host
// app's domain is never involved in auth redirects.
export function AuthPopup() {
  const [phase, setPhase] = useState<"working" | "signin" | "error">("working");
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("o");
    const isSignout = params.get("signout") === "1";

    if (!isValidOrigin(target)) {
      setPhase("error");
      setMessage("Missing or invalid opener origin.");
      return;
    }

    void (async () => {
      if (!hasSupabaseConfig) {
        setPhase("error");
        setMessage("Missing Supabase auth configuration.");
        return;
      }

      if (isSignout) {
        await supabase.auth.signOut().catch(() => undefined);
        window.opener?.postMessage({ type: `${MESSAGE_TYPE}-signout` }, target);
        window.close();
        return;
      }

      await completeOAuthRedirect();
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setPhase("error");
        setMessage(error.message);
        return;
      }

      if (data.session?.access_token) {
        window.opener?.postMessage(
          { type: MESSAGE_TYPE, token: data.session.access_token, email: data.session.user.email },
          target,
        );
        window.close();
        return;
      }

      setPhase("signin");
      setMessage("Sign in to file tester reports.");
    })().catch((err: unknown) => {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Unable to complete sign-in.");
    });
  }, []);

  return (
    <div className="center">
      <h2>SINC EDU · Testing</h2>
      <p className="muted">{message}</p>
      {phase === "signin" ? (
        <button
          className="btn"
          onClick={() => {
            const target = new URLSearchParams(window.location.search).get("o") || "";
            void supabase.auth.signInWithOAuth({
              provider: "google",
              options: {
                redirectTo: `${getAuthRedirectUrl("/auth")}?o=${encodeURIComponent(target)}`,
                queryParams: { prompt: "select_account" },
              },
            });
          }}
        >
          Sign in with Google
        </button>
      ) : null}
    </div>
  );
}

export default AuthPopup;
