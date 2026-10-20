/**
 * §6.2.5 replan: resolve what the user is delaying, re-run the scheduler with a
 * later serve time until the plan is feasible again, and diff old against new.
 */
import { schedule } from "./schedule.js";
import { formatRange } from "./time.js";
import type { Dish, FixedStep, Kitchen, ScheduleResult, ScheduledStep } from "./types.js";

const LAST_SERVE_MINUTE = 23 * 60 + 55;

export class ReplanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplanError";
  }
}

export interface ReplanContext {
  dishes: Dish[];
  dishIds: string[];
  kitchen: Kitchen;
  /** The plan that is currently on the board. */
  plan: ScheduleResult;
  /** Its serve time (not the original one, unless this is the first delay). */
  serveAt: number;
  /** The first serve time the user asked for; it never moves. */
  originalServeAt?: number;
  now: number;
  /** Step id, or dish id. */
  target: string;
  minutes: number;
  altSteps?: Iterable<string>;
}

export interface PlanChange {
  stepId: string;
  label: string;
  /** "HH:MM–HH:MM" */
  from: string;
  to: string;
}

export interface ReplanResult {
  serveAt: number;
  originalServeAt: number;
  schedule: ScheduleResult;
  changes: PlanChange[];
  targetStepId: string;
}

/** §6.2.5 step 1: step id first, then dish id (in-progress step, else the next one). */
export function resolveTarget(plan: ScheduleResult, target: string, now: number): ScheduledStep {
  const direct = plan.steps.find((step) => step.stepId === target);
  if (direct) {
    if (direct.end <= now) throw new ReplanError(`${direct.label} is already done.`);
    return direct;
  }

  const dishSteps = plan.steps.filter((step) => step.dishId === target).sort((a, b) => a.start - b.start);
  if (dishSteps.length === 0) {
    throw new ReplanError(`Unknown target "${target}". Use a dish id or a step id from the current plan.`);
  }
  const active = dishSteps.find((step) => step.start <= now && now < step.end);
  if (active) return active;

  const upcoming = dishSteps.find((step) => step.start > now);
  if (!upcoming) throw new ReplanError(`Nothing left to delay for ${target}.`);
  if (upcoming.end <= now) throw new ReplanError(`${upcoming.label} is already done.`);
  return upcoming;
}

export function replan(ctx: ReplanContext): ReplanResult {
  const target = resolveTarget(ctx.plan, ctx.target, ctx.now);

  // 2. Everything already under way keeps its slot; only the target grows.
  const fixed = new Map<string, FixedStep>();
  for (const step of ctx.plan.steps) {
    if (step.start < ctx.now) {
      fixed.set(step.stepId, { start: step.start, end: step.end, oven: step.oven, ovenTempF: step.ovenTempF });
    }
  }
  const extra = new Map<string, number>();
  const fixedTarget = fixed.get(target.stepId);
  if (fixedTarget) fixedTarget.end += ctx.minutes;
  else extra.set(target.stepId, ctx.minutes);

  // 3. Push the serve time out in five-minute steps until nothing is violated.
  let firstFeasible: { serveAt: number; schedule: ScheduleResult } | null = null;
  let winner: { serveAt: number; schedule: ScheduleResult } | null = null;
  for (let offset = 0; ctx.serveAt + offset <= LAST_SERVE_MINUTE; offset += 5) {
    const serveAt = ctx.serveAt + offset;
    const result = schedule({
      dishes: ctx.dishes,
      dishIds: ctx.dishIds,
      kitchen: ctx.kitchen,
      serveAt,
      altSteps: ctx.altSteps ?? [],
      fixed,
      now: ctx.now,
      extra,
    });
    if (!result.feasible) continue;
    if (!firstFeasible) firstFeasible = { serveAt, schedule: result };
    if (result.violations.length === 0) {
      winner = { serveAt, schedule: result };
      break;
    }
  }
  const chosen = winner ?? firstFeasible;
  if (!chosen) throw new ReplanError("The kitchen can't fit that delay before midnight.");

  // 4. Changes: steps whose start or end moved, in board order.
  const before = new Map(ctx.plan.steps.map((step) => [step.stepId, step]));
  const changes: PlanChange[] = [];
  for (const step of chosen.schedule.steps) {
    const previous = before.get(step.stepId);
    if (!previous) continue;
    if (previous.start === step.start && previous.end === step.end) continue;
    changes.push({
      stepId: step.stepId,
      label: step.label,
      from: formatRange(previous.start, previous.end),
      to: formatRange(step.start, step.end),
    });
  }

  return {
    serveAt: chosen.serveAt,
    originalServeAt: ctx.originalServeAt ?? ctx.serveAt,
    schedule: chosen.schedule,
    changes,
    targetStepId: target.stepId,
  };
}
