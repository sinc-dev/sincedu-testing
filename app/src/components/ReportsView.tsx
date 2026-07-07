import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "src/lib/utils";
import { STATUS_PILL_STYLES } from "src/lib/status";
import { bulkPatchReports, getScreenshotPreview, listReports, patchReport, type ReportRow, type ScreenshotPreview } from "../api";
import { ReportDetail } from "./ReportDetail";
import { EmptyReports } from "./Illustrations";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const STATUSES = ["open", "investigating", "in_progress", "fixed", "resolved", "closed"];

// Reports table layout — Tailwind utilities on the shadcn primitives.
// `min-[900px]` is the desktop breakpoint; below it the status/reporter
// columns collapse into the stacked mobile fields inside the report cell.
const CX = {
  table: "min-w-0 table-fixed min-[900px]:min-w-[860px]",
  selectCell: "w-10 text-center",
  statusCell: "hidden w-[148px] min-[900px]:table-cell",
  reporterCell: "hidden w-[260px] max-w-[260px] truncate text-muted-foreground min-[900px]:table-cell",
  fixedByCell: "hidden w-[220px] max-w-[220px] truncate text-muted-foreground min-[900px]:table-cell",
  reportLayout:
    "grid grid-cols-[76px_minmax(0,1fr)] items-center gap-3 min-[900px]:grid-cols-[88px_minmax(0,1fr)] min-[900px]:gap-3.5",
  thumb: "block h-[50px] w-[76px] rounded-md border bg-muted object-cover min-[900px]:h-14 min-[900px]:w-[88px]",
  thumbPlaceholder:
    "inline-flex h-[50px] w-[76px] items-center justify-center rounded-md border border-dashed bg-muted/45 text-[11px] font-medium text-muted-foreground min-[900px]:h-14 min-[900px]:w-[88px]",
  reportOpen:
    "h-auto w-full justify-start whitespace-normal p-0 text-left font-medium leading-snug text-foreground line-clamp-2 hover:text-primary hover:underline underline-offset-[3px]",
  reportUrl: "mt-1 inline-block max-w-full truncate text-xs font-medium text-primary",
  reportMeta: "mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground",
  mobileFields: "mt-2 flex min-w-0 items-center gap-2.5 min-[900px]:hidden",
  mobileReporter: "min-w-0 truncate text-xs text-muted-foreground",
} as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const DONE_STATUSES = new Set(["fixed", "resolved", "closed"]);
const ACTIVE_STATUSES = new Set(["investigating", "in_progress"]);

type StatusFilter = "all" | "open" | "active" | "done";
type SeverityFilter = "all" | typeof SEVERITIES[number];
type EvidenceFilter = "all" | "logs" | "screenshots";

interface ReportFilters {
  status: StatusFilter;
  severity: SeverityFilter;
  evidence: EvidenceFilter;
  reporter: string;
  project: string;
  domains: string[];
}

const DEFAULT_FILTERS: ReportFilters = {
  status: "all",
  severity: "all",
  evidence: "all",
  reporter: "all",
  project: "all",
  domains: [],
};

interface Props {
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
}

function formatUrl(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function getDomain(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function readableError(message: string): string {
  if (message.includes("no such column: deleted_at")) {
    return "The reports database is missing the deleted_at migration. Apply migrations to the active worker database, then retry.";
  }
  return message;
}

function getPaginationItems(currentPage: number, totalPages: number): Array<number | "left-ellipsis" | "right-ellipsis"> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const items: Array<number | "left-ellipsis" | "right-ellipsis"> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) items.push("left-ellipsis");
  for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
    items.push(pageNumber);
  }
  if (end < totalPages - 1) items.push("right-ellipsis");
  items.push(totalPages);

  return items;
}

