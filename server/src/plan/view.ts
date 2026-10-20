import { z } from "zod";
import {
  formatTime,
  type PlanChange,
  type PlanConflict,
  type ScheduleResult,
  type ScheduledStep,
} from "../../../scheduler/src/index.js";
import type { Dish, Resource, Step } from "../catalog.js";
import type { ActivePlan, Kitchen, PlanOption, PlanStepRecord } from "../store.js";

/**
 * `PlanView` — the one output shape of `plan_dinner`, `whats_next` and
 * `report_delay` (SPEC §6.3). T5 renders it, so the field names and types are
 * frozen: the interface below is the SPEC text verbatim, and the zod schema is
 * the same shape as a schema (it becomes `outputSchema` in `tools/list`).
 *
 * Times on the wire are "HH:MM" (24-hour); the scheduler works in minutes since
 * midnight and `hydratePlan` / `toPlanRecords` convert at this boundary.
 */

export interface PlanView {
  serveAt: string;
  originalServeAt: string;
  now: string;
  demoClock: boolean;
  option: "primary" | "share-oven" | "keep-temps";
  revision: number;
  kitchen: Kitchen;
  dishes: {
    id: string;
    name: string;
    icon: string;
    readyAt: string;
    waitMinutes: number;
    holdMinutes: number;
    ok: boolean;
  }[];
  steps: {
    stepId: string;
    dishId: string;
    dishName: string;
    icon: string;
    label: string;
    start: string;
    end: string;
    minutes: number;
    uses: Resource[];
    oven: number | null;
    ovenTempF: number | null;
    usedAlt: boolean;
    status: "done" | "active" | "upcoming";
  }[];
  next: string[];
  conflict: null | {
    message: string;
    options: { id: "share-oven" | "keep-temps"; label: string }[];
    waits: { dishId: string; readyAt: string; waitMinutes: number }[];
  };
  changes: { stepId: string; label: string; from: string; to: string }[];
}

const RESOURCE = z.enum(["oven", "burner", "hands"]);
const STEP_STATUS = z.enum(["done", "active", "upcoming"]);
const OPTION = z.enum(["primary", "share-oven", "keep-temps"]);
const CONFLICT_OPTION = z.enum(["share-oven", "keep-temps"]);

export const KITCHEN_SCHEMA = z.object({
  ovens: z.number().int(),
  ovenRacks: z.number().int(),
  burners: z.number().int(),
  cooks: z.number().int(),
  ovenSwitchMinutes: z.number().int(),
});

/** The `outputSchema` of the three planning tools. */
export const PlanViewSchema = z.object({
    serveAt: z.string().describe("Serve time, 24-hour HH:MM."),
    originalServeAt: z.string().describe("The serve time first asked for; delays never move it."),
    now: z.string().describe("The kitchen clock when this view was built, 24-hour HH:MM."),
    demoClock: z.boolean().describe("True when the demo clock (DEMO_MODE) is driving `now`."),
    option: OPTION,
    revision: z.number().int().describe("1 for a new plan, +1 for every successful replan."),
    kitchen: KITCHEN_SCHEMA,
    dishes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        readyAt: z.string(),
        waitMinutes: z.number().int(),
        holdMinutes: z.number().int(),
        ok: z.boolean(),
      }),
    ),
    steps: z.array(
      z.object({
        stepId: z.string(),
        dishId: z.string(),
        dishName: z.string(),
        icon: z.string(),
        label: z.string(),
        start: z.string(),
        end: z.string(),
        minutes: z.number().int(),
        uses: z.array(RESOURCE),
        oven: z.number().int().nullable(),
        ovenTempF: z.number().int().nullable(),
        usedAlt: z.boolean(),
        status: STEP_STATUS,
      }),
    ),
    next: z.array(z.string()).describe("Up to three upcoming step ids, earliest first."),
    conflict: z.union([
      z.null(),
      z.object({
        message: z.string(),
        options: z.array(z.object({ id: CONFLICT_OPTION, label: z.string() })),
        waits: z.array(z.object({ dishId: z.string(), readyAt: z.string(), waitMinutes: z.number().int() })),
      }),
    ]),
    changes: z
      .array(z.object({ stepId: z.string(), label: z.string(), from: z.string(), to: z.string() }))
      .describe("Steps that moved; only report_delay fills this."),
  }) satisfies z.ZodType<PlanView>;

/** Catalog index: step id → its dish and step definition. */
function indexSteps(dishes: Dish[]): Map<string, { dish: Dish; step: Step }> {
  const index = new Map<string, { dish: Dish; step: Step }>();
  for (const dish of dishes) {
    for (const step of dish.steps) index.set(step.id, { dish, step });
  }
  return index;
}

/**
 * Rebuild the scheduler's `ScheduleResult` from the plan stored in
 * `household.json`. The store keeps only what the board needs (ids, times,
 * oven slots); labels, icons and resource lists come back from the catalog, so
 * `report_delay` can hand the engine exactly the plan it produced earlier.
 */
