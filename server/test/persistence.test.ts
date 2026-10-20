import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, type TestClient } from "./client.js";
import { startServer, type RunningServer } from "./helpers.js";

let dir: string;
let dataFile: string;
let first: RunningServer;
let firstSession: TestClient;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dinner-tower-persist-"));
  dataFile = path.join(dir, "household.json");
  first = await startServer({ dataFile });
  firstSession = await connectClient(first.mcpUrl, "persistence-first");
}, 60_000);

afterAll(async () => {
  await firstSession?.close();
  await first?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("AC-6 kitchen state survives a server restart", () => {
  it("persists update_kitchen({cooks:3}) across a process restart and a new session", async () => {
    const updated = await firstSession.client.callTool({
      name: "update_kitchen",
      arguments: { cooks: 3 },
    });
    expect(updated.isError).toBeFalsy();
    expect((updated.structuredContent as { cooks: number }).cooks).toBe(3);

    await firstSession.close();
    await first.stop();

    const stored = JSON.parse(await readFile(dataFile, "utf8"));
    expect(stored.version).toBe(1);
    expect(stored.kitchen.cooks).toBe(3);

    const second = await startServer({ dataFile });
    const secondSession = await connectClient(second.mcpUrl, "persistence-second");
    try {
      const kitchen = await secondSession.client.callTool({ name: "get_kitchen", arguments: {} });
      expect(kitchen.isError).toBeFalsy();
      expect(kitchen.structuredContent).toEqual({
        ovens: 1,
        ovenRacks: 2,
        burners: 4,
        cooks: 3,
        ovenSwitchMinutes: 10,
      });
    } finally {
      await secondSession.close();
      await second.stop();
    }
  }, 60_000);
});
