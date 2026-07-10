import type { Env } from "./types.js";

const REALTIME_OBJECT_NAME = "reports";

export interface ReportRealtimeEvent {
  type: "report_changed";
  action: "created" | "updated" | "deleted";
  id?: string;
  ids?: string[];
  project?: string | null;
  at: string;
}

function realtimeStub(env: Env): DurableObjectStub {
  const namespace = (env as { REPORT_REALTIME?: DurableObjectNamespace }).REPORT_REALTIME;
  if (!namespace) throw new Error("REPORT_REALTIME Durable Object binding is not configured");
  const id = namespace.idFromName(REALTIME_OBJECT_NAME);
  return namespace.get(id);
}

export async function notifyReportsChanged(
  env: Env,
  event: Omit<ReportRealtimeEvent, "type" | "at">,
): Promise<void> {
  const payload: ReportRealtimeEvent = {
    type: "report_changed",
    at: new Date().toISOString(),
    ...event,
  };

  await realtimeStub(env).fetch("https://reports-realtime/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export class ReportRealtime {
  constructor(private readonly ctx: DurableObjectState) {}

  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.broadcast(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") {
      ws.send("pong");
    }
  }

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "WebSocket error");
  }

  private async broadcast(request: Request): Promise<Response> {
    const body = await request.text();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        ws.close(1011, "Broadcast failed");
      }
    }
    return new Response(null, { status: 204 });
  }
}