export function ReportsView({ isAdmin, getToken }: Props) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [thumbnailPreviews, setThumbnailPreviews] = useState<Record<string, ScreenshotPreview>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(25);
  const openReport = (id: string) => setSelected(id);
  const reporterOptions = [...new Set(reports.map((report) => report.reporter_email).filter(Boolean))].sort();
  const projectOptions = [...new Set(reports.map((report) => report.project).filter(Boolean))].sort();
  const domainOptions = [...new Set(reports.map((report) => getDomain(report.page_url)).filter(Boolean))].sort();
  const filterActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  const matchesStatus = (report: ReportRow, status: StatusFilter) => {
    if (status === "all") return true;
    if (status === "open") return report.status === "open";
    if (status === "active") return ACTIVE_STATUSES.has(report.status);
    return DONE_STATUSES.has(report.status);
  };

  const matchesEvidence = (report: ReportRow, evidence: EvidenceFilter) => {
    if (evidence === "all") return true;
    if (evidence === "logs") return report.console_count + report.network_count > 0;
    return Boolean(report.screenshot_key);
  };

  const matchesFilters = (report: ReportRow, activeFilters: ReportFilters) => (
    matchesStatus(report, activeFilters.status)
    && (activeFilters.severity === "all" || report.severity === activeFilters.severity)
    && matchesEvidence(report, activeFilters.evidence)
    && (activeFilters.reporter === "all" || report.reporter_email === activeFilters.reporter)
    && (activeFilters.project === "all" || report.project === activeFilters.project)
    && (activeFilters.domains.length === 0 || activeFilters.domains.includes(getDomain(report.page_url)))
  );

  const filteredReports = useMemo(() => reports.filter((report) => matchesFilters(report, filters)), [filters, reports]);
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * rowsPerPage;
  const pageEndIndex = Math.min(pageStartIndex + rowsPerPage, filteredReports.length);
  const pageItems = getPaginationItems(currentPage, totalPages);
  const paginatedReports = useMemo(
    () => filteredReports.slice(pageStartIndex, pageStartIndex + rowsPerPage),
    [filteredReports, pageStartIndex, rowsPerPage],
  );
  const visibleIds = paginatedReports.map((report) => report.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const selectedCount = selectedIds.size;
  const blockingError = Boolean(error && reports.length === 0 && !loading);

  const countForFilters = (nextFilters: ReportFilters) => (
    reports.filter((report) => matchesFilters(report, nextFilters)).length
  );
  const countFor = (patch: Partial<ReportFilters>) => countForFilters({ ...filters, ...patch });

  const toggleDomain = (domain: string) => {
    setFilters((current) => ({
      ...current,
      domains: current.domains.includes(domain)
        ? current.domains.filter((item) => item !== domain)
        : [...current.domains, domain].sort(),
    }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      setReports(await listReports(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [filters, rowsPerPage]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setSelectedIds((current) => {
      const reportIds = new Set(reports.map((report) => report.id));
      const next = new Set([...current].filter((id) => reportIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [reports]);

  const toggleReport = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisibleReports = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const updateStatus = async (report: ReportRow, status: string) => {
    if (status === report.status) return;

    const previous = report.status;
    setError("");
    setUpdatingStatus(report.id);
    setReports((current) => current.map((item) => item.id === report.id ? { ...item, status } : item));

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token");
      await patchReport(token, report.id, { status });
    } catch (err) {
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, status: previous } : item));
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingStatus(null);
    }
  };

  const bulkUpdateStatus = async (status: string) => {
    if (!status || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const previousReports = reports;
    setError("");
    setBulkBusy(true);
    setReports((current) => current.map((item) => ids.includes(item.id) ? { ...item, status } : item));

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token");
      await bulkPatchReports(token, { ids, status });
      setSelectedIds(new Set());
    } catch (err) {
      setReports(previousReports);
      setError(err instanceof Error ? err.message : "Failed to update selected reports");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const previousReports = reports;
    setError("");
    setBulkBusy(true);
    setReports((current) => current.filter((item) => !ids.includes(item.id)));

    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token");
      await bulkPatchReports(token, { ids, delete: true });
      setSelectedIds(new Set());
      if (selected && ids.includes(selected)) setSelected(null);
    } catch (err) {
      setReports(previousReports);
      setError(err instanceof Error ? err.message : "Failed to delete selected reports");
    } finally {
      setBulkBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const urls: string[] = [];

    setThumbnailPreviews((current) => {
      Object.values(current).forEach((preview) => URL.revokeObjectURL(preview.url));
      return {};
    });

    const screenshotReports = paginatedReports.filter((report) => report.screenshot_key);
    if (screenshotReports.length === 0) return undefined;

    (async () => {
      const token = await getToken();
      if (!token || !active) return;

      const entries = await Promise.all(
        screenshotReports.map(async (report) => {
          try {
            const preview = await getScreenshotPreview(token, report.id);
            urls.push(preview.url);
            return [report.id, preview] as const;
          } catch {
            return null;
          }
        }),
      );

      if (!active) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setThumbnailPreviews(Object.fromEntries(entries.filter((entry): entry is [string, ScreenshotPreview] => entry !== null)));
    })();

    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [paginatedReports, getToken]);

  const goToPage = (nextPage: number) => {
    setPage(Math.min(Math.max(nextPage, 1), totalPages));
  };

  const renderStatusControl = (report: ReportRow) => (
    isAdmin ? (
      <Select
        value={report.status}
        disabled={updatingStatus === report.id}
        onValueChange={(value) => void updateStatus(report, value)}
      >
        <SelectTrigger
          className={cn(
            "h-[30px] w-[124px] rounded-full px-2.5 text-xs font-medium capitalize disabled:cursor-wait",
            STATUS_PILL_STYLES[report.status],
          )}
          aria-label={`Update status for ${report.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((status) => (
            <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <Badge
        variant="outline"
        className={cn("rounded-full capitalize", STATUS_PILL_STYLES[report.status])}
      >
        {report.status.replace("_", " ")}
      </Badge>
    )
  );

  const paginationControls = filteredReports.length > 0 ? (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select
            value={String(rowsPerPage)}
            onValueChange={(value) => setRowsPerPage(Number(value))}
          >
            <SelectTrigger className="h-9 w-[118px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>{size} per page</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span>
          Showing {pageStartIndex + 1} to {pageEndIndex} of {filteredReports.length} entries
        </span>
      </div>
      <Pagination className="mx-0 w-auto justify-start md:justify-end">
        <PaginationContent className="flex-wrap justify-start">
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={currentPage === 1}
              tabIndex={currentPage === 1 ? -1 : undefined}
              className={currentPage === 1 ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                event.preventDefault();
                goToPage(currentPage - 1);
              }}
            />
          </PaginationItem>
          {pageItems.map((item) => (
            typeof item === "number" ? (
              <PaginationItem key={item}>
                <PaginationLink
                  href="#"
                  isActive={item === currentPage}
                  onClick={(event) => {
                    event.preventDefault();
                    goToPage(item);
                  }}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationEllipsis />
              </PaginationItem>
            )
          ))}
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={currentPage === totalPages}
              tabIndex={currentPage === totalPages ? -1 : undefined}
              className={currentPage === totalPages ? "pointer-events-none opacity-50" : undefined}
              onClick={(event) => {
                event.preventDefault();
                goToPage(currentPage + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  ) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{isAdmin ? "All reports" : "My reports"}</CardTitle>
        <Button variant="outline" size="icon" onClick={load} disabled={loading} aria-label="Refresh reports">
          <RefreshCw aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
      {selectedCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/35 p-2" aria-label="Bulk report actions">
          <strong>{selectedCount} selected</strong>
          {isAdmin ? (
            <Select
              value=""
              disabled={bulkBusy}
              onValueChange={(value) => void bulkUpdateStatus(value)}
            >
              <SelectTrigger className="w-[170px]" aria-label="Bulk update status"><SelectValue placeholder="Set status…" /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="destructive" type="button" disabled={bulkBusy} onClick={() => void bulkDelete()}>
            {bulkBusy ? "Working…" : "Delete"}
          </Button>
          <Button variant="outline" type="button" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}
      <div className="mb-2 text-sm text-muted-foreground">
        {filteredReports.length === reports.length
          ? `${reports.length} reports`
          : `${filteredReports.length} of ${reports.length} reports`}
      </div>
      <div className="mb-3 flex flex-nowrap gap-2 overflow-x-auto pb-2" aria-label="Report filters">
        {filterActive ? (
          <Button className="shrink-0" variant="outline" type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear
          </Button>
        ) : null}
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters((current) => ({ ...current, status: value as StatusFilter }))}
        >
          <SelectTrigger className="w-[180px] shrink-0" aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status: All</SelectItem>
            <SelectItem value="open">Status: Open</SelectItem>
            <SelectItem value="active">Status: In progress</SelectItem>
            <SelectItem value="done">Status: Done</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.severity}
          onValueChange={(value) => setFilters((current) => ({ ...current, severity: value as SeverityFilter }))}
        >
          <SelectTrigger className="w-[190px] shrink-0" aria-label="Filter by severity"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Severity: All</SelectItem>
            {SEVERITIES.map((severity) => (
              <SelectItem key={severity} value={severity}>
                Severity: {severity}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.evidence}
          onValueChange={(value) => setFilters((current) => ({ ...current, evidence: value as EvidenceFilter }))}
        >
          <SelectTrigger className="w-[230px] shrink-0" aria-label="Filter by evidence"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Evidence: All</SelectItem>
            <SelectItem value="logs">Evidence: Has logs</SelectItem>
            <SelectItem value="screenshots">Evidence: Has screenshot</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={filters.project}
          onValueChange={(value) => setFilters((current) => ({ ...current, project: value }))}
        >
          <SelectTrigger className="w-[210px] shrink-0" aria-label="Filter by project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Project: All</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project} value={project}>
                {project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="shrink-0" variant="outline">
              Domain: {filters.domains.length === 0 ? "All" : `${filters.domains.length} selected`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {domainOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No domains</div>
            ) : (
              domainOptions.map((domain) => (
                <DropdownMenuCheckboxItem
                  key={domain}
                  checked={filters.domains.includes(domain)}
                  onCheckedChange={() => toggleDomain(domain)}
                >
                  <span className="truncate">{domain}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {countFor({ domains: [domain] })}
                  </span>
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {isAdmin ? (
          <Select
            value={filters.reporter}
            onValueChange={(value) => setFilters((current) => ({ ...current, reporter: value }))}
          >
            <SelectTrigger className="w-[260px] shrink-0" aria-label="Filter by reporter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Reporter: All</SelectItem>
              {reporterOptions.map((reporter) => (
                <SelectItem key={reporter} value={reporter}>
                  {reporter}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {error ? (
        <Alert variant="destructive" className="my-3 flex items-start justify-between gap-3">
          <div>
            <AlertTitle>{blockingError ? "Reports failed to load" : "Action failed"}</AlertTitle>
            <AlertDescription>{readableError(error)}</AlertDescription>
          </div>
          <Button variant="outline" type="button" onClick={load} disabled={loading}>
            Retry
          </Button>
        </Alert>
      ) : null}
      {loading ? (
        <div aria-label="Loading reports">
          <Table className={CX.table} aria-hidden="true">
            <TableHeader>
              <TableRow>
                <TableHead className={CX.selectCell} aria-label="Select reports"></TableHead>
                <TableHead>Report</TableHead>
                <TableHead className={CX.statusCell}>Status</TableHead>
                {isAdmin ? <TableHead className={CX.reporterCell}>Reporter</TableHead> : null}
                {isAdmin ? <TableHead className={CX.fixedByCell}>Fixed by</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell><Skeleton className="h-5 w-5 rounded-sm" /></TableCell>
                  <TableCell>
                    <div className={CX.reportLayout}>
                      <Skeleton className="h-[54px] w-[86px] rounded-md" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                  </TableCell>
                  <TableCell className={CX.statusCell}><Skeleton className="h-7 w-24 rounded-full" /></TableCell>
                  {isAdmin ? <TableCell className={CX.reporterCell}><Skeleton className="h-4 w-40" /></TableCell> : null}
                  {isAdmin ? <TableCell className={CX.fixedByCell}><Skeleton className="h-4 w-32" /></TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : blockingError ? null : reports.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 p-7 text-center">
          <EmptyReports />
          <p className="text-[13px] text-muted-foreground">No reports yet. Use the crosshair in any app's bar to file the first one.</p>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 p-7 text-center">
          <EmptyReports />
          <p className="text-[13px] text-muted-foreground">No matching reports for this filter.</p>
        </div>
      ) : (
        <div aria-label="Reports table">
          <Table className={CX.table}>
            <TableHeader>
              <TableRow>
                <TableHead className={CX.selectCell}>
                  <Checkbox
                    aria-label={allVisibleSelected ? "Deselect visible reports" : "Select visible reports"}
                    checked={visibleSelectedCount > 0 && !allVisibleSelected ? "indeterminate" : allVisibleSelected}
                    onCheckedChange={toggleVisibleReports}
                  />
                </TableHead>
                <TableHead>Report</TableHead>
                <TableHead className={CX.statusCell}>Status</TableHead>
                {isAdmin ? <TableHead className={CX.reporterCell}>Reporter</TableHead> : null}
                {isAdmin ? <TableHead className={CX.fixedByCell}>Fixed by</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedReports.map((r, index) => (
                <TableRow key={r.id} className={cn(index % 2 === 1 && "bg-muted/40")}>
                  <TableCell className={CX.selectCell} onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select report ${r.title}`}
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => toggleReport(r.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className={CX.reportLayout}>
                      <div>
                        {thumbnailPreviews[r.id]?.isImage ? (
                          <img className={CX.thumb} src={thumbnailPreviews[r.id].url} alt="" />
                        ) : (
                          <span className={CX.thumbPlaceholder}>{r.screenshot_key ? (thumbnailPreviews[r.id] ? "File" : "Loading") : "No shot"}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <Button
                          className={CX.reportOpen}
                          variant="link"
                          onClick={(event) => {
                            event.stopPropagation();
                            openReport(r.id);
                          }}
                        >
                          {r.title}
                        </Button>
                        {r.page_url ? (
                          <a
                            className={CX.reportUrl}
                            href={r.page_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {formatUrl(r.page_url)}
                          </a>
                        ) : null}
                        <div className={CX.reportMeta}>
                          <span>{r.project}</span>
                          {r.severity ? <span>{r.severity}</span> : null}
                          <span>{r.console_count}c / {r.network_count}n</span>
                          <span>{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                        <div className={CX.mobileFields}>
                          {renderStatusControl(r)}
                          {isAdmin ? <span className={CX.mobileReporter}>{r.reporter_email}</span> : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={CX.statusCell}>
                    {renderStatusControl(r)}
                  </TableCell>
                  {isAdmin ? <TableCell className={CX.reporterCell}>{r.reporter_email}</TableCell> : null}
                  {isAdmin ? <TableCell className={CX.fixedByCell}>{r.fixed_by_email ?? "—"}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {paginationControls}

      {selected ? (
        <ReportDetail
          id={selected}
          isAdmin={isAdmin}
          getToken={getToken}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}
      </CardContent>
    </Card>
  );
}
