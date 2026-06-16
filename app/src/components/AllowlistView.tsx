import { useCallback, useEffect, useMemo, useState } from "react";
import { addTester, listReports, listTesters, removeTester, type ReportRow, type TesterRow } from "../api";

interface Props {
  getToken: () => Promise<string | null>;
}

export function AllowlistView({ getToken }: Props) {
  const [testers, setTesters] = useState<TesterRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTester, setSelectedTester] = useState<TesterRow | null>(null);

  const selectedReports = useMemo(() => {
    if (!selectedTester) return [];
    return reports
      .filter((report) => report.reporter_email.toLowerCase() === selectedTester.email.toLowerCase())
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [reports, selectedTester]);

  const selectedStats = useMemo(() => {
    const done = selectedReports.filter((report) => ["fixed", "resolved", "closed"].includes(report.status)).length;
    const active = selectedReports.filter((report) => ["investigating", "in_progress"].includes(report.status)).length;
    const open = selectedReports.filter((report) => report.status === "open").length;
    const projects = new Map<string, number>();
    for (const report of selectedReports) projects.set(report.project, (projects.get(report.project) ?? 0) + 1);
    return {
      total: selectedReports.length,
      open,
      active,
      done,
      projects: [...projects.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [selectedReports]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your sign-in session expired. Sign out and sign in again.");
      const [nextTesters, nextReports] = await Promise.all([
        listTesters(token),
        listReports(token),
      ]);
      setTesters(nextTesters);
      setReports(nextReports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail) {
      setError("Enter a tester email first.");
      setNotice("");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Your sign-in session expired. Sign out and sign in again.");
      await addTester(token, nextEmail, note.trim());
      setEmail("");
      setNote("");
      await load();
      setNotice(`${nextEmail} is now on the tester allowlist.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const removedTester = testers.find((tester) => tester.id === id) ?? null;
    try {
      const token = await getToken();
      if (!token) throw new Error("Your sign-in session expired. Sign out and sign in again.");
      await removeTester(token, id);
      setTesters((cur) => cur.filter((t) => t.id !== id));
      if (removedTester) {
        setReports((cur) => cur.filter((report) => report.reporter_email.toLowerCase() !== removedTester.email.toLowerCase()));
      }
      if (selectedTester?.id === id) setSelectedTester(null);
      setNotice("Tester removed from the allowlist.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Tester allowlist</h3>
      <p className="muted">Only these emails (plus admins) can sign in to the widget and file reports.</p>
      {error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}
      {notice ? <p style={{ color: "#166534" }}>{notice}</p> : null}

      <form onSubmit={add} style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <input className="input" type="email" required placeholder="tester@studyinnc.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add tester"}</button>
      </form>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : testers.length === 0 ? (
        <p className="muted">No testers yet.</p>
      ) : (
        <div className="table-scroll" aria-label="Tester allowlist table">
          <table className="allowlist-table">
            <thead>
              <tr><th>Email</th><th>Note</th><th>Added</th><th></th></tr>
            </thead>
            <tbody>
              {testers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button className="tester-person" type="button" onClick={() => setSelectedTester(t)}>
                      <span className="tester-avatar" aria-hidden="true">{testerInitial(t.email)}</span>
                      <span>{t.email}</span>
                    </button>
                  </td>
                  <td className="muted">{t.note || "—"}</td>
                  <td className="muted">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn danger" type="button" onClick={() => remove(t.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedTester ? (
        <div className="overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedTester(null);
        }}>
          <aside className="drawer tester-drawer" aria-label={`${selectedTester.email} tester stats`}>
            <div className="drawer-scroll">
              <div className="drawer-header tester-drawer-header">
                <div className="tester-drawer-title">
                  <span className="tester-avatar large" aria-hidden="true">{testerInitial(selectedTester.email)}</span>
                  <div>
                    <h2>{selectedTester.email}</h2>
                    <p className="muted">Added {new Date(selectedTester.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <button className="icon-btn drawer-close" type="button" aria-label="Close tester drawer" onClick={() => setSelectedTester(null)}>
                  ×
                </button>
              </div>

              <div className="tester-stat-grid">
                <div className="tester-stat"><span>Total</span><strong>{selectedStats.total}</strong></div>
                <div className="tester-stat open"><span>Open</span><strong>{selectedStats.open}</strong></div>
                <div className="tester-stat active"><span>In progress</span><strong>{selectedStats.active}</strong></div>
                <div className="tester-stat done"><span>Done</span><strong>{selectedStats.done}</strong></div>
              </div>

              <div className="card tester-drawer-card">
                <strong>Status split</strong>
                <div className="tester-split">
                  <span style={{ flexGrow: selectedStats.open }} className="open" title={`${selectedStats.open} open`} />
                  <span style={{ flexGrow: selectedStats.active }} className="active" title={`${selectedStats.active} in progress`} />
                  <span style={{ flexGrow: selectedStats.done }} className="done" title={`${selectedStats.done} done`} />
                </div>
                <div className="tester-split-legend">
                  <span><i className="open" /> Open</span>
                  <span><i className="active" /> In progress</span>
                  <span><i className="done" /> Done</span>
                </div>
              </div>

              <div className="card tester-drawer-card">
                <strong>Projects</strong>
                {selectedStats.projects.length === 0 ? (
                  <p className="muted">No submissions yet.</p>
                ) : (
                  <div className="tester-projects">
                    {selectedStats.projects.map(([project, count]) => (
                      <div key={project}>
                        <span>{project}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card tester-drawer-card">
                <strong>Recent submissions</strong>
                {selectedReports.length === 0 ? (
                  <p className="muted">No reports submitted by this tester.</p>
                ) : (
                  <div className="tester-recent-list">
                    {selectedReports.slice(0, 8).map((report) => (
                      <div className="tester-recent-item" key={report.id}>
                        <span className={`badge ${report.status}`}>{report.status.replace("_", " ")}</span>
                        <div>
                          <strong>{report.title}</strong>
                          <p>{report.project} · {new Date(report.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function testerInitial(email: string): string {
  return email.trim().charAt(0).toUpperCase() || "?";
}
