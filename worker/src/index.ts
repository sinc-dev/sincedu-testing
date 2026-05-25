import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./types.js";
import reports from "./routes/reports.js";
import allowlist from "./routes/allowlist.js";
import mcp from "./routes/mcp.js";
import { WIDGET_JS } from "./generated/widgetBundle.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS: the widget runs on arbitrary host origins, so allow the configured
// origins (or "*") for the API surface. Auth is via bearer token, not cookies,
// so credentials are not needed.
app.use("*", async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const handler = cors({
    origin: (origin) => {
      if (allowed.includes("*")) return origin || "*";
      return origin && allowed.includes(origin) ? origin : "";
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "x-sincedu-ingest-token", "MCP-Protocol-Version"],
    maxAge: 86400,
  });
  return handler(c, next);
});

app.get("/health", (c) => c.json({ ok: true }));

// Serve the embeddable widget. Loadable from any origin.
app.get("/widget.js", () => {
  return new Response(WIDGET_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

app.route("/api/reports", reports);
app.route("/api/allowlist", allowlist);
app.route("/api/mcp", mcp);

app.notFound((c) => c.json({ error: "Not Found" }, 404));
app.onError((err, c) => {
  console.error("[worker] error", err);
  return c.json({ error: "Internal Error", message: err.message }, 500);
});

export default app;
