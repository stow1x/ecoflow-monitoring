import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Registry } from "prom-client";
import type { UnmappedReport } from "../metrics/store.ts";

export interface MetricsServerOptions {
  registry: Registry;
  isReady: () => boolean;
  unmappedReport: () => UnmappedReport;
}

export function createMetricsServer({ registry, isReady, unmappedReport }: MetricsServerOptions): Server {
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? "/").split("?")[0];

    if (path === "/healthz") {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end("ok\n");
      return;
    }

    if (path === "/readyz") {
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, { "content-type": "text/plain; charset=utf-8" });
      response.end(ready ? "ready\n" : "no fresh telemetry\n");
      return;
    }

    if (path === "/debug/unmapped") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(`${JSON.stringify(unmappedReport(), null, 2)}\n`);
      return;
    }

    if (path !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    const body = await registry.metrics();
    response.writeHead(200, { "content-type": registry.contentType });
    response.end(body);
  }

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${error instanceof Error ? error.message : String(error)}\n`);
    });
  });
}
