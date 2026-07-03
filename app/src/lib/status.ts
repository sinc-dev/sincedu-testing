// Shared status → pill styling used by the reports and allowlist tables.
// Tailwind utilities on the theme tokens (see tailwind.config.js).
export const STATUS_PILL_STYLES: Record<string, string> = {
  open: "text-destructive bg-destructive/10 border-destructive/35",
  investigating: "text-warning bg-warning/15 border-warning/40",
  in_progress: "text-warning bg-warning/15 border-warning/40",
  fixed: "text-primary bg-primary/10 border-primary/35",
  resolved: "text-primary bg-primary/10 border-primary/35",
  closed: "text-primary bg-primary/10 border-primary/35",
};
