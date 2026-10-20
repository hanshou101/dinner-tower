import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supportsFormElicitation } from "../src/plan/elicit.js";
import { connectClient, type TestClient } from "./client.js";
import { SERVER_ROOT, startServer, type RunningServer } from "./helpers.js";

/**
 * T4 integration tests (AME-854): the three planning tools, elicitation, the
 * `ui://` board resource, the `thanksgiving` prompt and cross-session state.
 *
 * Everything here talks to a real `tsx src/index.ts` process over Streamable
 * HTTP with `@modelcontextprotocol/client`, exactly like the simulator (T3) or
 * any other host would. `DEMO_MODE=1` freezes the clock so "now" is scripted.
 */

const BOARD_FIXTURE = path.join(SERVER_ROOT, "test/fixtures/board.html");
// startServer() inherits process.env, so this points every child at the fixture.
process.env.DT_BOARD_HTML = BOARD_FIXTURE;

const BOARD_URI = "ui://dinner-tower/board.html";
const GOLDEN_MENU = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];
const UI_TOOLS = ["plan_dinner", "report_delay", "whats_next"];

/** SPEC §6.2.6 table A — primary (recipe temperatures). */
const TABLE_A = {
  "turkey.prep": ["15:10", "15:30"],
  "turkey.roast": ["15:30", "18:30"],
  "turkey.rest": ["18:30", "19:00"],
  "stuffing.prep": ["14:20", "14:35"],
  "stuffing.bake": ["14:35", "15:20"],
  "mashed_potatoes.peel": ["18:15", "18:30"],
  "mashed_potatoes.boil": ["18:30", "18:50"],
  "mashed_potatoes.mash": ["18:50", "19:00"],
  "green_beans.trim": ["18:27", "18:37"],
  "green_beans.blanch": ["18:37", "18:42"],
  "green_beans.saute": ["18:42", "18:50"],
  "gravy.make": ["18:45", "19:00"],
  "rolls.bake": ["18:48", "19:00"],
} as const;

/** SPEC §6.2.6 table B — share-oven (`altSteps = {stuffing.bake, rolls.bake}`). */
const TABLE_B = {
  "turkey.prep": ["15:10", "15:30"],
  "turkey.roast": ["15:30", "18:30"],
  "turkey.rest": ["18:30", "19:00"],
  "stuffing.prep": ["17:50", "18:05"],
  "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"],
  "mashed_potatoes.boil": ["18:30", "18:50"],
  "mashed_potatoes.mash": ["18:50", "19:00"],
  "green_beans.trim": ["18:27", "18:37"],
  "green_beans.blanch": ["18:37", "18:42"],
  "green_beans.saute": ["18:42", "18:50"],
  "gravy.make": ["18:45", "19:00"],
  "rolls.bake": ["18:42", "19:00"],
} as const;

/** SPEC §6.2.6 table C — table B, 18:20, turkey +20 → serve 19:20. */
const TABLE_C = {
  "turkey.prep": ["15:10", "15:30"],
  "turkey.roast": ["15:30", "18:50"],
  "turkey.rest": ["18:50", "19:20"],
  "stuffing.prep": ["17:50", "18:05"],
  "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"],
  "mashed_potatoes.boil": ["18:50", "19:10"],
  "mashed_potatoes.mash": ["19:10", "19:20"],
  "green_beans.trim": ["18:47", "18:57"],
  "green_beans.blanch": ["18:57", "19:02"],
  "green_beans.saute": ["19:02", "19:10"],
  "gravy.make": ["19:05", "19:20"],
  "rolls.bake": ["19:02", "19:20"],
} as const;

/** SPEC §6.2.6 table D — table B, 18:40, turkey.rest +15 → serve 19:15. */
const TABLE_D = {
  "turkey.prep": ["15:10", "15:30"],
  "turkey.roast": ["15:30", "18:30"],
  "turkey.rest": ["18:30", "19:15"],
  "stuffing.prep": ["17:50", "18:05"],
  "stuffing.bake": ["18:05", "19:00"],
  "mashed_potatoes.peel": ["18:15", "18:30"],
  "mashed_potatoes.boil": ["18:30", "18:50"],
  "mashed_potatoes.mash": ["19:05", "19:15"],
  "green_beans.trim": ["18:27", "18:37"],
  "green_beans.blanch": ["18:37", "18:42"],
  "green_beans.saute": ["18:57", "19:05"],
  "gravy.make": ["19:00", "19:15"],
  "rolls.bake": ["18:57", "19:15"],
} as const;

