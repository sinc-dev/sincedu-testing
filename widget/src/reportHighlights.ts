export interface HighlightReportLike {
  title?: string | null;
  note?: string | null;
  status?: string | null;
  reporter_email?: string | null;
  created_at?: string | null;
}

export interface ReportHighlightTheme {
  border: string;
  fill: string;
  ring: string;
  bubble: string;
  chip: string;
}

export interface ReportHighlightView {
  theme: ReportHighlightTheme;
  count: number;
  countLabel: string;
  moreCount: number;
  moreLabel: string;
  bubbleText: string;
  popoverStatus: string;
  popoverCount: string;
  popoverReporter: string;
  popoverTitle: string;
  popoverNote: string;
  popoverDate: string;
}

export interface ReportAvatarView {
  key: string;
  label: string;
  initials: string;
  background: string;
  color: string;
}

export interface ReportReporterStack {
  avatars: ReportAvatarView[];
  extraCount: number;
  label: string;
}

const AVATAR_COLORS = [
  { background: "#0f766e", color: "#ffffff" },
  { background: "#1d4ed8", color: "#ffffff" },
  { background: "#7c3aed", color: "#ffffff" },
  { background: "#be123c", color: "#ffffff" },
  { background: "#b45309", color: "#ffffff" },
  { background: "#475569", color: "#ffffff" },
];

export function reportBubbleText(report: HighlightReportLike): string {
  const text = (report.note || report.title || "").replace(/\s+/g, " ").trim();
  return text || "Submitted bug report";
}

function reporterInitials(email: string): string {
  const local = email.split("@")[0] || email;
  const parts = local.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  }
  return local.slice(0, 2).toUpperCase() || "?";
}

function colorIndex(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % AVATAR_COLORS.length;
}

export function reportReporterStack(reports: HighlightReportLike[], limit = 3): ReportReporterStack {
  const seen = new Set<string>();
  const reporters: string[] = [];
  for (const report of reports) {
    const email = (report.reporter_email || "Unknown reporter").trim() || "Unknown reporter";
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    reporters.push(email);
  }

  const visible = reporters.slice(0, limit);
  const avatars = visible.map((email) => {
    const color = AVATAR_COLORS[colorIndex(email.toLowerCase())];
    return {
      key: email.toLowerCase(),
      label: email,
      initials: reporterInitials(email),
      background: color.background,
      color: color.color,
    };
  });
  const extraCount = Math.max(0, reporters.length - avatars.length);
  const label =
    reporters.length === 0
      ? "No reporters"
      : `Submitted by ${visible.join(", ")}${extraCount > 0 ? ` and ${extraCount} more` : ""}`;

  return { avatars, extraCount, label };
}

export function reportDateLabel(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function reportStatusLabel(report: HighlightReportLike): string {
  return (report.status || "open").replace("_", " ");
}

export function reportHighlightTheme(reports: HighlightReportLike[]): ReportHighlightTheme {
  const statuses = reports.map((report) => (report.status || "open").toLowerCase());
  if (statuses.includes("open")) {
    return {
      border: "#d97706",
      fill: "rgba(245,158,11,.14)",
      ring: "0 0 0 3px rgba(245,158,11,.22)",
      bubble: "#b45309",
      chip: "rgba(255,255,255,.20)",
    };
  }
  if (statuses.includes("in_progress") || statuses.includes("in progress")) {
    return {
      border: "#2563eb",
      fill: "rgba(37,99,235,.12)",
      ring: "0 0 0 3px rgba(37,99,235,.18)",
      bubble: "#1d4ed8",
      chip: "rgba(255,255,255,.20)",
    };
  }
  if (statuses.includes("resolved") || statuses.includes("fixed")) {
    return {
      border: "#059669",
      fill: "rgba(5,150,105,.12)",
      ring: "0 0 0 3px rgba(5,150,105,.18)",
      bubble: "#047857",
      chip: "rgba(255,255,255,.20)",
    };
  }
  return {
    border: "#6b7280",
    fill: "rgba(107,114,128,.12)",
    ring: "0 0 0 3px rgba(107,114,128,.18)",
    bubble: "#374151",
    chip: "rgba(255,255,255,.20)",
  };
}

export function reportHighlightView(reports: HighlightReportLike[], index: number): ReportHighlightView {
  const count = reports.length;
  const safeIndex = Math.max(0, Math.min(count - 1, index));
  const report = reports[safeIndex] || {};
  const moreCount = Math.max(0, count - 1);

  return {
    theme: reportHighlightTheme(reports),
    count,
    countLabel: String(count),
    moreCount,
    moreLabel: moreCount > 0 ? `+${moreCount} more` : "",
    bubbleText: reportBubbleText(reports[0] || report),
    popoverStatus: reportStatusLabel(report),
    popoverCount: count > 0 ? `${safeIndex + 1} / ${count}` : "0 / 0",
    popoverReporter: report.reporter_email || "Unknown reporter",
    popoverTitle: report.title || "Submitted bug report",
    popoverNote: reportBubbleText(report),
    popoverDate: reportDateLabel(report.created_at),
  };
}
