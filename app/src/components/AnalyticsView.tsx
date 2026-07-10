import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Camera, CheckCircle2, FileText, Monitor, RefreshCw, ShieldAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  getReportAnalytics,
  subscribeReportChanges,
  type AnalyticsBreakdownItem,
  type AnalyticsTotals,
  type ProjectAnalytics,
  type ReportAnalytics,
} from "../api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { Progress } from "./ui/progress";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

interface Props {
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
}

const periodOptions = [
  { value: 7, label: "Last week" },
  { value: 14, label: "Last 2 weeks" },
  { value: 30, label: "Last month" },
  { value: 90, label: "Last quarter" },
] as const;

type PeriodDays = (typeof periodOptions)[number]["value"];

const chartConfig = {
  count: {
    label: "Reports",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function formatDate(value: string | null): string {
  if (!value) return "No reports";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function compactDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function percent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

function useAnimatedNumber(value: number, duration = 520): number {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);

  useEffect(() => {
    if (prefersReducedMotion || previousValue.current === value) {
      previousValue.current = value;
      setDisplayValue(value);
      return;
    }

    const from = previousValue.current;
    const to = value;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(from + (to - from) * eased);
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        previousValue.current = to;
        setDisplayValue(to);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, prefersReducedMotion, value]);

  return displayValue;
}

function AnimatedCount({ value }: { value: number }) {
  const displayValue = useAnimatedNumber(value);
  return <>{Math.round(displayValue).toLocaleString()}</>;
}

function AnimatedMetricValue({ value }: { value: number | string }) {
  if (typeof value === "number") return <AnimatedCount value={value} />;

  const pair = value.match(/^(\d+)\/(\d+)$/);
  if (pair) {
    return (
      <>
        <AnimatedCount value={Number(pair[1])} />
        /
        <AnimatedCount value={Number(pair[2])} />
      </>
    );
  }

  return <>{value}</>;
}

function delta(current: number, previous: number): string {
  const value = current - previous;
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value}`;
}

function initials(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "NA";
}

function faviconUrl(domain: string | null | undefined): string | undefined {
  if (!domain || domain === "No URL" || domain === "Invalid URL") return undefined;
  return `https://${domain}/favicon.ico`;
}

function rootDomain(value: string | null | undefined): string | null {
  if (!value || value === "No URL" || value === "Invalid URL") return null;
  const parts = value.split(".").filter(Boolean);
  if (parts.length < 2) return value;
  return parts.slice(-2).join(".");
}

function FaviconAvatar({
  domain,
  label,
  className,
  fallbackClassName,
}: {
  domain: string | null | undefined;
  label: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const sources = useMemo(() => {
    const exact = faviconUrl(domain);
    const root = rootDomain(domain);
    const rootSource = root && root !== domain ? faviconUrl(root) : undefined;
    return [exact, rootSource].filter((value): value is string => Boolean(value));
  }, [domain]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const src = sources[sourceIndex];

  useEffect(() => {
    setSourceIndex(0);
  }, [domain]);

  return (
    <Avatar className={className}>
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          onError={() => setSourceIndex((current) => current + 1)}
        />
      ) : null}
      <AvatarFallback className={fallbackClassName}>{initials(label)}</AvatarFallback>
    </Avatar>
  );
}

function statusPercent(project: Pick<ProjectAnalytics, "total" | "open" | "active" | "done">, key: "open" | "active" | "done"): number {
  if (project.total <= 0) return 0;
  return Math.max(0, (project[key] / project.total) * 100);
}

function StatCard({
  label,
  value,
  subtext,
  deltaText,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: number | string;
  subtext?: string;
  deltaText?: string;
  tone?: "neutral" | "positive" | "warning";
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="min-w-0 border-border/70 shadow-sm transition-transform active:scale-[0.99]">
      <CardContent className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
          <span
            className={cn(
              "grid size-8 place-items-center rounded-md",
              tone === "positive" && "bg-primary/10 text-primary",
              tone === "warning" && "bg-amber-500/10 text-amber-700",
              tone === "neutral" && "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <strong className="block min-w-0 overflow-wrap-anywhere text-3xl leading-none tracking-tight text-foreground tabular-nums">
            <AnimatedMetricValue value={value} />
          </strong>
          {subtext ? <small className="mt-1 block text-xs text-muted-foreground">{subtext}</small> : null}
        </div>
        {deltaText ? (
          <Badge variant="secondary" className="w-fit rounded-md px-2 py-0.5 text-[11px] font-medium">
            {deltaText}
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BreakdownList({
  title,
  items,
  total,
  variant = "default",
}: {
  title: string;
  items: AnalyticsBreakdownItem[];
  total: number;
  variant?: "default" | "reporter" | "domain";
}) {
  return (
    <Card className="min-w-0 border-border/70 shadow-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <Badge variant="secondary" className="rounded-md">{items.length}</Badge>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {items.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No data</p>
        ) : (
          <div className="grid gap-3">
            {items.map((item) => (
              <div className="grid gap-1.5" key={item.name}>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {variant === "reporter" ? (
                      <Avatar className="size-7 rounded-md">
                        <AvatarFallback className="rounded-md bg-primary/10 text-[10px] text-primary">{initials(item.name)}</AvatarFallback>
                      </Avatar>
                    ) : null}
                    {variant === "domain" ? (
                      <FaviconAvatar
                        domain={item.name}
                        label={item.name}
                        className="size-7 rounded-md"
                        fallbackClassName="rounded-md bg-muted text-[10px]"
                      />
                    ) : null}
                    <span className="truncate text-xs text-muted-foreground">{item.name.replace("_", " ")}</span>
                  </div>
                  <strong className="text-xs tabular-nums"><AnimatedCount value={item.count} /></strong>
                </div>
                <Progress value={total <= 0 ? 0 : (item.count / total) * 100} aria-hidden="true" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: ProjectAnalytics;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "grid w-full gap-2 rounded-lg border border-border/80 bg-card p-3 text-left text-foreground shadow-sm transition-colors hover:bg-muted/60 active:scale-[0.99]",
        selected && "border-primary bg-primary/5",
      )}
      type="button"
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FaviconAvatar
          domain={project.primaryDomain}
          label={project.project}
          className="size-9 rounded-md border border-border bg-background"
          fallbackClassName="rounded-md text-[11px]"
        />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm leading-tight">{project.project}</strong>
          <span className="block truncate text-xs text-muted-foreground">{project.primaryDomain ?? "No domain captured"}</span>
        </div>
        <Badge variant="secondary" className="rounded-md tabular-nums"><AnimatedCount value={project.total} /></Badge>
      </div>
      <div
        className="flex h-2.5 min-w-0 gap-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted)_58%,var(--card))]"
        aria-hidden="true"
      >
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--destructive)_36%,var(--background))]"
          style={{ width: `${statusPercent(project, "open")}%` }}
        />
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--warning)_46%,var(--background))]"
          style={{ width: `${statusPercent(project, "active")}%` }}
        />
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--primary)_38%,var(--background))]"
          style={{ width: `${statusPercent(project, "done")}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span><AnimatedCount value={project.open} /> open</span>
        <span className="text-center"><AnimatedCount value={project.active} /> active</span>
        <span className="text-right"><AnimatedCount value={project.done} /> done</span>
      </div>
    </button>
  );
}

function AllProjectsRow({
  totals,
  selected,
  onSelect,
}: {
  totals: AnalyticsTotals;
  selected: boolean;
  onSelect: () => void;
}) {
  const project = { total: totals.reports, open: totals.open, active: totals.active, done: totals.done };
  return (
    <button
      className={cn(
        "grid w-full gap-2 rounded-lg border border-border/80 bg-card p-3 text-left text-foreground shadow-sm transition-colors hover:bg-muted/60 active:scale-[0.99]",
        selected && "border-primary bg-primary/5",
      )}
      type="button"
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <Monitor className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm leading-tight">All projects</strong>
          <span className="block truncate text-xs text-muted-foreground"><AnimatedCount value={totals.projects} /> tracked projects</span>
        </div>
        <Badge variant="secondary" className="rounded-md tabular-nums"><AnimatedCount value={totals.reports} /></Badge>
      </div>
      <div
        className="flex h-2.5 min-w-0 gap-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted)_58%,var(--card))]"
        aria-hidden="true"
      >
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--destructive)_36%,var(--background))]"
          style={{ width: `${statusPercent(project, "open")}%` }}
        />
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--warning)_46%,var(--background))]"
          style={{ width: `${statusPercent(project, "active")}%` }}
        />
        <span
          className="min-w-[3px] rounded-full bg-[color-mix(in_oklch,var(--primary)_38%,var(--background))]"
          style={{ width: `${statusPercent(project, "done")}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
        <span><AnimatedCount value={totals.open} /> open</span>
        <span className="text-center"><AnimatedCount value={totals.active} /> active</span>
        <span className="text-right"><AnimatedCount value={totals.done} /> done</span>
      </div>
    </button>
  );
}

export function AnalyticsView({ isAdmin, getToken }: Props) {
  const [analytics, setAnalytics] = useState<ReportAnalytics | null>(null);
  const [selectedProject, setSelectedProject] = useState("all");
  const [periodDays, setPeriodDays] = useState<PeriodDays>(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const realtimeRefreshTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      const next = await getReportAnalytics(token, periodDays);
      setAnalytics(next);
      setSelectedProject((current) => (
        current === "all" || next.projects.some((project) => project.project === current)
          ? current
          : "all"
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [getToken, periodDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const scheduleLoad = () => {
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = window.setTimeout(() => {
        realtimeRefreshTimer.current = null;
        void load();
      }, 250);
    };

    void getToken().then((token) => {
      if (cancelled || !token) return;
      unsubscribe = subscribeReportChanges(token, {
        onChange: scheduleLoad,
        onOpen: () => setRealtimeConnected(true),
        onClose: () => setRealtimeConnected(false),
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (realtimeRefreshTimer.current) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
      setRealtimeConnected(false);
    };
  }, [getToken, load]);

  const selected = useMemo(() => {
    if (!analytics || selectedProject === "all") return null;
    return analytics.projects.find((project) => project.project === selectedProject) ?? null;
  }, [analytics, selectedProject]);

  const totals = analytics?.totals;
  const activeTotal = selected?.total ?? totals?.reports ?? 0;
  const activeStatus = selected?.byStatus ?? analytics?.byStatus ?? [];
  const activeSeverity = selected?.bySeverity ?? analytics?.bySeverity ?? [];
  const activeDomains = selected?.byDomain ?? analytics?.byDomain ?? [];
  const activeReporters = selected?.byReporter ?? analytics?.byReporter ?? [];
  const current = analytics?.periodTotals;
  const previous = analytics?.previousPeriodTotals;

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{isAdmin ? "Analytics" : "My analytics"}</h1>
          <p className="mt-1 max-w-[58ch] text-[13px] text-muted-foreground">Report volume, triage state, and evidence coverage by project.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={realtimeConnected ? "default" : "secondary"} className="rounded-md">
            <Activity className="mr-1 size-3" />
            {realtimeConnected ? "Live" : "Connecting"}
          </Badge>
          <Button size="icon" variant="outline" type="button" onClick={load} disabled={loading} aria-label="Refresh analytics">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <Tabs
        value={String(periodDays)}
        onValueChange={(value) => setPeriodDays(Number(value) as PeriodDays)}
        className="min-w-0 overflow-x-auto pb-1"
      >
        <TabsList className="inline-flex h-auto w-max min-w-max rounded-lg border border-border/70 bg-card p-1 shadow-sm">
          {periodOptions.map((option) => (
            <TabsTrigger
              key={option.value}
              value={String(option.value)}
              className="shrink-0 rounded-md px-3 py-2 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Analytics failed to load</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" type="button" onClick={load} disabled={loading}>Retry</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !analytics ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index}>
              <CardContent className="grid gap-3 p-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-5 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !analytics || analytics.totals.reports === 0 ? (
        <Card className="flex flex-col items-center gap-2.5 p-7 text-center">
          <CardContent className="p-4">
            <p className="text-[13px] text-muted-foreground">No report analytics yet. Project metrics will appear after reports are submitted.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Reports"
              value={analytics.totals.reports}
              subtext={`${analytics.totals.projects} projects`}
              deltaText={`${delta(current?.reports ?? 0, previous?.reports ?? 0)} last ${analytics.period.days}d`}
              icon={FileText}
            />
            <StatCard
              label="Open"
              value={analytics.totals.open}
              subtext={percent(analytics.totals.open, analytics.totals.reports)}
              deltaText={`${delta(current?.open ?? 0, previous?.open ?? 0)} in period`}
              tone="warning"
              icon={ShieldAlert}
            />
            <StatCard
              label="In progress"
              value={analytics.totals.active}
              subtext={percent(analytics.totals.active, analytics.totals.reports)}
              deltaText={`${delta(current?.active ?? 0, previous?.active ?? 0)} in period`}
              icon={Activity}
            />
            <StatCard
              label="Done"
              value={analytics.totals.done}
              subtext={percent(analytics.totals.done, analytics.totals.reports)}
              deltaText={`${delta(current?.done ?? 0, previous?.done ?? 0)} in period`}
              tone="positive"
              icon={CheckCircle2}
            />
            <StatCard
              label="With logs"
              value={analytics.totals.withLogs}
              subtext={percent(analytics.totals.withLogs, analytics.totals.reports)}
              deltaText={`${delta(current?.withLogs ?? 0, previous?.withLogs ?? 0)} in period`}
              icon={Monitor}
            />
            <StatCard
              label="Screenshots"
              value={analytics.totals.withScreenshots}
              subtext={percent(analytics.totals.withScreenshots, analytics.totals.reports)}
              deltaText={`${delta(current?.withScreenshots ?? 0, previous?.withScreenshots ?? 0)} in period`}
              icon={Camera}
            />
          </div>

          <div className="grid grid-cols-1 items-start gap-3 min-[821px]:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <Card className="grid gap-2 border-border/70 shadow-sm min-[821px]:sticky min-[821px]:top-[14px]">
              <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
                <CardTitle className="text-sm">Projects</CardTitle>
                <Badge variant="secondary" className="rounded-md">{analytics.projects.length}</Badge>
              </CardHeader>
              <CardContent className="grid gap-2 p-4 pt-0">
                <AllProjectsRow
                  totals={analytics.totals}
                  selected={selectedProject === "all"}
                  onSelect={() => setSelectedProject("all")}
                />
                {analytics.projects.map((project) => (
                  <ProjectRow
                    key={project.project}
                    project={project}
                    selected={selectedProject === project.project}
                    onSelect={() => setSelectedProject(project.project)}
                  />
                ))}
              </CardContent>
            </Card>

            <section className="grid min-w-0 gap-3">
              <Card className="border-border/70 shadow-sm">
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-primary">{selected ? "Project" : "Portfolio"}</span>
                    <h2 className="m-0 truncate text-xl font-semibold leading-tight">{selected?.project ?? "All projects"}</h2>
                    <p className="m-0 mt-1 text-[13px] text-muted-foreground">Last report: {formatDate(selected?.lastReportAt ?? analytics.totals.lastReportAt)}</p>
                  </div>
                  <div className="grid min-w-[min(360px,100%)] grid-cols-1 gap-2.5 min-[821px]:grid-cols-2">
                    <StatCard label="Reports" value={activeTotal} icon={FileText} />
                    <StatCard
                      label="Evidence"
                      value={`${selected?.withScreenshots ?? analytics.totals.withScreenshots}/${selected?.withLogs ?? analytics.totals.withLogs}`}
                      subtext="shots / logs"
                      icon={Camera}
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-3 min-[821px]:grid-cols-2">
                <BreakdownList title="Status" items={activeStatus} total={activeTotal} />
                <BreakdownList title="Severity" items={activeSeverity} total={activeTotal} />
                <BreakdownList title="Domains" items={activeDomains} total={activeTotal} variant="domain" />
                {isAdmin ? <BreakdownList title="Reporters" items={activeReporters} total={activeTotal} variant="reporter" /> : null}
              </div>

              <Card className="border-border/70 shadow-sm">
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 p-4 pb-2">
                  <div>
                    <CardTitle className="text-sm">Recent activity</CardTitle>
                    <CardDescription className="text-xs">
                      {analytics.period.currentStart} to {analytics.period.currentEnd}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="rounded-md">{analytics.period.days} days</Badge>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <ChartContainer config={chartConfig} className="h-[220px] w-full">
                    <BarChart accessibilityLayer data={analytics.recentTrend} margin={{ left: -24, right: 4, top: 12, bottom: 0 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={12}
                        tickFormatter={compactDate}
                      />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent labelFormatter={(value) => compactDate(String(value))} />}
                      />
                      <Bar dataKey="count" fill="var(--color-count)" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
