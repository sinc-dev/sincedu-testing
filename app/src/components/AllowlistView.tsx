import { useCallback, useEffect, useState } from "react";
import { addTester, listTesters, removeTester, type TesterRow } from "../api";

interface Props {
  getToken: () => Promise<string | null>;
}

export function AllowlistView({ getToken }: Props) {
  const [testers, setTesters] = useState<TesterRow[]>([]);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      setTesters(await listTesters(token));
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
    if (!email.trim()) return;
    setBusy(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      await addTester(token, email.trim().toLowerCase(), note.trim());
      setEmail("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      await removeTester(token, id);
      setTesters((cur) => cur.filter((t) => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Tester allowlist</h3>
      <p className="muted">Only these emails (plus admins) can sign in to the widget and file reports.</p>
      {error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}

      <form onSubmit={add} style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        <input className="input" type="email" placeholder="tester@studyinnc.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add tester"}</button>
      </form>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : testers.length === 0 ? (
        <p className="muted">No testers yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Email</th><th>Note</th><th>Added</th><th></th></tr>
          </thead>
          <tbody>
            {testers.map((t) => (
              <tr key={t.id}>
                <td>{t.email}</td>
                <td className="muted">{t.note || "—"}</td>
                <td className="muted">{new Date(t.created_at).toLocaleDateString()}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn danger" onClick={() => remove(t.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
