import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "./helpers.js";

let dir: string;
let plain: RunningServer;
let demo: RunningServer;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dinner-tower-http-"));
  plain = await startServer({ dataFile: path.join(dir, "plain.json") });
  demo = await startServer({
    dataFile: path.join(dir, "demo.json"),
    demo: true,
    demoClockStart: "13:00",
  });
}, 60_000);

afterAll(async () => {
  await plain?.stop();
  await demo?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("GET /health", () => {
  it("answers exactly the AC-1 payload", async () => {
    const res = await fetch(`${plain.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      name: "dinner-tower",
      protocolVersion: "2025-11-25",
    });
  });
});

describe("/demo/clock", () => {
  it("is 404 outside demo mode", async () => {
    const get = await fetch(`${plain.baseUrl}/demo/clock`);
    expect(get.status).toBe(404);
    const post = await fetch(`${plain.baseUrl}/demo/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time: "18:20" }),
    });
    expect(post.status).toBe(404);
  });

  it("freezes at DEMO_CLOCK_START and accepts POST /demo/clock", async () => {
    const initial = await fetch(`${demo.baseUrl}/demo/clock`);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ time: "13:00", demoClock: true });

    const set = await fetch(`${demo.baseUrl}/demo/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time: "18:20" }),
    });
    expect(set.status).toBe(200);

    const read = await fetch(`${demo.baseUrl}/demo/clock`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ time: "18:20", demoClock: true });
  });

  it("rejects an invalid clock value", async () => {
    const res = await fetch(`${demo.baseUrl}/demo/clock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time: "25:99" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("CORS", () => {
  it("exposes Mcp-Session-Id to browser clients", async () => {
    const res = await fetch(`${demo.baseUrl}/health`, {
      headers: { origin: "http://localhost:8080" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8080");
    expect(res.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("mcp-session-id");
  });
});
