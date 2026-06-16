import { useCallback, useEffect, useMemo, useState } from "react";
import { createMcpToken, getMcpEndpoint, listMcpTokens, revokeMcpToken, type McpTokenRow } from "../api";

interface Props {
  getToken: () => Promise<string | null>;
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function McpView({ getToken }: Props) {
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [name, setName] = useState("Local agent");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const endpoint = useMemo(() => getMcpEndpoint(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      setTokens(await listMcpTokens(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCP tokens");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      setCopied("");
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const token = await getToken();
      if (!token) return;
      const created = await createMcpToken(token, name);
      setSecret(created.secret);
      setTokens((current) => [created.token, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create MCP token");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setError("");
    try {
      const token = await getToken();
      if (!token) return;
      await revokeMcpToken(token, id);
      setTokens((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token");
    }
  };

  const sampleConfig = JSON.stringify({
    mcpServers: {
      "sinc-edu-testing": {
        url: endpoint,
        headers: {
          Authorization: "Bearer YOUR_MCP_TOKEN",
        },
      },
    },
  }, null, 2);

  return (
    <div className="mcp-page">
      <section className="card mcp-hero">
        <div className="mcp-hero-copy">
          <p className="eyebrow">MCP access</p>
          <h2>Connect your AI agent to testing reports</h2>
          <p className="muted">
            Generate a scoped token for Claude, Cursor, Codex, or another MCP-capable agent.
            Tokens can list reports, fetch one report, and pull console or network logs.
          </p>
        </div>
        <div className="endpoint-box">
          <span>Endpoint</span>
          <code>{endpoint}</code>
          <button className="btn ghost" type="button" onClick={() => void copy(endpoint, "endpoint")}>
            {copied === "endpoint" ? "Copied" : "Copy"}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner"><div><strong>MCP setup error</strong><p>{error}</p></div></div> : null}

      {secret ? (
        <section className="card secret-card">
          <div>
            <h3>Copy this token now</h3>
            <p className="muted">It is only shown once. Revoke it and create a new one if it is lost.</p>
          </div>
          <code className="secret-token">{secret}</code>
          <button className="btn" type="button" onClick={() => void copy(secret, "secret")}>
            {copied === "secret" ? "Copied" : "Copy token"}
          </button>
        </section>
      ) : null}

      <section className="mcp-grid">
        <div className="card mcp-form-card">
          <h3 style={{ marginTop: 0 }}>Create token</h3>
          <form className="mcp-token-form" onSubmit={create}>
            <label className="field">
              <span>Token name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude desktop" />
            </label>
            <button className="btn" disabled={busy}>{busy ? "Creating..." : "Generate token"}</button>
          </form>
        </div>

        <div className="card mcp-config-card">
          <h3 style={{ marginTop: 0 }}>Agent config</h3>
          <pre className="code-block">{sampleConfig}</pre>
          <button className="btn ghost" type="button" onClick={() => void copy(sampleConfig, "config")}>
            {copied === "config" ? "Copied" : "Copy config"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Active tokens</h3>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : tokens.length === 0 ? (
          <p className="muted">No MCP tokens yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th></th></tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td className="mono">...{token.last_four}</td>
                    <td className="muted">{formatDate(token.created_at)}</td>
                    <td className="muted">{formatDate(token.last_used_at)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn danger" type="button" onClick={() => void revoke(token.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
