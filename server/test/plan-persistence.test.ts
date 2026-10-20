import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectClient, type TestClient } from "./client.js";
import { startServer, type RunningServer } from "./helpers.js";

/**
 * AC-6 (AME-854): a plan made in one server process is still on the board in a
 * brand-new session after the process is restarted. The plan lives in
 * `DT_DATA_FILE`; `activePlan` is read back through `whats_next`.
 */

const GOLDEN_MENU = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];

type PlanViewJson = {
  serveAt: string;
  option: string;
  revision: number;
  steps: { stepId: string; start: string; end: string }[];
};

function view(result: { isError?: boolean; structuredContent?: unknown }): PlanViewJson {
  expect(result.isError).toBeFalsy();
  return result.structuredContent as PlanViewJson;
}

function scheduleOf(plan: PlanViewJson): [string, string, string][] {
  return plan.steps.map((step) => [step.stepId, step.start, step.end]);
}

let dir: string;
let dataFile: string;
let first: RunningServer;
let firstSession: TestClient;
let planned: PlanViewJson;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dinner-tower-plan-persist-"));
  dataFile = path.join(dir, "household.json");
  first = await startServer({ dataFile, demo: true, demoClockStart: "13:00" });
  firstSession = await connectClient(first.mcpUrl, "plan-persist-first");
}, 60_000);

afterAll(async () => {
  await firstSession?.close();
  await first?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("AC-6 the active plan survives a server restart", () => {
  it("keeps the kitchen and replays the same serveAt and step times in a new session", async () => {
    const kitchen = await firstSession.client.callTool({ name: "update_kitchen", arguments: { cooks: 2 } });
    expect(kitchen.isError).toBeFalsy();

    planned = view(
      (await firstSession.client.callTool({
        name: "plan_dinner",
        arguments: { dishes: GOLDEN_MENU, serveAt: "19:00", option: "share-oven" },
      })) as { isError?: boolean; structuredContent?: unknown },
    );
    expect(planned.serveAt).toBe("19:00");
    expect(planned.steps).toHaveLength(13);

    await firstSession.close();
    await first.stop();

    const second = await startServer({ dataFile, demo: true, demoClockStart: "13:00" });
    const secondSession = await connectClient(second.mcpUrl, "plan-persist-second");
    try {
      const kitchenAfter = await secondSession.client.callTool({ name: "get_kitchen", arguments: {} });
      expect(kitchenAfter.structuredContent).toMatchObject({ cooks: 2 });

      const replayed = view(
        (await secondSession.client.callTool({ name: "whats_next", arguments: {} })) as {
          isError?: boolean;
          structuredContent?: unknown;
        },
      );
      expect(replayed.serveAt).toBe("19:00");
      expect(replayed.option).toBe("share-oven");
      expect(replayed.revision).toBe(planned.revision);
      expect(scheduleOf(replayed)).toEqual(scheduleOf(planned));
    } finally {
      await secondSession.close();
      await second.stop();
    }
  }, 60_000);
});
