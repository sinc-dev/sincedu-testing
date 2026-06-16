import { useCallback, useEffect, useMemo, useState } from "react";
import { bulkPatchReports, getScreenshotPreview, listReports, patchReport, type ReportRow, type ScreenshotPreview } from "../api";
import { ReportDetail } from "./ReportDetail";
import { EmptyReports } from "./Illustrations";

const STATUSES = ["open", "investigating", "in_progress", "fixed", "resolved", "closed"];
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const DONE_STATUSES = new Set(["fixed", "resolved", "closed"]);
const ACTIVE_STATUSES = new Set(["investigating", "in_progress"]);
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

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

  const filteredReports = useMemo(() => reports.filter((report) => (
    matchesStatus(report, filters.status)
    && (filters.severity === "all" || report.severity === filters.severity)
    && matchesEvidence(report, filters.evidence)
    && (filters.reporter === "all" || report.reporter_email === filters.reporter)
    && (filters.project === "all" || report.project === filters.project)
    && (filters.domains.length === 0 || filters.domains.includes(getDomain(report.page_url)))
  )), [filters, reports]);
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * rowsPerPage;
  const paginatedReports = useMemo(
    () => filteredReports.slice(pageStartIndex, pageStartIndex + rowsPerPage),
    [filteredReports, pageStartIndex, rowsPerPage],
  );
  const pageStartLabel = filteredReports.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndLabel = Math.min(pageStartIndex + rowsPerPage, filteredReports.length);
  const visibleIds = paginatedReports.map((report) => report.id);
  const visibleSelectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected = visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
  const selectedCount = selectedIds.size;
  const blockingError = Boolean(error && reports.length === 0 && !loading);

  const countWhere = (matches: (report: ReportRow) => boolean) => reports.filter(matches).length;

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

  const paginationControls = filteredReports.length > 0 ? (
    <div className="pagination-bar" aria-label="Report pagination">
      <div className="pagination-summary">
        <strong>{pageStartLabel}-{pageEndLabel}</strong>
        <span>of {filteredReports.length}</span>
        {filteredReports.length !== reports.length ? <span>filtered from {reports.length}</span> : null}
      </div>
      <label className="rows-control">
        <span>Rows</span>
        <select
          value={rowsPerPage}
          aria-label="Rows per page"
          onChange={(event) => setRowsPerPage(Number(event.target.value))}
        >
          {ROWS_PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <div className="page-controls">
        <button className="page-btn" type="button" onClick={() => goToPage(1)} disabled={currentPage === 1} aria-label="First page">«</button>
        <button className="page-btn" type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page">‹</button>
        <span className="page-count">Page {currentPage} of {totalPages}</span>
        <button className="page-btn" type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page">›</button>
        <button className="page-btn" type="button" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} aria-label="Last page">»</button>
      </div>
    </div>
  ) : null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{isAdmin ? "All reports" : "My reports"}</h3>
        <button className="btn ghost" onClick={load} disabled={loading}>Refresh</button>
      </div>
      {selectedCount > 0 ? (
        <div className="bulk-bar" aria-label="Bulk report actions">
          <strong>{selectedCount} selected</strong>
          {isAdmin ? (
            <select
              className="bulk-select"
              value=""
              disabled={bulkBusy}
              aria-label="Bulk update status"
              onChange={(event) => {
                void bulkUpdateStatus(event.target.value);
                event.currentTarget.value = "";
              }}
            >
              <option value="">Set status…</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>{status.replace("_", " ")}</option>
              ))}
            </select>
          ) : null}
          <button className="btn danger" type="button" disabled={bulkBusy} onClick={() => void bulkDelete()}>
            {bulkBusy ? "Working…" : "Delete"}
          </button>
          <button className="btn ghost" type="button" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}
      <div className="filter-chips" aria-label="Report filters">
        {filterActive ? (
          <button className="filter-clear" type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear
          </button>
        ) : null}
        <select
          className={`filter-chip-select ${filters.status !== "all" ? "active" : ""}`}
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as StatusFilter }))}
        >
          <option value="all">Status: All ({reports.length})</option>
          <option value="open">Status: Open ({countWhere((report) => report.status === "open")})</option>
          <option value="active">Status: In progress ({countWhere((report) => ACTIVE_STATUSES.has(report.status))})</option>
          <option value="done">Status: Done ({countWhere((report) => DONE_STATUSES.has(report.status))})</option>
        </select>
        <select
          className={`filter-chip-select ${filters.severity !== "all" ? "active" : ""}`}
          aria-label="Filter by severity"
          value={filters.severity}
          onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value as SeverityFilter }))}
        >
          <option value="all">Severity: All ({reports.length})</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              Severity: {severity} ({countWhere((report) => report.severity === severity)})
            </option>
          ))}
        </select>
        <select
          className={`filter-chip-select ${filters.evidence !== "all" ? "active" : ""}`}
          aria-label="Filter by evidence"
          value={filters.evidence}
          onChange={(event) => setFilters((current) => ({ ...current, evidence: event.target.value as EvidenceFilter }))}
        >
          <option value="all">Evidence: All ({reports.length})</option>
          <option value="logs">Evidence: Has logs ({countWhere((report) => report.console_count + report.network_count > 0)})</option>
          <option value="screenshots">Evidence: Has screenshot ({countWhere((report) => Boolean(report.screenshot_key))})</option>
        </select>
        <select
          className={`filter-chip-select ${filters.project !== "all" ? "active" : ""}`}
          aria-label="Filter by project"
          value={filters.project}
          onChange={(event) => setFilters((current) => ({ ...current, project: event.target.value }))}
        >
          <option value="all">Project: All ({reports.length})</option>
          {projectOptions.map((project) => (
            <option key={project} value={project}>
              {project} ({countWhere((report) => report.project === project)})
            </option>
          ))}
        </select>
        <details className={`filter-multi ${filters.domains.length > 0 ? "active" : ""}`}>
          <summary>
            Domain: {filters.domains.length === 0 ? `All (${reports.length})` : `${filters.domains.length} selected`}
          </summary>
          <div className="filter-multi-menu">
            {domainOptions.length === 0 ? (
              <span className="filter-empty">No domains</span>
            ) : (
              domainOptions.map((domain) => (
                <label className="filter-check" key={domain}>
                  <input
                    type="checkbox"
                    checked={filters.domains.includes(domain)}
                    onChange={() => toggleDomain(domain)}
                  />
                  <span>{domain}</span>
                  <span className="filter-option-count">{countWhere((report) => getDomain(report.page_url) === domain)}</span>
                </label>
              ))
            )}
          </div>
        </details>
        {isAdmin ? (
          <select
            className={`filter-chip-select reporter-filter ${filters.reporter !== "all" ? "active" : ""}`}
            aria-label="Filter by reporter"
            value={filters.reporter}
            onChange={(event) => setFilters((current) => ({ ...current, reporter: event.target.value }))}
          >
            <option value="all">Reporter: All ({reports.length})</option>
            {reporterOptions.map((reporter) => (
              <option key={reporter} value={reporter}>
                {reporter} ({countWhere((report) => report.reporter_email === reporter)})
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {paginationControls}
      {error ? (
        <div className="error-banner" role="alert">
          <div>
            <strong>{blockingError ? "Reports failed to load" : "Action failed"}</strong>
            <p>{readableError(error)}</p>
          </div>
          <button className="btn ghost" type="button" onClick={load} disabled={loading}>
            Retry
          </button>
        </div>
      ) : null}
      {loading ? (
        <div className="table-scroll" aria-label="Loading reports">
          <table className="reports-table skeleton-table" aria-hidden="true">
            <thead>
              <tr>
                <th className="select-cell" aria-label="Select reports"></th>
                <th>Report</th>
                <th>Status</th>
                {isAdmin ? <th>Reporter</th> : null}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }, (_, index) => (
                <tr key={index}>
                  <td><span className="skeleton checkbox-skeleton" /></td>
                  <td>
                    <div className="report-cell-layout">
                      <span className="skeleton thumb-skeleton" />
                      <span className="skeleton line-skeleton title-skeleton" />
                    </div>
                  </td>
                  <td><span className="skeleton pill-skeleton" /></td>
                  {isAdmin ? <td><span className="skeleton line-skeleton reporter-skeleton" /></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : blockingError ? null : reports.length === 0 ? (
        <div className="empty-state">
          <EmptyReports />
          <p className="muted">No reports yet. Use the crosshair in any app's bar to file the first one.</p>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="empty-state">
          <EmptyReports />
          <p className="muted">No matching reports for this filter.</p>
        </div>
      ) : (
        <div className="table-scroll" aria-label="Reports table">
          <table className="reports-table">
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={allVisibleSelected ? "Deselect visible reports" : "Select visible reports"}
                    checked={allVisibleSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
                    }}
                    onChange={toggleVisibleReports}
                  />
                </th>
                <th>Report</th>
                <th>Status</th>
                {isAdmin ? <th>Reporter</th> : null}
              </tr>
            </thead>
            <tbody>
              {paginatedReports.map((r) => (
                <tr key={r.id}>
                  <td className="select-cell" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select report ${r.title}`}
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleReport(r.id)}
                    />
                  </td>
                  <td className="report-cell">
                    <div className="report-cell-layout">
                      <div className="report-thumb">
                        {thumbnailPreviews[r.id]?.isImage ? (
                          <img className="thumb" src={thumbnailPreviews[r.id].url} alt="" />
                        ) : (
                          <span className="thumb-placeholder">{r.screenshot_key ? (thumbnailPreviews[r.id] ? "File" : "Loading") : "No shot"}</span>
                        )}
                      </div>
                      <div className="report-copy">
                        <button
                          className="report-open"
                          onClick={(event) => {
                            event.stopPropagation();
                            openReport(r.id);
                          }}
                        >
                          {r.title}
                        </button>
                        {r.page_url ? (
                          <a
                            className="report-url"
                            href={r.page_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {formatUrl(r.page_url)}
                          </a>
                        ) : null}
                        <div className="report-meta">
                          <span>{r.project}</span>
                          {r.severity ? <span>{r.severity}</span> : null}
                          <span>{r.console_count}c / {r.network_count}n</span>
                          <span>{new Date(r.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {isAdmin ? (
                      <select
                        className={`status-select ${r.status}`}
                        value={r.status}
                        disabled={updatingStatus === r.id}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          void updateStatus(r, event.target.value);
                        }}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>{status.replace("_", " ")}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge ${r.status}`}>{r.status.replace("_", " ")}</span>
                    )}
                  </td>
                  {isAdmin ? <td className="muted">{r.reporter_email}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
