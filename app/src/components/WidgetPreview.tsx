import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

function widgetScriptUrl(): string {
  if (API_BASE) return `${API_BASE}/widget.js`;
  if (typeof window === "undefined") return "/widget.js";
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:8788/widget.js";
  }
  return `${window.location.origin}/widget.js`;
}

export function WidgetPreview() {
  const [frameKey, setFrameKey] = useState(0);
  const frameUrl = useMemo(() => {
    const params = new URLSearchParams({
      script: widgetScriptUrl(),
      review: typeof window === "undefined" ? "" : window.location.origin,
      project: "widget-preview",
    });
    return `/widget-preview-host.html?${params.toString()}`;
  }, []);

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-col items-stretch justify-between gap-3.5 min-[821px]:flex-row min-[821px]:items-end">
        <div>
          <h1 className="m-0 mb-1 text-2xl leading-[1.1]">Widget preview</h1>
          <p className="text-[13px] text-muted-foreground">This frame loads the real embeddable widget script, not a recreated mock.</p>
        </div>
        <div className="flex flex-wrap justify-start gap-2 min-[821px]:justify-end">
          <Button variant="outline" type="button" onClick={() => setFrameKey((value) => value + 1)}>
            <RefreshCw size={15} />
            Reload widget
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Live script preview</CardTitle>
          <CardDescription>
            Use the floating control in the frame. The launcher, orbit menu, picker, and report input are rendered by <code>widget.js</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <iframe
            key={frameKey}
            className="block w-full min-h-[560px] rounded-lg border bg-card min-[821px]:min-h-[680px]"
            title="Live testing widget script preview"
            src={frameUrl}
          />
        </CardContent>
      </Card>
    </div>
  );
}