/** Steps that table C says moved, with their old and new ranges. */
const TABLE_C_CHANGES = [
  "gravy.make",
  "green_beans.blanch",
  "green_beans.saute",
  "green_beans.trim",
  "mashed_potatoes.boil",
  "mashed_potatoes.mash",
  "rolls.bake",
  "turkey.rest",
  "turkey.roast",
];

const FROZEN_UI = {
  "turkey.roast": "325",
  "stuffing.bake": "325",
  "rolls.bake": "325",
};

type StepView = {
  stepId: string;
  dishId: string;
  dishName: string;
  icon: string;
  label: string;
  start: string;
  end: string;
  minutes: number;
  uses: string[];
  oven: number | null;
  ovenTempF: number | null;
  usedAlt: boolean;
  status: "done" | "active" | "upcoming";
};

type PlanViewJson = {
  serveAt: string;
  originalServeAt: string;
  now: string;
  demoClock: boolean;
  option: "primary" | "share-oven" | "keep-temps";
  revision: number;
  kitchen: Record<string, number>;
  dishes: { id: string; name: string; icon: string; readyAt: string; waitMinutes: number; holdMinutes: number; ok: boolean }[];
  steps: StepView[];
  next: string[];
  conflict: null | {
    message: string;
    options: { id: string; label: string }[];
    waits: { dishId: string; readyAt: string; waitMinutes: number }[];
  };
  changes: { stepId: string; label: string; from: string; to: string }[];
};

type ToolResult = {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
};

function view(result: ToolResult): PlanViewJson {
  expect(result.isError, "tool returned isError").toBeFalsy();
  expect(result.structuredContent, "structuredContent present").toBeTruthy();
  return result.structuredContent as PlanViewJson;
}

function text(result: ToolResult): string {
  const content = Array.isArray(result.content) ? (result.content as { text?: string }[]) : [];
  return content.map((item) => item.text ?? "").join("\n");
}

/** Assert every step time in `table` and that the view has exactly those steps. */
function expectTable(actual: PlanViewJson, table: Record<string, readonly [string, string]>): void {
  expect(actual.steps.map((step) => step.stepId).sort()).toEqual(Object.keys(table).sort());
  for (const step of actual.steps) {
    expect([step.start, step.end], `${step.stepId} ${step.start}–${step.end}`).toEqual(table[step.stepId]);
  }
}

