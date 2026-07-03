import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Grid2X2, Menu, MousePointer2, Plug, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./useAuth";
import { getAccess, type AccessInfo } from "./api";
import { ReportsView } from "./components/ReportsView";
import { AllowlistView } from "./components/AllowlistView";
import { McpView } from "./components/McpView";
import { AnalyticsView } from "./components/AnalyticsView";
import { WidgetPreview } from "./components/WidgetPreview";
import { HeroPicker, IconCapture, IconNote, IconPick, IconReview } from "./components/Illustrations";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./components/ui/sheet";
import { Toaster } from "./components/ui/sonner";
import { cn } from "src/lib/utils";

const STEPS = [
  { icon: <IconPick />, label: "Pick element" },
  { icon: <IconNote />, label: "Note at cursor" },
  { icon: <IconCapture />, label: "Auto-capture" },
  { icon: <IconReview />, label: "Review" },
];

type Section = "dashboard" | "reports" | "preview" | "mcp" | "allowlist";

const SECTION_PATHS: Record<Section, string> = {
  dashboard: "/analytics",
  reports: "/reports",
  preview: "/preview",
  mcp: "/mcp",
  allowlist: "/allowlist",
};

function sectionFromPath(pathname: string): Section {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/") return "reports";
  if (normalized === "/dashboard" || normalized === "/analytics") return "dashboard";
  if (normalized === "/reports") return "reports";
  if (normalized === "/preview" || normalized === "/widget-preview") return "preview";
  if (normalized === "/mcp") return "mcp";
  if (normalized === "/allowlist") return "allowlist";
  return "reports";
}

