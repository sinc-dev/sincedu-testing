import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import { getAccess, type AccessInfo } from "./api";
import { ReportsView } from "./components/ReportsView";
import { AllowlistView } from "./components/AllowlistView";
import { McpView } from "./components/McpView";
import { HeroPicker, IconCapture, IconNote, IconPick, IconReview } from "./components/Illustrations";

const STEPS = [
  { icon: <IconPick />, label: "Pick element" },
  { icon: <IconNote />, label: "Note at cursor" },
  { icon: <IconCapture />, label: "Auto-capture" },
  { icon: <IconReview />, label: "Review" },
];

export default function App() {
  const { user, ready, error: authError, signIn, signOut, getToken } = useAuth();
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [accessError, setAccessError] = useState("");
  const [signInError, setSignInError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [section, setSection] = useState<"reports" | "mcp" | "allowlist">("reports");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const tokenGetter = useCallback(() => getToken(), [getToken]);
  const chooseSection = useCallback((next: "reports" | "mcp" | "allowlist") => {
    setSection(next);
    setMobileNavOpen(false);
  }, []);
  const handleSignIn = useCallback(async () => {
    setSignInError("");
    setIsSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      setIsSigningIn(false);
      setSignInError(err instanceof Error ? err.message : "Unable to start Google sign-in");
    }
  }, [signIn]);

  useEffect(() => {
    if (!authError) return;
    setIsSigningIn(false);
    setSignInError(authError);
  }, [authError]);

  useEffect(() => {
    if (!user) {
      setAccess(null);
      setIsSigningIn(false);
      setUserMenuOpen(false);
      setMobileNavOpen(false);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        setAccess(await getAccess(token));
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : "Failed to check access");
      }
    })();
  }, [user, getToken]);

  if (!ready) return <div className="center"><p className="muted">Loading…</p></div>;

  if (!user) {
    return (
      <div className="center">
        <div className="signin">
          <HeroPicker className="hero-illustration" />
          <h1>SINC EDU · Testing</h1>
          <p className="muted">Pick an element, leave a note, and we capture the screenshot and logs. Sign in to file and review reports.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => void handleSignIn()} disabled={isSigningIn}>
            {isSigningIn ? "Redirecting to Google..." : "Sign in with Google"}
          </button>
          {signInError ? <p style={{ color: "#dc2626" }}>{signInError}</p> : null}

          <div className="how">
            {STEPS.map((step) => (
              <span className="step" key={step.label}>
                {step.icon}
                <span className="step-title">{step.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          {access?.isTester ? (
            <button
              className="nav-drawer-toggle"
              type="button"
              aria-label="Open testing navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <span aria-hidden="true">☰</span>
            </button>
          ) : null}
          <span className="brand">SINC EDU · Testing</span>
        </div>
        <div className="right user-menu-wrap" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setUserMenuOpen(false);
        }}>
          <button
            className="user-menu-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            <span className="avatar" aria-hidden="true">{user.email?.[0]?.toUpperCase() || "U"}</span>
            <span className="user-menu-label">{user.email}</span>
            <span aria-hidden="true">⌄</span>
          </button>
          {userMenuOpen ? (
            <div className="user-menu" role="menu">
              <div className="user-menu-email">{user.email}</div>
              <button
                className="user-menu-item"
                type="button"
                role="menuitem"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {access?.isTester && mobileNavOpen ? (
        <button
          className="nav-drawer-backdrop"
          type="button"
          aria-label="Close testing navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div className="container">
        {accessError ? <p style={{ color: "#dc2626" }}>{accessError}</p> : null}
        {!access ? (
          <p className="muted">Checking access…</p>
        ) : !access.isTester ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Not a tester</h3>
            <p className="muted">Your account ({user.email}) isn't on the tester allowlist. Ask an admin to add you.</p>
          </div>
        ) : (
          <>
            <div className="portal-shell">
              <aside className={`side-nav ${mobileNavOpen ? "open" : ""}`} aria-label="Testing navigation">
                <div className="nav-drawer-header">
                  <strong>Navigation</strong>
                  <button
                    className="icon-btn drawer-close"
                    type="button"
                    aria-label="Close testing navigation"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <button
                  className={`side-nav-item ${section === "reports" ? "active" : ""}`}
                  onClick={() => chooseSection("reports")}
                  title="Reports"
                  aria-label="Reports"
                >
                  <span className="side-nav-icon" aria-hidden="true">□</span>
                  <span>Reports</span>
                </button>
                <button
                  className={`side-nav-item ${section === "mcp" ? "active" : ""}`}
                  onClick={() => chooseSection("mcp")}
                  title="MCP access"
                  aria-label="MCP access"
                >
                  <span className="side-nav-icon" aria-hidden="true">⌁</span>
                  <span>MCP access</span>
                </button>
                {access.isAdmin ? (
                  <button
                    className={`side-nav-item ${section === "allowlist" ? "active" : ""}`}
                    onClick={() => chooseSection("allowlist")}
                    title="Allowlist"
                    aria-label="Allowlist"
                  >
                    <span className="side-nav-icon" aria-hidden="true">+</span>
                    <span>Allowlist</span>
                  </button>
                ) : null}
              </aside>

              <main className="portal-main">
                {section === "reports" ? (
                  <ReportsView isAdmin={access.isAdmin} getToken={tokenGetter} />
                ) : section === "mcp" ? (
                  <McpView getToken={tokenGetter} />
                ) : access.isAdmin ? (
                  <AllowlistView getToken={tokenGetter} />
                ) : null}
              </main>
            </div>
          </>
        )}
      </div>
    </>
  );
}