async function setClock(server: RunningServer, time: string): Promise<void> {
  const res = await fetch(`${server.baseUrl}/demo/clock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ time }),
  });
  expect(res.status, `POST /demo/clock ${time}`).toBe(200);
  expect((await res.json()) as { time: string }).toEqual({ time, demoClock: true });
}

type ElicitAnswer = { action: "accept"; choice: string } | { action: "decline" };

let dir: string;
let server: RunningServer;
let plain: TestClient;
let eliciting: TestClient;
let elicitTransport: StreamableHTTPClientTransport;
const elicitRequests: { message: string; requestedSchema: Record<string, unknown> }[] = [];
let answer: ElicitAnswer = { action: "accept", choice: "share-oven" };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dinner-tower-plan-"));
  server = await startServer({ dataFile: path.join(dir, "household.json"), demo: true, demoClockStart: "13:00" });

  // A host that declares form elicitation and answers with whatever `answer` holds.
  plain = await connectClient(server.mcpUrl, "plan-plain");

  const client = new Client(
    { name: "plan-eliciting", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler("elicitation/create", async (request) => {
    elicitRequests.push(request.params as { message: string; requestedSchema: Record<string, unknown> });
    if (answer.action === "decline") return { action: "decline" as const };
    return { action: "accept" as const, content: { choice: answer.choice } };
  });
  elicitTransport = new StreamableHTTPClientTransport(new URL(server.mcpUrl));
  await client.connect(elicitTransport);
  eliciting = {
    client,
    transport: elicitTransport,
    sessionId: elicitTransport.sessionId,
    close: async () => {
      await client.close().catch(() => {});
      await elicitTransport.close().catch(() => {});
    },
  };
}, 90_000);

afterAll(async () => {
  await eliciting?.close();
  await plain?.close();
  await server?.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("supportsFormElicitation (SPEC §6.3 gate)", () => {
  it("treats `{}` and `{form:{}}` as form support, `{url:{}}` and missing as not", () => {
    expect(supportsFormElicitation(undefined)).toBe(false);
    expect(supportsFormElicitation({})).toBe(true);
    expect(supportsFormElicitation({ form: {} })).toBe(true);
    expect(supportsFormElicitation({ url: {} })).toBe(false);
    expect(supportsFormElicitation({ form: {}, url: {} })).toBe(true);
  });
});

describe("AC-2 tool surface", () => {
  it("lists exactly six tools with title, description and inputSchema", async () => {
    const { tools } = await plain.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      ["get_kitchen", "list_dishes", "plan_dinner", "report_delay", "update_kitchen", "whats_next"].sort(),
    );
    for (const tool of tools) {
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema.type, `${tool.name} inputSchema.type`).toBe("object");
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("list_dishes")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("get_kitchen")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("whats_next")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("update_kitchen")?.annotations?.idempotentHint).toBe(true);
  });

  it("gives the three planning tools an outputSchema and the board resourceUri", async () => {
    const { tools } = await plain.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of UI_TOOLS) {
      const tool = byName.get(name);
      expect(tool?.outputSchema, `${name} outputSchema`).toBeTruthy();
      expect(tool?.outputSchema?.type, `${name} outputSchema.type`).toBe("object");
      const meta = tool?._meta as { ui?: { resourceUri?: string } } | undefined;
      expect(meta?.ui?.resourceUri, `${name} _meta.ui.resourceUri`).toBe(BOARD_URI);
      const properties = (tool?.outputSchema?.properties ?? {}) as Record<string, unknown>;
      for (const key of ["serveAt", "originalServeAt", "now", "steps", "next", "conflict", "changes", "kitchen"]) {
        expect(properties, `${name} outputSchema.${key}`).toHaveProperty(key);
      }
    }
  });

  it("serves the board HTML as an MCP App resource", async () => {
    const resource = await plain.client.readResource({ uri: BOARD_URI });
    const content = resource.contents[0] as { uri: string; mimeType?: string; text?: string };
    expect(content.uri).toBe(BOARD_URI);
    expect(content.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(content.text ?? "").toContain("<html");
  });

  it("publishes the thanksgiving prompt and a non-empty instructions block", async () => {
    const { prompts } = await plain.client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toContain("thanksgiving");
    const prompt = await plain.client.getPrompt({ name: "thanksgiving" });
    const message = prompt.messages[0];
    expect(message?.role).toBe("user");
    expect((message?.content as { type: string; text?: string }).text).toBe(
      "Plan Thanksgiving dinner for 7:00 PM: turkey, stuffing, mashed potatoes, green beans, gravy and rolls.",
    );
    expect((plain.client.getInstructions() ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("board resource error when the board is not built", () => {
  it("returns an MCP error instead of fake HTML", async () => {
    const previous = process.env.DT_BOARD_HTML;
    process.env.DT_BOARD_HTML = path.join(dir, "missing", "board.html");
    const bare = await startServer({ dataFile: path.join(dir, "bare.json"), demo: true });
    if (previous === undefined) delete process.env.DT_BOARD_HTML;
    else process.env.DT_BOARD_HTML = previous;
    const session = await connectClient(bare.mcpUrl, "plan-bare");
    try {
      await expect(session.client.readResource({ uri: BOARD_URI })).rejects.toThrow(/Board UI not built/);
    } finally {
      await session.close();
      await bare.stop();
    }
  }, 60_000);
});

describe("whats_next before anything is planned", () => {
  it("returns the SPEC §6.3 isError copy", async () => {
    const result = (await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("No dinner planned yet. Tell me what you're cooking and when.");
    expect(result.structuredContent).toBeUndefined();
  });
});

describe("AC-4 plan_dinner from a host without elicitation", () => {
  it("returns table A with the conflict and both option ids", async () => {
    const result = (await plain.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    })) as ToolResult;
    const plan = view(result);
    expectTable(plan, TABLE_A);
    expect(plan.option).toBe("keep-temps");
    expect(plan.serveAt).toBe("19:00");
    expect(plan.originalServeAt).toBe("19:00");
    expect(plan.revision).toBe(1);
    expect(plan.conflict?.options.map((option) => option.id)).toEqual(["share-oven", "keep-temps"]);
    expect(plan.conflict?.message).toBe(
      "Your oven can only hold one temperature at a time, so Sourdough Stuffing would finish early and wait too long. How should I plan it?",
    );
    expect(plan.conflict?.waits).toEqual([{ dishId: "stuffing", readyAt: "15:20", waitMinutes: 220 }]);
    expect(plan.changes).toEqual([]);
    expect(text(result)).toContain("7:00 PM");
  });

  it("honours an explicit option: share-oven gives table B", async () => {
    const result = (await plain.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00", option: "share-oven" },
    })) as ToolResult;
    const plan = view(result);
    expectTable(plan, TABLE_B);
    expect(plan.option).toBe("share-oven");
    expect(plan.conflict).toBeNull();
    expect(plan.revision).toBe(1);
    const alt = plan.steps.filter((step) => step.usedAlt).map((step) => step.stepId).sort();
    expect(alt).toEqual(["rolls.bake", "stuffing.bake"]);
  });
});

describe("AC-4 elicitation from a host that declares form support", () => {
  it("asks with exactly two titled options when share-oven is available", async () => {
    answer = { action: "accept", choice: "share-oven" };
    elicitRequests.length = 0;
    const result = (await eliciting.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    })) as ToolResult;

    expect(elicitRequests).toHaveLength(1);
    const request = elicitRequests[0]!;
    expect(request.message).toBe(
      "Your oven can only hold one temperature at a time, so Sourdough Stuffing would finish early and wait too long. How should I plan it?",
    );
    const schema = request.requestedSchema as {
      properties: { choice: { title: string; default: string; oneOf: { const: string; title: string }[] } };
      required: string[];
    };
    expect(schema.required).toEqual(["choice"]);
    expect(schema.properties.choice.title).toBe("Oven plan");
    expect(schema.properties.choice.oneOf.map((option) => option.const)).toEqual(["share-oven", "keep-temps"]);
    expect(schema.properties.choice.oneOf[0]!.title).toBe(
      "Share the oven: bake Sourdough Stuffing and Dinner Rolls at 325°F alongside the rest — everything lands at 7:00 PM.",
    );
    expect(schema.properties.choice.oneOf[1]!.title).toBe(
      "Keep recipe temperatures: Sourdough Stuffing is ready at 3:20 PM and waits 3 h 40 min.",
    );

    const plan = view(result);
    expectTable(plan, TABLE_B);
    expect(plan.option).toBe("share-oven");
    expect(plan.conflict).toBeNull();
  });

  it("accept + keep-temps returns table A with the conflict", async () => {
    answer = { action: "accept", choice: "keep-temps" };
    elicitRequests.length = 0;
    const result = (await eliciting.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    })) as ToolResult;
    expect(elicitRequests).toHaveLength(1);
    const plan = view(result);
    expectTable(plan, TABLE_A);
    expect(plan.option).toBe("keep-temps");
    expect(plan.conflict?.waits[0]?.dishId).toBe("stuffing");
  });

  it("decline returns table A with the conflict", async () => {
    answer = { action: "decline" };
    elicitRequests.length = 0;
    const result = (await eliciting.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    })) as ToolResult;
    expect(elicitRequests).toHaveLength(1);
    const plan = view(result);
    expectTable(plan, TABLE_A);
    expect(plan.option).toBe("keep-temps");
    expect(plan.conflict?.waits[0]?.dishId).toBe("stuffing");
  });

  it("does not ask when the caller already passed an option", async () => {
    answer = { action: "accept", choice: "share-oven" };
    elicitRequests.length = 0;
    const result = (await eliciting.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00", option: "share-oven" },
    })) as ToolResult;
    expect(elicitRequests).toHaveLength(0);
    expect(view(result).option).toBe("share-oven");
  });
});

describe("PlanView status at 18:20 on table B", () => {
  beforeAll(async () => {
    await setClock(server, "13:00");
    await plain.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00", option: "share-oven" },
    });
    await setClock(server, "18:20");
  }, 60_000);

  it("marks done / active / next exactly as SPEC §5 AC-8 describes", async () => {
    const plan = view((await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult);
    expectTable(plan, TABLE_B);
    expect(plan.serveAt).toBe("19:00");
    expect(plan.now).toBe("18:20");
    expect(plan.demoClock).toBe(true);
    expect(plan.option).toBe("share-oven");

    const status = Object.fromEntries(plan.steps.map((step) => [step.stepId, step.status]));
    expect(status["turkey.roast"]).toBe("active");
    expect(status["stuffing.bake"]).toBe("active");
    expect(status["mashed_potatoes.peel"]).toBe("active");
    expect(status["stuffing.prep"]).toBe("done");
    expect(status["turkey.prep"]).toBe("done");
    expect(plan.next).toEqual(["green_beans.trim", "mashed_potatoes.boil", "turkey.rest"]);

    const roast = plan.steps.find((step) => step.stepId === "turkey.roast")!;
    expect(roast.oven).toBe(1);
    expect(roast.ovenTempF).toBe(325);
    expect(roast.uses).toEqual(["oven"]);
    const stuffing = plan.steps.find((step) => step.stepId === "stuffing.bake")!;
    expect(stuffing.ovenTempF).toBe(325);
    expect(stuffing.usedAlt).toBe(true);

    const dishes = new Map(plan.dishes.map((dish) => [dish.id, dish]));
    expect(dishes.get("turkey")).toMatchObject({ readyAt: "19:00", waitMinutes: 0, ok: true });
    expect(plan.dishes.map((dish) => dish.id)).toEqual(GOLDEN_MENU);
  });
});

describe("AC-5 report_delay", () => {
  it("turkey +20 at 18:20 gives table C, 9 changes and revision +1", async () => {
    const result = (await plain.client.callTool({
      name: "report_delay",
      arguments: { target: "turkey", minutes: 20 },
    })) as ToolResult;
    const plan = view(result);
    expectTable(plan, TABLE_C);
    expect(plan.serveAt).toBe("19:20");
    expect(plan.originalServeAt).toBe("19:00");
    expect(plan.revision).toBe(2);
    expect(plan.changes.map((change) => change.stepId).sort()).toEqual(TABLE_C_CHANGES);

    const changes = new Map(plan.changes.map((change) => [change.stepId, change]));
    expect(changes.get("turkey.roast")).toEqual({
      stepId: "turkey.roast",
      label: "Roast the turkey",
      from: "15:30–18:30",
      to: "15:30–18:50",
    });
    expect(changes.get("rolls.bake")?.to).toBe("19:02–19:20");
    expect(text(result)).toContain("7:20 PM");
  });

  it("turkey.rest +15 at 18:40 on a fresh table B gives table D", async () => {
    await setClock(server, "13:00");
    const planned = view(
      (await plain.client.callTool({
        name: "plan_dinner",
        arguments: { dishes: GOLDEN_MENU, serveAt: "19:00", option: "share-oven" },
      })) as ToolResult,
    );
    expect(planned.revision).toBe(1);
    await setClock(server, "18:40");

    const plan = view(
      (await plain.client.callTool({
        name: "report_delay",
        arguments: { target: "turkey.rest", minutes: 15 },
      })) as ToolResult,
    );
    expectTable(plan, TABLE_D);
    expect(plan.serveAt).toBe("19:15");
    expect(plan.originalServeAt).toBe("19:00");
    expect(plan.revision).toBe(2);
    expect(plan.changes.map((change) => change.stepId).sort()).toEqual([
      "gravy.make",
      "mashed_potatoes.mash",
      "green_beans.saute",
      "rolls.bake",
      "turkey.rest",
    ].sort());
  });

  it("reports an error for a step that already finished", async () => {
    const result = (await plain.client.callTool({
      name: "report_delay",
      arguments: { target: "turkey.prep", minutes: 10 },
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Season & truss the turkey is already done.");
  });
});

describe("AC-7 too late", () => {
  it("refuses 19:00 at 18:00, names 9:50 PM and leaves the active plan alone", async () => {
    const before = view((await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult);
    await setClock(server, "18:00");

    const result = (await plain.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: GOLDEN_MENU, serveAt: "19:00" },
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toBe(
      "Too late to serve at 7:00 PM. The earliest I can land everything is 9:50 PM.",
    );

    const after = view((await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult);
    expect(after.serveAt).toBe(before.serveAt);
    expect(after.originalServeAt).toBe(before.originalServeAt);
    expect(after.revision).toBe(before.revision);
    expect(after.steps.map((step) => [step.stepId, step.start, step.end])).toEqual(
      before.steps.map((step) => [step.stepId, step.start, step.end]),
    );
    expect(after.now).toBe("18:00");
  });
});

describe("input validation on the planning tools", () => {
  it("rejects an unknown dish id without touching the active plan", async () => {
    const before = view((await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult);
    const result = (await plain.client.callTool({
      name: "plan_dinner",
      arguments: { dishes: ["pizza"], serveAt: "19:00" },
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Unknown dish id: pizza. Call list_dishes to see the ids.");
    const after = view((await plain.client.callTool({ name: "whats_next", arguments: {} })) as ToolResult);
    expect(after.serveAt).toBe(before.serveAt);
    expect(after.revision).toBe(before.revision);
  });

  it("rejects a serve time that is not 24-hour HH:MM", async () => {
    for (const serveAt of ["7pm", "25:00", "19:75", ""]) {
      const result = (await plain.client.callTool({
        name: "plan_dinner",
        arguments: { dishes: ["turkey"], serveAt },
      })) as ToolResult;
      expect(result.isError, serveAt).toBe(true);
      expect(text(result)).toContain('Serve time must be a 24-hour "HH:MM" time');
    }
  });
});
