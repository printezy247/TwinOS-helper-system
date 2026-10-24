import { assertEquals, assertStringIncludes } from "std/assert/mod.ts";
import { normalizePath, observe, registerGauge, renderProm, resetMetrics, setRequestPersist } from "./metrics.ts";

Deno.test("normalizePath collapses ids so labels stay bounded", () => {
  const uuid = "0b1f6f9a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  assertEquals(normalizePath(`/content/${uuid}/fanout`), "/content/:id/fanout");
  assertEquals(normalizePath("/orders/1234567890/items"), "/orders/:id/items");
  assertEquals(normalizePath("/health/metrics"), "/health/metrics");
});

Deno.test("observe counts requests, errors and duration per route+class", async () => {
  resetMetrics();
  observe("GET", "/health", 200, 12);
  observe("GET", "/health", 200, 30);
  observe("POST", "/jobs/claim", 403, 4);
  observe("POST", "/jobs/claim", 500, 90);
  const text = await renderProm();
  assertStringIncludes(text, 'twinos_request_count{route="GET /health",status="2xx"} 2');
  assertStringIncludes(text, 'twinos_request_errors{route="POST /jobs/claim",status="4xx"} 1');
  assertStringIncludes(text, 'twinos_request_duration_ms_total{route="GET /health",status="2xx"} 42');
  assertStringIncludes(text, 'twinos_request_duration_ms_max{route="POST /jobs/claim",status="5xx"} 90');
  resetMetrics();
});

Deno.test("gauges render live values and -1 when the read fails", async () => {
  resetMetrics();
  registerGauge("twinos_jobs_queued", "Queued jobs.", () => 7);
  registerGauge("twinos_broken", "Fails on read.", () => {
    throw new Error("db down");
  });
  const text = await renderProm();
  assertStringIncludes(text, "twinos_jobs_queued 7");
  assertStringIncludes(text, "twinos_broken -1");
  // Re-registering the same name must not duplicate the series.
  registerGauge("twinos_jobs_queued", "Queued jobs.", () => 8);
  const again = await renderProm();
  assertEquals(again.match(/twinos_jobs_queued \d/g)?.length, 1);
  resetMetrics();
});

Deno.test("persist hook fires per observation and failures never throw", () => {
  resetMetrics();
  const seen: string[] = [];
  setRequestPersist((route, cls) => seen.push(`${route}|${cls}`));
  observe("GET", "/health/metrics", 200, 3);
  setRequestPersist(() => {
    throw new Error("db offline");
  });
  observe("GET", "/health/metrics", 500, 5); // swallow, no throw
  assertEquals(seen, ["GET /health/metrics|2xx"]);
  setRequestPersist(() => {});
  resetMetrics();
});

Deno.test("renderProm prefers global db rows over the isolate-local map", async () => {
  resetMetrics();
  observe("GET", "/local-only", 200, 9); // local map has this
  const text = await renderProm([
    { route: "GET /functions/v1/jobs", cls: "2xx", count: 42, errors: 2, ms_sum: 900, ms_max: 120 },
  ]);
  assertStringIncludes(text, 'twinos_request_count{route="GET /functions/v1/jobs",status="2xx"} 42');
  assertStringIncludes(text, 'twinos_request_errors{route="GET /functions/v1/jobs",status="2xx"} 2');
  if (text.includes("/local-only")) throw new Error("local map must not leak when db rows are passed");
  resetMetrics();
});