export default function App() {
  const { user, ready, error: authError, signIn, signOut, getToken } = useAuth();
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [accessError, setAccessError] = useState("");
  const [signInError, setSignInError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [section, setSection] = useState<Section>(() => sectionFromPath(window.location.pathname));
  const lastAccessToastRef = useRef("");

  const tokenGetter = useCallback(() => getToken(), [getToken]);
  const checkAccess = useCallback(async () => {
    if (!user) return;
    try {
      setAccessError("");
      const token = await getToken();
      if (!token) return;
      const nextAccess = await getAccess(token);
      setAccess(nextAccess);
      lastAccessToastRef.current = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check access";
      setAccessError(message);
      if (lastAccessToastRef.current !== message) {
        toast.error("Access check failed", { description: message });
        lastAccessToastRef.current = message;
      }
    }
  }, [user, getToken]);
  const chooseSection = useCallback((next: Section) => {
    setSection(next);
    const nextPath = SECTION_PATHS[next];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ section: next }, "", nextPath);
    }
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
    const syncFromPath = () => setSection(sectionFromPath(window.location.pathname));
    window.addEventListener("popstate", syncFromPath);
    return () => window.removeEventListener("popstate", syncFromPath);
  }, []);

  useEffect(() => {
    if (!user) {
      setAccess(null);
      setIsSigningIn(false);
      setAccessError("");
      lastAccessToastRef.current = "";
      return;
    }
    void checkAccess();
  }, [user, checkAccess]);

  useEffect(() => {
    if (!ready || !user) return;
    const expectedPath = SECTION_PATHS[section];
    if (window.location.pathname === "/" || window.location.pathname === "/dashboard") {
      window.history.replaceState({ section }, "", expectedPath);
    }
  }, [ready, user, section]);

  useEffect(() => {
    if (!access || access.isAdmin || section !== "allowlist") return;
    chooseSection("reports");
  }, [access, section, chooseSection]);

  if (!ready)
    return (
      <>
        <Toaster richColors />
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-[32px_20px] text-center">
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        </div>
      </>
    );

  if (!user) {
    return (
      <>
        <Toaster richColors />
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 p-[32px_20px] text-center">
          <Card className="mx-auto max-w-[880px] border-0 bg-transparent shadow-none">
            <CardContent className="p-0 text-center">
              <HeroPicker className="mx-auto my-[4px_0_8px] h-auto w-[min(360px,90vw)] drop-shadow-md" />
              <CardTitle className="text-[34px] leading-tight">SINC EDU · Testing</CardTitle>
              <CardDescription className="mx-auto mt-2 max-w-[620px]">
                Pick an element, leave a note, and we capture the screenshot and logs. Sign in to file and review reports.
              </CardDescription>
              <Button className="mt-4" onClick={() => void handleSignIn()} disabled={isSigningIn}>
                {isSigningIn ? "Redirecting to Google..." : "Sign in with Google"}
              </Button>
              {signInError ? (
                <Alert variant="destructive" className="mt-4 text-left">
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{signInError}</AlertDescription>
                </Alert>
              ) : null}

              <div className="mt-[28px] flex flex-wrap items-center justify-center gap-y-[6px]">
                {STEPS.map((step) => (
                  <span
                    className="inline-flex items-center gap-[7px] before:mx-[10px] before:text-[15px] before:text-muted-foreground before:opacity-45 before:content-[''] first:before:hidden [&:not(:first-child)]:before:content-['›']"
                    key={step.label}
                  >
                    {step.icon}
                    <span className="text-[13px] font-medium text-muted-foreground">{step.label}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const navItems = [
    { section: "dashboard" as const, label: "Dashboard", icon: <Grid2X2 size={15} /> },
    { section: "reports" as const, label: "Reports", icon: <FileText size={15} /> },
    { section: "preview" as const, label: "Widget preview", icon: <MousePointer2 size={15} /> },
    { section: "mcp" as const, label: "MCP access", icon: <Plug size={15} /> },
    ...(access?.isAdmin ? [{ section: "allowlist" as const, label: "Allowlist", icon: <UserPlus size={15} /> }] : []),
  ];

  const renderNavigation = (closeOnSelect = false) => (
    <>
      {navItems.map((item) => {
        const isActive = section === item.section;
        const button = (
          <Button
            key={item.section}
            className={cn(
              "grid h-auto w-full min-h-[38px] grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-md border border-transparent bg-transparent py-[6px] pl-[6px] pr-[9px] text-left text-[13px] font-semibold text-foreground hover:bg-muted",
              isActive &&
                "border-[color-mix(in_oklch,var(--primary)_32%,var(--border))] bg-[color-mix(in_oklch,var(--accent)_55%,var(--card))] text-accent-foreground hover:bg-[color-mix(in_oklch,var(--accent)_55%,var(--card))]",
            )}
            onClick={() => chooseSection(item.section)}
            variant="ghost"
            title={item.label}
            aria-label={item.label}
          >
            <span
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-sm bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] font-bold text-primary",
                isActive && "bg-primary text-primary-foreground",
              )}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <span>{item.label}</span>
          </Button>
        );
        return closeOnSelect ? (
          <SheetClose key={item.section} asChild>
            {button}
          </SheetClose>
        ) : (
          button
        );
      })}
    </>
  );

  const navigation = renderNavigation();

  return (
    <>
      <Toaster richColors />
      <div className="sticky top-0 z-[80] flex items-center justify-between gap-[10px] bg-primary px-[14px] py-3 text-primary-foreground shadow-sm min-[821px]:gap-0 min-[821px]:px-6 min-[821px]:py-[14px]">
        <div className="flex min-w-0 flex-1 items-center gap-[10px] min-[821px]:flex-none">
          {access?.isTester ? (
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color-mix(in_oklch,var(--primary-foreground)_28%,transparent)] bg-[color-mix(in_oklch,var(--primary-foreground)_12%,transparent)] text-[18px] text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary-foreground)_18%,transparent)] hover:text-primary-foreground min-[821px]:hidden"
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open testing navigation"
                >
                  <Menu size={18} aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[290px] p-3">
                <SheetHeader className="mb-3 text-left">
                  <SheetTitle>SINC Testing</SheetTitle>
                </SheetHeader>
                <nav className="grid gap-1" aria-label="Testing navigation">
                  {renderNavigation(true)}
                </nav>
              </SheetContent>
            </Sheet>
          ) : null}
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-bold tracking-[0.01em] min-[821px]:min-w-[auto] min-[821px]:overflow-visible">
            SINC EDU · Testing
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-3 text-[14px]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="inline-flex h-auto max-w-[min(360px,52vw)] items-center gap-2 rounded-full border border-[color-mix(in_oklch,var(--primary-foreground)_26%,transparent)] bg-[color-mix(in_oklch,var(--primary-foreground)_12%,transparent)] py-1 pl-1 pr-2 text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary-foreground)_18%,transparent)] hover:text-primary-foreground"
                type="button"
                variant="ghost"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary-foreground font-bold text-primary">
                    {user.email?.[0]?.toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{user.email}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {user.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void signOut()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mx-auto max-w-[1240px] p-3 min-[821px]:px-[18px] min-[821px]:py-[14px]">
        {!access && accessError ? (
          <Card>
            <CardHeader>
              <CardTitle>Could not confirm access</CardTitle>
              <CardDescription>{accessError}</CardDescription>
              <div>
                <Button variant="outline" onClick={() => void checkAccess()}>Retry</Button>
              </div>
            </CardHeader>
          </Card>
        ) : !access ? (
          <p className="text-[13px] text-muted-foreground">Checking access…</p>
        ) : !access.isTester ? (
          <Card>
            <CardHeader>
              <CardTitle>Not a tester</CardTitle>
              <CardDescription>Your account ({user.email}) isn't on the tester allowlist. Ask an admin to add you.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-[1fr] items-start gap-[14px] min-[821px]:grid-cols-[190px_minmax(0,1fr)]">
              <aside
                className="hidden gap-[6px] rounded-lg border border-border bg-[color-mix(in_oklch,var(--card)_82%,var(--muted))] p-2 shadow-sm min-[821px]:sticky min-[821px]:top-[90px] min-[821px]:grid"
                aria-label="Testing navigation"
              >
                {navigation}
              </aside>

              <main className="min-w-0">
                {section === "dashboard" ? (
                  <AnalyticsView isAdmin={access.isAdmin} getToken={tokenGetter} />
                ) : section === "reports" ? (
                  <ReportsView isAdmin={access.isAdmin} getToken={tokenGetter} />
                ) : section === "preview" ? (
                  <WidgetPreview />
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
