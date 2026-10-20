/**
 * `validatePlan()` — AC-3 (a)–(d), checked from the finished plan alone.
 *
 * This file deliberately shares no code with schedule.ts: it re-derives occupancy
 * from the step list, so a bug in the greedy scheduler cannot hide behind the
 * same bug in the check.
 */
import type { Dish, Kitchen, ScheduledStep } from "./types.js";

const MINUTES_PER_DAY = 1440;

export interface ValidateInput {
  dishes: Dish[];
  dishIds: string[];
  kitchen: Kitchen;
  serveAt: number;
  steps: ScheduledStep[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inRange(start: number, end: number): number[] {
  const minutes: number[] = [];
  for (let m = Math.max(0, start); m < Math.min(MINUTES_PER_DAY, end); m++) minutes.push(m);
  return minutes;
}

export function validatePlan(input: ValidateInput): ValidationResult {
  const { kitchen, serveAt, steps } = input;
  const errors: string[] = [];
  const catalog = new Map(input.dishes.map((dish) => [dish.id, dish]));

  for (const step of steps) {
    if (!(step.start >= 0) || !(step.end <= MINUTES_PER_DAY) || step.end <= step.start) {
      errors.push(`${step.stepId}: invalid interval ${step.start}–${step.end} (minutes of day 0–1439).`);
    }
  }

  // (a) per-minute heads, burners, oven trays.
  const hands = new Array<number>(MINUTES_PER_DAY).fill(0);
  const burners = new Array<number>(MINUTES_PER_DAY).fill(0);
  const trays = Array.from({ length: kitchen.ovens + 1 }, () => new Array<number>(MINUTES_PER_DAY).fill(0));
  const handsReported = new Set<number>();
  const burnerReported = new Set<number>();
  const trayReported = new Set<number>();
  const tempReported = new Set<number>();
  for (const step of steps) {
    for (const m of inRange(step.start, step.end)) {
      if (step.uses.includes("hands")) hands[m]! += 1;
      if (step.uses.includes("burner")) burners[m]! += 1;
    }
    if (step.uses.includes("oven")) {
      if (step.oven === null || step.oven < 1 || step.oven > kitchen.ovens) {
        errors.push(`${step.stepId}: uses the oven but its oven number is ${step.oven}.`);
        continue;
      }
      for (const m of inRange(step.start, step.end)) trays[step.oven]![m]! += 1;
    }
  }

  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    if (hands[m]! > kitchen.cooks && !handsReported.has(hands[m]!)) {
      handsReported.add(hands[m]!);
      const names = steps.filter((s) => s.uses.includes("hands") && s.start <= m && m < s.end).map((s) => s.stepId);
      errors.push(`hands: ${hands[m]} steps overlap at ${hhmm(m)} with only ${kitchen.cooks} cooks (${names.join(", ")}).`);
    }
    if (burners[m]! > kitchen.burners && !burnerReported.has(burners[m]!)) {
      burnerReported.add(burners[m]!);
      errors.push(`burners: ${burners[m]} burners in use at ${hhmm(m)} with only ${kitchen.burners} available.`);
    }
  }
  for (let oven = 1; oven <= kitchen.ovens; oven++) {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const count = trays[oven]![m]!;
      if (count > kitchen.ovenRacks && !trayReported.has(count)) {
        trayReported.add(count);
        errors.push(`oven ${oven}: ${count} trays at ${hhmm(m)} but the oven holds ${kitchen.ovenRacks} racks.`);
      }
    }
  }

  // (b) one temperature at a time, and a full switch gap between recipes.
  for (let oven = 1; oven <= kitchen.ovens; oven++) {
    const tempAt = new Array<number>(MINUTES_PER_DAY).fill(0);
    for (const step of steps) {
      if (!step.uses.includes("oven") || step.oven !== oven || step.ovenTempF === null) continue;
      for (const m of inRange(step.start, step.end)) {
        if (tempAt[m] !== 0 && tempAt[m] !== step.ovenTempF) {
          if (!tempReported.has(oven)) {
            tempReported.add(oven);
            errors.push(
              `oven ${oven}: ${tempAt[m]}°F and ${step.ovenTempF}°F are both in the oven at ${hhmm(m)} — one temperature at a time.`,
            );
          }
        }
        tempAt[m] = step.ovenTempF;
      }
    }

    // Runs of the same temperature; consecutive, different runs need ovenSwitchMinutes between them.
    const segments: { start: number; end: number; tempF: number }[] = [];
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const temp = tempAt[m]!;
      if (temp === 0) continue;
      const last = segments[segments.length - 1];
      if (last && last.end === m && last.tempF === temp) last.end = m + 1;
      else segments.push({ start: m, end: m + 1, tempF: temp });
    }
    for (let i = 1; i < segments.length; i++) {
      const previous = segments[i - 1]!;
      const current = segments[i]!;
      if (previous.tempF === current.tempF) continue;
      const gap = current.start - previous.end;
      if (gap < kitchen.ovenSwitchMinutes) {
        errors.push(
          `oven ${oven}: ${previous.tempF}°F → ${current.tempF}°F at ${hhmm(previous.end)} leaves ${gap} minutes to switch; ${kitchen.ovenSwitchMinutes} required.`,
        );
      }
    }
  }

  // (c) dependencies, including cross-dish ones such as gravy.make → turkey.roast.
  const byStepId = new Map(steps.map((step) => [step.stepId, step]));
  for (const step of steps) {
    const dish = catalog.get(step.dishId);
    const definition = dish?.steps.find((s) => s.id === step.stepId);
    if (!definition) continue;
    for (const dependencyId of definition.after ?? []) {
      const dependency = byStepId.get(dependencyId);
      if (!dependency) continue;
      if (step.start < dependency.end) {
        errors.push(
          `${step.stepId} starts at ${hhmm(step.start)} but ${dependencyId} only ends at ${hhmm(dependency.end)}.`,
        );
      }
    }
  }

  // (d) every dish is ready inside its hold window.
  const lastStepOf = new Map<string, string>();
  for (const dish of input.dishes) {
    const last = dish.steps[dish.steps.length - 1];
    if (last) lastStepOf.set(dish.id, last.id);
  }
  for (const dishId of input.dishIds) {
    const dish = catalog.get(dishId);
    if (!dish) continue;
    const lastStepId = lastStepOf.get(dish.id);
    if (!lastStepId) continue;
    const lastStep = byStepId.get(lastStepId);
    if (!lastStep) continue;
    const earliest = serveAt - dish.holdMinutes;
    if (lastStep.end < earliest || lastStep.end > serveAt) {
      errors.push(
        `${dish.id} is ready at ${hhmm(lastStep.end)}, outside its hold window ${hhmm(earliest)}–${hhmm(serveAt)} (hold ${dish.holdMinutes} min).`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
