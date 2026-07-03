import { useCallback, useEffect, useMemo, useState } from "react";
import { createMcpToken, getMcpEndpoint, listMcpTokens, revokeMcpToken, type McpTokenRow } from "../api";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

interface Props {
  getToken: () => Promise<string | null>;
}

interface PendingCopy {
  value: string;
  label: string;
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
  const [clipboardExplained, setClipboardExplained] = useState(false);
  const [pendingCopy, setPendingCopy] = useState<PendingCopy | null>(null);
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

  const writeClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch {
      setCopied("");
    }
  };

  const copy = async (value: string, label: string) => {
    if (!clipboardExplained) {
      setPendingCopy({ value, label });
      return;
    }
    await writeClipboard(value, label);
  };

  const continueCopy = async () => {
    if (!pendingCopy) return;
    const next = pendingCopy;
    setClipboardExplained(true);
    setPendingCopy(null);
    await writeClipboard(next.value, next.label);
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
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:items-center">
          <div className="min-w-0">
          <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-primary">MCP access</p>
          <h2 className="m-0 text-3xl font-bold leading-tight">Connect your AI agent to testing reports</h2>
          <CardDescription>
            Generate a scoped token for Claude, Cursor, Codex, or another MCP-capable agent.
            Tokens can list reports, fetch one report, pull console or network logs, and let admin agents update report status.
          </CardDescription>
        </div>
        <div className="grid gap-2 rounded-lg border bg-muted/35 p-4">
          <span>Endpoint</span>
          <code className="break-all rounded-md bg-background px-2 py-1 font-mono text-xs">{endpoint}</code>
          <Button variant="outline" type="button" onClick={() => void copy(endpoint, "endpoint")}>
            {copied === "endpoint" ? "Copied" : "Copy"}
          </Button>
        </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>MCP setup error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {pendingCopy ? (
        <Alert>
          <AlertTitle>Clipboard access</AlertTitle>
          <AlertDescription className="grid gap-3">
            <span>
              The next step copies the selected MCP value to your clipboard. Your browser or OS may ask for permission before allowing the copy.
            </span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => void continueCopy()}>Continue copy</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPendingCopy(null)}>Cancel</Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {secret ? (
        <Card>
          <CardContent className="grid gap-3 p-4">
            <div>
            <CardTitle>Copy this token now</CardTitle>
            <CardDescription>It is only shown once. Revoke it and create a new one if it is lost.</CardDescription>
          </div>
          <code className="break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">{secret}</code>
          <Button type="button" onClick={() => void copy(secret, "secret")}>
            {copied === "secret" ? "Copied" : "Copy token"}
          </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create token</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={create}>
              <div className="grid gap-1.5">
                <Label htmlFor="mcp-token-name">Token name</Label>
                <Input id="mcp-token-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Claude desktop" />
              </div>
              <Button disabled={busy}>{busy ? "Creating..." : "Generate token"}</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent config</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="my-2 mb-2.5 max-w-full overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-normal text-foreground min-[821px]:text-xs">{sampleConfig}</pre>
            <Button variant="outline" type="button" onClick={() => void copy(sampleConfig, "config")}>
              {copied === "config" ? "Copied" : "Copy config"}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Active tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-[13px] text-muted-foreground">Loading...</p>
          ) : tokens.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No MCP tokens yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Token</TableHead><TableHead>Created</TableHead><TableHead>Last used</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell>{token.name}</TableCell>
                    <TableCell className="font-mono text-xs">...{token.last_four}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{formatDate(token.created_at)}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{formatDate(token.last_used_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="destructive" type="button" onClick={() => void revoke(token.id)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
