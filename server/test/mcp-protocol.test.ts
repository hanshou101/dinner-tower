import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, type TestClient } from "./client.js";
import { startServer, type RunningServer } from "./helpers.js";

const GOLDEN_KITCHEN = {
  ovens: 1,
  ovenRacks: 2,
  burners: 4,
  cooks: 2,
  ovenSwitchMinutes: 10,
};

let dir: string;
let server: RunningServer;
let session: TestClient;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dinner-tower-mcp-"));
  server = await startServer({ dataFile: path.join(dir, "household.json") });
  session = await connectClient(server.mcpUrl);
}, 60_000);

afterAll(async () => {
  await session?.close();
  await server?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("AC-1 protocol and transport", () => {
  it("negotiates protocolVersion 2025-11-25 and returns non-empty instructions", () => {
    expect(session.client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    const instructions = session.client.getInstructions();
    expect(typeof instructions).toBe("string");
    expect((instructions ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps the session (stateful): a second request on the same session succeeds", async () => {
    expect(session.sessionId).toBeTruthy();
    const first = await session.client.callTool({ name: "get_kitchen", arguments: {} });
    const second = await session.client.callTool({ name: "get_kitchen", arguments: {} });
    expect(first.isError).toBeFalsy();
    expect(second.isError).toBeFalsy();
  });

  it("exposes the Mcp-Session-Id response header on initialize", async () => {
    const res = await fetch(server.mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "header-probe", version: "1.0.0" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    const header = res.headers.get("mcp-session-id");
    expect(header).toBeTruthy();
    expect((header ?? "").length).toBeGreaterThan(0);
    await res.text(); // drain the SSE stream so the session can be closed below
    await fetch(server.mcpUrl, {
      method: "DELETE",
      headers: { "mcp-session-id": header as string },
    }).catch(() => {});
  });
});

describe("AC-2 tool surface (kitchen tools only)", () => {
  it("lists the three T2 kitchen tools with title, description, inputSchema and annotations", async () => {
    const { tools } = await session.client.listTools();
    // The surface grows as later tickets land (T4 adds plan_dinner, whats_next and
    // report_delay); T2 only pins that its own three are there and well formed.
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_kitchen", "list_dishes", "update_kitchen"]),
    );

    for (const tool of tools) {
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} inputSchema`).toBeTruthy();
      expect(tool.inputSchema.type, `${tool.name} inputSchema.type`).toBe("object");
    }

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("list_dishes")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_kitchen")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("update_kitchen")?.annotations?.idempotentHint).toBe(true);
  });
});

describe("list_dishes (SPEC §6.2.1 catalog)", () => {
  it("returns all 10 dishes with computed totalMinutes and ovenTempsF", async () => {
    const result = await session.client.callTool({ name: "list_dishes", arguments: {} });
    expect(result.isError).toBeFalsy();

    const dishes = (result.structuredContent as { dishes: Array<Record<string, unknown>> }).dishes;
    expect(dishes).toHaveLength(10);
    expect(dishes.map((d) => d.id).sort()).toEqual(
      [
        "broccoli",
        "gravy",
        "green_beans",
        "mashed_potatoes",
        "pumpkin_pie",
        "rice",
        "rolls",
        "salmon",
        "stuffing",
        "turkey",
      ].sort(),
    );

    const turkey = dishes.find((d) => d.id === "turkey");
    expect(turkey).toMatchObject({
      name: "Roast Turkey",
      icon: "🦃",
      holdMinutes: 30,
      totalMinutes: 230,
      ovenTempsF: [325],
    });

    for (const dish of dishes) {
      expect(typeof dish.totalMinutes, `${dish.id} totalMinutes`).toBe("number");
      expect(Array.isArray(dish.ovenTempsF), `${dish.id} ovenTempsF`).toBe(true);
    }

    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(text).toContain("Roast Turkey");
  });
});

describe("update_kitchen", () => {
  it("returns the default golden kitchen", async () => {
    const result = await session.client.callTool({ name: "get_kitchen", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(GOLDEN_KITCHEN);
  });

  it("rejects out-of-range values with isError", async () => {
    const result = await session.client.callTool({
      name: "update_kitchen",
      arguments: { burners: 99 },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    expect(text.toLowerCase()).toContain("burners");
  });

  it("merges a valid patch and returns the full kitchen", async () => {
    const result = await session.client.callTool({
      name: "update_kitchen",
      arguments: { cooks: 3 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ ...GOLDEN_KITCHEN, cooks: 3 });

    const after = await session.client.callTool({ name: "get_kitchen", arguments: {} });
    expect(after.structuredContent).toEqual({ ...GOLDEN_KITCHEN, cooks: 3 });
  });
});
