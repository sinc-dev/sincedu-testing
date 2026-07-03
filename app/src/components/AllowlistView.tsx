import { useCallback, useEffect, useMemo, useState } from "react";
import { addTester, listReports, listTesters, removeTester, type ReportRow, type TesterRow } from "../api";
import { Alert, AlertDescription } from "./ui/alert";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { cn } from "src/lib/utils";
import { STATUS_PILL_STYLES } from "src/lib/status";

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
    <Card>
      <CardHeader>
        <CardTitle>Tester allowlist</CardTitle>
        <CardDescription>Only these emails (plus admins) can sign in to the widget and file reports.</CardDescription>
      </CardHeader>
      <CardContent>
      {error ? <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert className="mb-3 border-primary/35 bg-primary/10 text-primary"><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input className="min-w-[200px] flex-1" type="email" required placeholder="tester@studyinnc.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input className="min-w-[160px] flex-1" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add tester"}</Button>
      </form>

      {loading ? (
        <p className="mt-4 text-muted-foreground">Loading…</p>
      ) : testers.length === 0 ? (
        <p className="mt-4 text-muted-foreground">No testers yet.</p>
      ) : (
        <div className="mt-4" aria-label="Tester allowlist table">
          <Table className="min-w-[920px]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[340px]">Email</TableHead>
                <TableHead className="min-w-[320px]">Note</TableHead>
                <TableHead className="min-w-[120px]">Added</TableHead>
                <TableHead className="min-w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {testers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Button
                      className="inline-flex h-auto items-center gap-2.5 p-0 text-left text-foreground hover:bg-transparent hover:text-primary"
                      variant="ghost"
                      type="button"
                      onClick={() => setSelectedTester(t)}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                          {testerInitial(t.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span>{t.email}</span>
                    </Button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.note || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="destructive" type="button" onClick={() => remove(t.id)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedTester ? (
        <Sheet open onOpenChange={(open) => {
          if (!open) setSelectedTester(null);
        }}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-[560px]">
            <SheetHeader className="mb-4 text-left">
              <SheetTitle>
                <div className="flex min-w-0 items-start gap-3.5 min-[821px]:items-center">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-primary text-primary-foreground text-lg font-bold">
                      {testerInitial(selectedTester.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <span className="[overflow-wrap:anywhere]">{selectedTester.email}</span>
                    <p className="text-muted-foreground">Added {new Date(selectedTester.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </SheetTitle>
            </SheetHeader>

              <div className="mb-3.5 grid grid-cols-1 gap-2.5 min-[821px]:grid-cols-2">
                {([
                  { label: "Total", value: selectedStats.total, tone: "" },
                  { label: "Open", value: selectedStats.open, tone: "text-destructive" },
                  { label: "In progress", value: selectedStats.active, tone: "text-[oklch(0.45_0.12_70)]" },
                  { label: "Done", value: selectedStats.done, tone: "text-primary" },
                ] as const).map((stat) => (
                  <Card key={stat.label}>
                    <CardContent className="grid gap-1.5 p-3">
                      <span className="text-xs font-semibold text-muted-foreground">{stat.label}</span>
                      <strong className={cn("text-2xl leading-none", stat.tone)}>{stat.value}</strong>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="mb-3">
                <CardHeader><CardTitle className="text-sm">Status split</CardTitle></CardHeader>
                <CardContent>
                <div className="flex h-3 min-w-0 gap-1.5 overflow-hidden rounded-full bg-muted/50">
                  <span style={{ flexGrow: selectedStats.open }} className="min-w-0 rounded-full bg-destructive/30" title={`${selectedStats.open} open`} />
                  <span style={{ flexGrow: selectedStats.active }} className="min-w-0 rounded-full bg-warning/35" title={`${selectedStats.active} in progress`} />
                  <span style={{ flexGrow: selectedStats.done }} className="min-w-0 rounded-full bg-primary/30" title={`${selectedStats.done} done`} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-destructive/30" /> Open</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-warning/35" /> In progress</span>
                  <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-primary/30" /> Done</span>
                </div>
                </CardContent>
              </Card>

              <Card className="mb-3">
                <CardHeader><CardTitle className="text-sm">Projects</CardTitle></CardHeader>
                <CardContent>
                {selectedStats.projects.length === 0 ? (
                  <p className="text-muted-foreground">No submissions yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {selectedStats.projects.map(([project, count]) => (
                      <div
                        key={project}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0"
                      >
                        <span className="text-muted-foreground">{project}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                )}
                </CardContent>
              </Card>

              <Card className="mb-3">
                <CardHeader><CardTitle className="text-sm">Recent submissions</CardTitle></CardHeader>
                <CardContent>
                {selectedReports.length === 0 ? (
                  <p className="text-muted-foreground">No reports submitted by this tester.</p>
                ) : (
                  <div className="grid gap-2">
                    {selectedReports.slice(0, 8).map((report) => (
                      <div
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0"
                        key={report.id}
                      >
                        <Badge variant="outline" className={cn("rounded-full capitalize", STATUS_PILL_STYLES[report.status])}>
                          {report.status.replace("_", " ")}
                        </Badge>
                        <div>
                          <strong>{report.title}</strong>
                          <p className="mt-1 text-xs text-muted-foreground">{report.project} · {new Date(report.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </CardContent>
              </Card>
          </SheetContent>
        </Sheet>
      ) : null}
      </CardContent>
    </Card>
  );
}

function testerInitial(email: string): string {
  return email.trim().charAt(0).toUpperCase() || "?";
}