export function hydratePlan(plan: ActivePlan, dishes: Dish[]): ScheduleResult {
  const index = indexSteps(dishes);
  const steps: ScheduledStep[] = [];
  for (const record of plan.steps) {
    const entry = index.get(record.stepId);
    if (!entry) continue; // a dish left the catalog between runs — drop it, don't crash the board
    steps.push({
      stepId: record.stepId,
      dishId: entry.dish.id,
      dishName: entry.dish.name,
      icon: entry.dish.icon,
      label: entry.step.label,
      minutes: record.minutes,
      uses: [...entry.step.uses],
      start: record.start,
      end: record.end,
      oven: record.oven,
      ovenTempF: record.ovenTempF,
      usedAlt: record.usedAlt,
    });
  }
  steps.sort((a, b) => a.start - b.start || (a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0));

  const readyAt: Record<string, number> = {};
  const waits: Record<string, number> = {};
  const violations: ScheduleResult["violations"] = [];
  for (const dishId of plan.dishIds) {
    const dish = dishes.find((candidate) => candidate.id === dishId);
    const last = dish?.steps[dish.steps.length - 1];
    if (!dish || !last) continue;
    const placed = steps.find((step) => step.stepId === last.id);
    if (!placed) continue;
    readyAt[dish.id] = placed.end;
    const wait = plan.serveAt - placed.end;
    waits[dish.id] = wait;
    if (wait < 0 || wait > dish.holdMinutes) {
      violations.push({
        dishId: dish.id,
        dishName: dish.name,
        readyAt: placed.end,
        waitMinutes: wait,
        holdMinutes: dish.holdMinutes,
      });
    }
  }

  return { feasible: true, serveAt: plan.serveAt, steps, readyAt, waits, violations };
}

/** The inverse: the compact record `household.json` keeps. */
export function toPlanRecords(result: ScheduleResult): PlanStepRecord[] {
  return result.steps.map((step) => ({
    stepId: step.stepId,
    start: step.start,
    end: step.end,
    minutes: step.minutes,
    oven: step.oven,
    ovenTempF: step.ovenTempF,
    usedAlt: step.usedAlt,
  }));
}

export interface BuildViewInput {
  schedule: ScheduleResult;
  dishIds: string[];
  dishes: Dish[];
  kitchen: Kitchen;
  option: PlanOption;
  revision: number;
  originalServeAt: number;
  now: number;
  demoClock: boolean;
  conflict: PlanConflict | null;
  changes: PlanChange[];
}

function statusOf(step: ScheduledStep, now: number): "done" | "active" | "upcoming" {
  if (step.end <= now) return "done";
  if (step.start <= now) return "active";
  return "upcoming";
}

export function buildPlanView(input: BuildViewInput): PlanView {
  const { schedule, now } = input;
  const dishes: PlanView["dishes"] = [];
  for (const dishId of input.dishIds) {
    const dish = input.dishes.find((candidate) => candidate.id === dishId);
    if (!dish) continue;
    const readyAt = schedule.readyAt[dish.id] ?? schedule.serveAt;
    const waitMinutes = schedule.waits[dish.id] ?? 0;
    dishes.push({
      id: dish.id,
      name: dish.name,
      icon: dish.icon,
      readyAt: formatTime(readyAt),
      waitMinutes,
      holdMinutes: dish.holdMinutes,
      ok: waitMinutes >= 0 && waitMinutes <= dish.holdMinutes,
    });
  }

  const steps: PlanView["steps"] = schedule.steps.map((step) => ({
    stepId: step.stepId,
    dishId: step.dishId,
    dishName: step.dishName,
    icon: step.icon,
    label: step.label,
    start: formatTime(step.start),
    end: formatTime(step.end),
    minutes: step.minutes,
    uses: [...step.uses],
    oven: step.oven,
    ovenTempF: step.ovenTempF,
    usedAlt: step.usedAlt,
    status: statusOf(step, now),
  }));

  const next = steps
    .filter((step) => step.status === "upcoming")
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.stepId < b.stepId ? -1 : 1))
    .slice(0, 3)
    .map((step) => step.stepId);

  return {
    serveAt: formatTime(schedule.serveAt),
    originalServeAt: formatTime(input.originalServeAt),
    now: formatTime(now),
    demoClock: input.demoClock,
    option: input.option,
    revision: input.revision,
    kitchen: { ...input.kitchen },
    dishes,
    steps,
    next,
    conflict: input.conflict
      ? {
          message: input.conflict.message,
          options: input.conflict.options.map((option) => ({ id: option.id, label: option.label })),
          waits: input.conflict.waits.map((violation) => ({
            dishId: violation.dishId,
            readyAt: formatTime(violation.readyAt),
            waitMinutes: violation.waitMinutes,
          })),
        }
      : null,
    changes: input.changes.map((change) => ({
      stepId: change.stepId,
      label: change.label,
      from: change.from,
      to: change.to,
    })),
  };
}
