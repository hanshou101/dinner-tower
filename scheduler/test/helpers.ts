import fixture from "../fixtures/thanksgiving.json";
import type { Dish, Kitchen, ScheduledStep, ScheduleResult } from "../src/types";
import { formatTime } from "../src/time";

export const kitchen = (fixture as { kitchen: Kitchen }).kitchen;
export const dishes = (fixture as { dishes: Dish[] }).dishes;

/** SPEC §5: the golden menu order. */
export const GOLDEN_MENU = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];

/** 19:00 */
export const SERVE_AT = 19 * 60;

export function stepOf(plan: ScheduleResult, stepId: string): ScheduledStep {
  const step = plan.steps.find((s) => s.stepId === stepId);
  if (!step) throw new Error(`step ${stepId} is missing from the plan`);
  return step;
}

/** "15:10–15:30" */
export function range(step: ScheduledStep): string {
  return `${formatTime(step.start)}–${formatTime(step.end)}`;
}

/** Minutes since midnight from "HH:MM". */
export function at(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export const GOLDEN_STEP_IDS = [
  "turkey.prep",
  "turkey.roast",
  "turkey.rest",
  "stuffing.prep",
  "stuffing.bake",
  "mashed_potatoes.peel",
  "mashed_potatoes.boil",
  "mashed_potatoes.mash",
  "green_beans.trim",
  "green_beans.blanch",
  "green_beans.saute",
  "gravy.make",
  "rolls.bake",
];
