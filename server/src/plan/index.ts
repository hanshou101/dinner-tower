import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  findEarliestServe,
  formatDuration,
  formatTime12h,
  parseTime,
  planOptions,
  replan,
  ReplanError,
  type PlanConflict,
  type ScheduleResult,
} from "../../../scheduler/src/index.js";
import type { Dish } from "../catalog.js";
import type { ServerContext } from "../mcp.js";
import type { ActivePlan, Kitchen, PlanOption } from "../store.js";
import { BOARD_URI, registerBoardResource } from "./board.js";
import { buildOvenQuestion, choiceFromElicitResult, supportsFormElicitation } from "./elicit.js";
import { buildPlanView, hydratePlan, PlanViewSchema, toPlanRecords, type PlanView } from "./view.js";

/**
 * The planning tools, the board resource and the `thanksgiving` prompt (T4).
 *
 * All the scheduling is the engine's (`scheduler/src`); this module resolves the
 * user's intent into an engine input, asks the oven question when both answers
 * are real, persists the winning plan and formats a `PlanView` (SPEC §6.3).
 * `registerPlanTools` is the hook `mcp.ts` calls inside `createServer`.
 */

/** SPEC §6.3 copy for a host that asks for the next step before planning. */
export const NO_PLAN = "No dinner planned yet. Tell me what you're cooking and when.";

const NO_PLAN_HINT = `${NO_PLAN}`;

type ToolResult = {
  isError?: boolean;
  content: { type: "text"; text: string }[];
  structuredContent?: PlanView;
};

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function planResult(view: PlanView): ToolResult {
  return { content: [{ type: "text", text: summarize(view) }], structuredContent: view };
}

/** "HH:MM" → "7:00 PM" (the only clock form users see). */
function clockLabel(hhmm: string): string {
  return formatTime12h(parseTime(hhmm));
}

/** The English summary for hosts that never render the board (SPEC §6.3). */
function summarize(view: PlanView): string {
  const lines: string[] = [];
  let head = `Dinner lands at ${clockLabel(view.serveAt)} — ${view.dishes.length} dishes, ${view.steps.length} steps, ${view.option} plan`;
  if (view.serveAt !== view.originalServeAt) {
    head += ` (moved from ${clockLabel(view.originalServeAt)})`;
  }
  lines.push(`${head}.`);

  const upcoming = view.next
    .map((stepId) => view.steps.find((step) => step.stepId === stepId))
    .filter((step): step is PlanView["steps"][number] => step !== undefined);
  if (upcoming.length > 0) {
    const items = upcoming.map((step) => `${step.label} at ${clockLabel(step.start)}`);
    lines.push(`Next up: ${items.join("; ")}.`);
  } else {
    lines.push("Nothing left to cook — every dish is on the table.");
  }

  if (view.conflict) {
    const waits = view.conflict.waits
      .map((wait) => {
        const name = view.dishes.find((dish) => dish.id === wait.dishId)?.name ?? wait.dishId;
        return `${name} is ready at ${clockLabel(wait.readyAt)} and waits ${formatDuration(wait.waitMinutes)}`;
      })
      .join("; ");
    const options = view.conflict.options.map((option) => option.id).join(", ");
    lines.push(`Waiting too long: ${waits}. Options: ${options}.`);
  }

  if (view.changes.length > 0) {
    lines.push(`Replanned: ${view.changes.length} step${view.changes.length === 1 ? "" : "s"} moved.`);
  }

  return lines.join("\n");
}

/** The conflict a persisted keep-temps plan still has, rebuilt for the board banner. */
function storedConflict(plan: ActivePlan, dishes: Dish[], kitchen: Kitchen): PlanConflict | null {
  if (plan.option !== "keep-temps") return null;
  const options = planOptions({ dishes, dishIds: plan.dishIds, serveAt: plan.serveAt, kitchen });
  return options.primary.feasible ? options.conflict : null;
}

