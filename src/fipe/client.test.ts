import { expect, test } from "vite-plus/test";
import { readCrawlerConfig } from "../config.js";
import { FipeClient } from "./client.js";

function clientWith(responses: Response[]) {
  const delays: number[] = [];
  const requests: RequestInit[] = [];
  const client = new FipeClient(
    readCrawlerConfig({ RATE_LIMIT_MS: "1", MAX_RETRIES: "1" }),
    async (_url, init) => {
      requests.push(init);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected extra request");
      return response;
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  return { client, delays, requests };
}
const brands = () => Response.json([{ Value: "59", Label: "VW" }]);
test("retries rate limits with Retry-After and bounds each request", async () => {
  const probe = clientWith([
    new Response("", { status: 429, headers: { "Retry-After": "2" } }),
    brands(),
  ]);
  expect(await probe.client.getBrands(328)).toEqual([{ Value: "59", Label: "VW" }]);
  expect(probe.delays).toContain(2000);
  expect(probe.requests).toHaveLength(2);
  expect(probe.requests[0].signal).toBeInstanceOf(AbortSignal);
});
test("accepts HTTP-date retry headers", async () => {
  const probe = clientWith([
    new Response("", {
      status: 429,
      headers: { "Retry-After": new Date(Date.now() + 10000).toUTCString() },
    }),
    brands(),
  ]);
  await probe.client.getBrands(328);
  expect(probe.delays.some((delay) => delay > 8000 && delay <= 10000)).toBe(true);
});
test("does not retry permanent HTTP errors or accept malformed successful responses", async () => {
  const probe = clientWith([new Response("", { status: 400 })]);
  await expect(probe.client.getBrands(328)).rejects.toThrow("HTTP 400");
  expect(probe.requests).toHaveLength(1);
  await expect(
    clientWith([Response.json([{ wrong: "shape" }])]).client.getBrands(328),
  ).rejects.toThrow();
});
test("retries transient failures only within the configured limit", async () => {
  const probe = clientWith([new Response("", { status: 500 }), new Response("", { status: 503 })]);
  await expect(probe.client.getBrands(328)).rejects.toThrow("HTTP 503");
  expect(probe.requests).toHaveLength(2);
  expect(probe.delays).toContain(1000);
});

test("long server cooldowns fail promptly and block further requests in the same run", async () => {
  const probe = clientWith([new Response("", { status: 429, headers: { "Retry-After": "3600" } })]);
  await expect(probe.client.getBrands(328)).rejects.toThrow("cooldown longer than 60 seconds");
  await expect(probe.client.getBrands(328)).rejects.toThrow("long cooldown");
  expect(probe.requests).toHaveLength(1);
  expect(probe.delays.every((delay) => delay < 1000)).toBe(true);
});
