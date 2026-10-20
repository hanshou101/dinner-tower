/**
 * §6.2.3 conflict options (share the oven vs keep recipe temperatures) and
 * §6.2.4 "too late" earliest-serve search.
 */
import { schedule } from "./schedule.js";
import { formatDuration, formatTime12h } from "./time.js";
import type { Dish, FixedStep, Kitchen, ScheduleResult, Violation } from "./types.js";

export interface OptionContext {
  dishes: Dish[];
  dishIds: string[];
  serveAt: number;
  kitchen: Kitchen;
  now?: number | null;
  fixed?: Map<string, FixedStep>;
  extra?: Map<string, number>;
}

export interface PlanOption {
  id: "share-oven" | "keep-temps";
  label: string;
}

export interface PlanConflict {
  message: string;
  options: PlanOption[];
  waits: Violation[];
}

export interface PlanOptions {
  /** Recipe-temperature plan (always computed). */
  primary: ScheduleResult;
  /** Steps switched to their alternative when the share-oven plan was accepted. */
  altSteps: string[];
  /** Share-oven plan, when it is worth offering; otherwise null. */
  shareOven: ScheduleResult | null;
  /** null when the primary plan has no violation. */
  conflict: PlanConflict | null;
}

const LAST_SERVE_MINUTE = 23 * 60 + 55; // "before midnight" cut-off, §6.2.4

function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * §6.2.3 share-oven iteration: start from the recipe-temperature plan, and while
 * a dish is in violation, switch that dish's alt-capable step over. Stop when
 * nothing new can be switched.
 */
function iterateShareOven(ctx: OptionContext, primary: ScheduleResult): { altSteps: Set<string>; result: ScheduleResult } {
  const alt = new Set<string>();
  let current = primary;
  for (;;) {
    const additions: string[] = [];
    for (const violation of current.violations) {
      const dish = ctx.dishes.find((d) => d.id === violation.dishId);
      if (!dish) continue;
      for (const step of dish.steps) {
        if (step.alt && !alt.has(step.id) && !additions.includes(step.id)) additions.push(step.id);
      }
    }
    if (additions.length === 0) break;
    for (const id of additions) alt.add(id);
    current = schedule({ ...ctx, altSteps: [...alt] });
  }
  return { altSteps: alt, result: current };
}

export function planOptions(ctx: OptionContext): PlanOptions {
  const primary = schedule({ ...ctx, altSteps: [] });
  if (!primary.feasible || primary.violations.length === 0) {
    return { primary, altSteps: [], shareOven: null, conflict: null };
  }

  const { altSteps, result: shareOven } = iterateShareOven(ctx, primary);
  const offered =
    altSteps.size > 0 && shareOven.feasible && shareOven.violations.length < primary.violations.length;

  const message =
    `Your oven can only hold one temperature at a time, so ${andList(
      primary.violations.map((v) => v.dishName),
    )} would finish early and wait too long. How should I plan it?`;

  const options: PlanOption[] = [];
  if (offered) {
    options.push({ id: "share-oven", label: shareOvenLabel(ctx, altSteps, shareOven.serveAt) });
  }
  options.push({ id: "keep-temps", label: keepTempsLabel(primary.violations) });

  return {
    primary,
    altSteps: offered ? [...altSteps] : [],
    shareOven: offered ? shareOven : null,
    conflict: { message, options, waits: primary.violations },
  };
}

function shareOvenLabel(ctx: OptionContext, altSteps: Set<string>, serveAt: number): string {
  const dishNames: string[] = [];
  const temps = new Set<number>();
  for (const dishId of ctx.dishIds) {
    const dish = ctx.dishes.find((d) => d.id === dishId);
    if (!dish) continue;
    for (const step of dish.steps) {
      if (!altSteps.has(step.id) || !step.alt) continue;
      temps.add(step.alt.ovenTempF);
      if (!dishNames.includes(dish.name)) dishNames.push(dish.name);
    }
  }
  const tempLabel = [...temps].sort((a, b) => a - b).join("/");
  return `Share the oven: bake ${andList(dishNames)} at ${tempLabel}°F alongside the rest — everything lands at ${formatTime12h(
    serveAt,
  )}.`;
}

function keepTempsLabel(violations: Violation[]): string {
  const parts = violations.map(
    (v) => `${v.dishName} is ready at ${formatTime12h(v.readyAt)} and waits ${formatDuration(v.waitMinutes)}`,
  );
  return `Keep recipe temperatures: ${parts.join("; ")}.`;
}

export interface EarliestServeInput {
  dishes: Dish[];
  dishIds: string[];
  kitchen: Kitchen;
  /** The serve time the user asked for. */
  from: number;
  now: number;
}

export interface EarliestServe {
  ok: boolean;
  /** The earlier of the two scenarios; null when nothing fits before midnight. */
  serveAt: number | null;
  /** Earliest serve time with recipe temperatures. */
  noAlt: number | null;
  /** Earliest serve time with every alt step switched on. */
  allAlt: number | null;
}

/**
 * §6.2.4: with the primary plan infeasible, try serve times from `from + 5` in
 * five-minute steps, once without alt steps and once with all of them, and keep
 * the earlier hit. Wait violations are ignored here — this is about whether the
 * cooking physically fits.
 */
export function findEarliestServe(input: EarliestServeInput): EarliestServe {
  const allAltSteps = new Set<string>();
  for (const dish of input.dishes) for (const step of dish.steps) if (step.alt) allAltSteps.add(step.id);

  const search = (altSteps: Iterable<string>): number | null => {
    for (let serveAt = input.from + 5; serveAt <= LAST_SERVE_MINUTE; serveAt += 5) {
      const result = schedule({
        dishes: input.dishes,
        dishIds: input.dishIds,
        kitchen: input.kitchen,
        serveAt,
        altSteps,
        now: input.now,
      });
      if (result.feasible) return serveAt;
    }
    return null;
  };

  const noAlt = search([]);
  const allAlt = search(allAltSteps);
  const candidates = [noAlt, allAlt].filter((value): value is number => value !== null);
  if (candidates.length === 0) return { ok: false, serveAt: null, noAlt, allAlt };
  return { ok: true, serveAt: Math.min(...candidates), noAlt, allAlt };
}