/** Send the oven question and fold the answer into an option id. */
async function askOvenQuestion(server: McpServer, conflict: PlanConflict): Promise<"share-oven" | "keep-temps"> {
  const question = buildOvenQuestion(conflict);
  const result = await server.server.elicitInput({
    mode: "form",
    message: question.message,
    requestedSchema: question.requestedSchema,
  });
  return choiceFromElicitResult(result);
}

function viewOf(
  ctx: ServerContext,
  schedule: ScheduleResult,
  plan: Pick<ActivePlan, "dishIds" | "option" | "revision" | "originalServeAt">,
  conflict: PlanConflict | null,
  changes: PlanView["changes"],
): PlanView {
  return buildPlanView({
    schedule,
    dishIds: plan.dishIds,
    dishes: ctx.dishes,
    kitchen: ctx.store.getKitchen(),
    option: plan.option,
    revision: plan.revision,
    originalServeAt: plan.originalServeAt,
    now: ctx.clock.nowMinutes(),
    demoClock: ctx.clock.demoClock,
    conflict,
    changes,
  });
}

export function registerPlanTools(server: McpServer, ctx: ServerContext): void {
  registerAppTool(
    server,
    "plan_dinner",
    {
      title: "Plan Dinner",
      description:
        "Build the backwards schedule for a multi-dish dinner so every dish lands hot at one serve time. Pass the catalog dish ids (call list_dishes first if unsure) and the serve time as 24-hour HH:MM. If the one oven forces a choice between sharing its temperature and keeping the recipe temperatures, ask the user with elicitation (or pass option) and the plan comes back either way. Each call replaces the active plan and returns the board.",
      inputSchema: z.object({
        dishes: z.array(z.string()).min(1).max(8).describe("Dish ids from list_dishes, at most 8."),
        serveAt: z.string().describe('Serve time on the 24-hour clock, e.g. "19:00".'),
        option: z
          .enum(["share-oven", "keep-temps"])
          .optional()
          .describe("Skip the question: pick how to handle the oven conflict yourself."),
      }),
      outputSchema: PlanViewSchema,
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ dishes, serveAt, option }): Promise<ToolResult> => {
      let serveMinutes: number;
      try {
        serveMinutes = parseTime(serveAt);
      } catch {
        return errorResult(`Serve time must be a 24-hour "HH:MM" time such as "19:00" (got "${serveAt}").`);
      }

      const known = new Set(ctx.dishes.map((dish) => dish.id));
      const unknown = dishes.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return errorResult(`Unknown dish id: ${unknown.join(", ")}. Call list_dishes to see the ids.`);
      }
      const dishIds = [...new Set(dishes)];

      const now = ctx.clock.nowMinutes();
      const kitchen = ctx.store.getKitchen();
      const options = planOptions({ dishes: ctx.dishes, dishIds, serveAt: serveMinutes, kitchen, now });

      if (!options.primary.feasible) {
        // §6.2.4: nothing fits at this serve time; say when it would.
        const earliest = findEarliestServe({
          dishes: ctx.dishes,
          dishIds,
          kitchen,
          from: serveMinutes,
          now,
        });
        if (earliest.serveAt === null) {
          return errorResult(`Too late to serve at ${formatTime12h(serveMinutes)}. I can't fit everything before midnight.`);
        }
        return errorResult(
          `Too late to serve at ${formatTime12h(serveMinutes)}. The earliest I can land everything is ${formatTime12h(earliest.serveAt)}.`,
        );
      }

      let schedule: ScheduleResult = options.primary;
      let chosen: PlanOption = "primary";
      let conflict: PlanConflict | null = options.conflict;

      if (options.conflict) {
        const shareOven = options.shareOven;
        if (option === "keep-temps") {
          chosen = "keep-temps";
        } else if (option === "share-oven" && shareOven) {
          schedule = shareOven;
          chosen = "share-oven";
          conflict = null;
        } else if (!option && shareOven && supportsFormElicitation(server.server.getClientCapabilities()?.elicitation)) {
          const answer = await askOvenQuestion(server, options.conflict);
          if (answer === "share-oven") {
            schedule = shareOven;
            chosen = "share-oven";
            conflict = null;
          } else {
            chosen = "keep-temps";
          }
        } else {
          // No option given and no way to ask: keep the recipes and show the choice on the board.
          chosen = "keep-temps";
        }
      }

      const plan: ActivePlan = {
        dishIds,
        serveAt: schedule.serveAt,
        originalServeAt: serveMinutes,
        option: chosen,
        altSteps: chosen === "share-oven" ? options.altSteps : [],
        steps: toPlanRecords(schedule),
        revision: 1,
      };
      ctx.store.setActivePlan(plan);

      return planResult(viewOf(ctx, schedule, plan, conflict, []));
    },
  );

  registerAppTool(
    server,
    "whats_next",
    {
      title: "What's Next",
      description:
        "Read the active plan as a departure board: every step with its time, station and status (done / active / upcoming), the next three steps to start, and where each dish lands. Read-only — it never changes the plan.",
      inputSchema: z.object({}),
      outputSchema: PlanViewSchema,
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async (): Promise<ToolResult> => {
      const plan = ctx.store.getActivePlan();
      if (!plan) return errorResult(NO_PLAN_HINT);
      const schedule = hydratePlan(plan, ctx.dishes);
      return planResult(viewOf(ctx, schedule, plan, storedConflict(plan, ctx.dishes, ctx.store.getKitchen()), []));
    },
  );

  registerAppTool(
    server,
    "report_delay",
    {
      title: "Report Delay",
      description:
        "A dish or step is running late: push the active plan out until the kitchen is feasible again and return the new board with the steps that moved. target is a step id or a dish id (a dish means the step that is cooking now, or the next one).",
      inputSchema: z.object({
        target: z.string().describe("Step id (e.g. \"turkey.roast\") or dish id (e.g. \"turkey\")."),
        minutes: z.number().int().min(1).max(180).describe("How many minutes late, 1-180."),
      }),
      outputSchema: PlanViewSchema,
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ target, minutes }): Promise<ToolResult> => {
      const plan = ctx.store.getActivePlan();
      if (!plan) return errorResult(NO_PLAN_HINT);

      const kitchen = ctx.store.getKitchen();
      const now = ctx.clock.nowMinutes();
      let result: ReturnType<typeof replan>;
      try {
        result = replan({
          dishes: ctx.dishes,
          dishIds: plan.dishIds,
          kitchen,
          plan: hydratePlan(plan, ctx.dishes),
          serveAt: plan.serveAt,
          originalServeAt: plan.originalServeAt,
          now,
          target,
          minutes,
          altSteps: plan.altSteps,
        });
      } catch (error) {
        if (error instanceof ReplanError) return errorResult(error.message);
        throw error;
      }

      const next: ActivePlan = {
        ...plan,
        serveAt: result.serveAt,
        originalServeAt: result.originalServeAt,
        revision: plan.revision + 1,
        steps: toPlanRecords(result.schedule),
      };
      ctx.store.setActivePlan(next);

      return planResult(
        viewOf(ctx, result.schedule, next, storedConflict(next, ctx.dishes, kitchen), result.changes),
      );
    },
  );

  registerBoardResource(server);

  server.registerPrompt(
    "thanksgiving",
    {
      title: "Thanksgiving dinner",
      description: "Plan the Thanksgiving menu for 7:00 PM: turkey, stuffing, mashed potatoes, green beans, gravy and rolls.",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Plan Thanksgiving dinner for 7:00 PM: turkey, stuffing, mashed potatoes, green beans, gravy and rolls.",
          },
        },
      ],
    }),
  );
}
