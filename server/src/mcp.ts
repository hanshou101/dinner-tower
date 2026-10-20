import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { summarizeDishes, type Dish } from "./catalog.js";
import type { Clock } from "./clock.js";
import { registerPlanTools } from "./plan/index.js";
import { KITCHEN_LIMITS, validateKitchenPatch, type Kitchen, type Store } from "./store.js";

/**
 * The MCP server factory (SPEC §6.3).
 *
 * Transport/HTTP wiring lives in `index.ts`; this module owns the server
 * identity, the `instructions` the host reads, and the tool surface.
 * T2 registers the three kitchen tools; T4 adds the planning tools.
 */

export const SERVER_NAME = "dinner-tower";
export const SERVER_TITLE = "Dinner Tower";
export const SERVER_VERSION = "1.0.0";

/** The MCP spec revision this server targets (SPEC §6.0). */
export const PROTOCOL_VERSION = "2025-11-25";

export interface ServerContext {
  store: Store;
  clock: Clock;
  dishes: Dish[];
}

/** English `instructions` handed to every host on initialize (SPEC §6.3). */
export const INSTRUCTIONS = `Dinner Tower is the air-traffic control tower for a home kitchen. It schedules a multi-dish dinner backwards from one serve time so every dish lands hot at the same minute, within the ovens, burners and cooks the household actually has.

- Not sure which dish the user means? Call list_dishes first and use the dish ids it returns.
- plan_dinner takes those dish ids plus a 24-hour "HH:MM" serve time.
- When a dish slips, call report_delay; the target may be a dish id or a step id.
- When the user asks what to do next, call whats_next.
- Speak to the user in 12-hour times ("7:00 PM"), in at most two sentences.`;

function kitchenLimitsText(): string {
  return (Object.keys(KITCHEN_LIMITS) as Array<keyof Kitchen>)
    .map((key) => `${key} ${KITCHEN_LIMITS[key].min}-${KITCHEN_LIMITS[key].max}`)
    .join(", ");
}

/**
 * Build one McpServer for one MCP session. Sessions share the same `Store`, so
 * a plan or kitchen change made in one session is visible in the next one.
 */
export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_TITLE, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerKitchenTools(server, ctx);

  // T4 (SPEC §6.3, §6.4): plan_dinner / whats_next / report_delay, the oven
  // elicitation, the ui://dinner-tower/board.html resource and the
  // `thanksgiving` prompt all live in src/plan/.
  registerPlanTools(server, ctx);

  return server;
}

/** list_dishes / get_kitchen / update_kitchen (SPEC §6.3, T2). */
export function registerKitchenTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_dishes",
    {
      title: "List Dishes",
      description:
        "List every dish this kitchen can cook: dish id, display name, icon, total minutes end to end, the oven temperatures it needs and how long it can wait before serving. Call this first when you are not sure which dish ids the user means.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const dishes = summarizeDishes(ctx.dishes);
      const lines = dishes.map(
        (dish) =>
          `${dish.icon} ${dish.id} — ${dish.name}: ${dish.totalMinutes} min total, ` +
          `${dish.ovenTempsF.length > 0 ? `oven ${dish.ovenTempsF.join("/")}°F, ` : ""}holds ${dish.holdMinutes} min`,
      );
      return {
        content: [{ type: "text" as const, text: `${dishes.length} dishes available:\n${lines.join("\n")}` }],
        structuredContent: { dishes },
      };
    },
  );

  server.registerTool(
    "get_kitchen",
    {
      title: "Get Kitchen",
      description:
        "Read the household kitchen: number of ovens, racks per oven, burners, cooks and the minutes needed to change an oven temperature. Use it before planning when the user mentions their equipment.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const kitchen = ctx.store.getKitchen();
      const text =
        `Kitchen: ${kitchen.ovens} oven(s), ${kitchen.ovenRacks} rack(s) each, ` +
        `${kitchen.burners} burners, ${kitchen.cooks} cooks, ` +
        `${kitchen.ovenSwitchMinutes} min to change an oven temperature.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { ...kitchen },
      };
    },
  );

  server.registerTool(
    "update_kitchen",
    {
      title: "Update Kitchen",
      description:
        `Change one or more kitchen settings and remember them for future sessions. Fields and ranges: ${kitchenLimitsText()}. ` +
        "Returns the complete kitchen. Out-of-range values come back as an error and change nothing.",
      inputSchema: z.object({
        ovens: z.number().optional().describe("Number of ovens (1-2)."),
        ovenRacks: z.number().optional().describe("Racks per oven (1-3)."),
        burners: z.number().optional().describe("Burners (1-8)."),
        cooks: z.number().optional().describe("People cooking (1-4)."),
        ovenSwitchMinutes: z.number().optional().describe("Minutes to change an oven's temperature (0-30)."),
      }),
      annotations: { idempotentHint: true },
    },
    async (args) => {
      const check = validateKitchenPatch(args as Record<string, unknown>);
      if (!check.ok) {
        return { isError: true, content: [{ type: "text" as const, text: check.error }] };
      }
      const kitchen = ctx.store.updateKitchen(check.patch);
      const text =
        `Kitchen updated: ${kitchen.ovens} oven(s), ${kitchen.ovenRacks} rack(s) each, ` +
        `${kitchen.burners} burners, ${kitchen.cooks} cooks, ` +
        `${kitchen.ovenSwitchMinutes} min to change an oven temperature.`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { ...kitchen },
      };
    },
  );
}
