import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Dish catalog — the data model of SPEC §6.2.1.
 * `server/catalog/dishes.json` is the single source; the scheduler fixtures and
 * this catalog must agree on every number.
 */

export type Resource = "oven" | "burner" | "hands";

export interface StepAlternative {
  ovenTempF: number;
  minutes: number;
}

export interface Step {
  id: string;
  label: string;
  minutes: number;
  uses: Resource[];
  /** Required when `uses` contains "oven". */
  ovenTempF?: number;
  /** Alternative way to cook the step (used when dishes share one oven). */
  alt?: StepAlternative;
  /** Step ids that must finish first; may point at another dish (e.g. gravy after turkey.roast). */
  after?: string[];
}

export interface Dish {
  id: string;
  name: string;
  icon: string;
  holdMinutes: number;
  steps: Step[];
}

/** Shape `list_dishes` returns (SPEC §6.3). */
export interface DishSummary {
  id: string;
  name: string;
  icon: string;
  holdMinutes: number;
  totalMinutes: number;
  ovenTempsF: number[];
}

export const DEFAULT_CATALOG_PATH = fileURLToPath(new URL("../catalog/dishes.json", import.meta.url));

export function loadCatalog(path: string = DEFAULT_CATALOG_PATH): Dish[] {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`dish catalog at ${path} must be a JSON array`);
  }
  return parsed as Dish[];
}

export function totalMinutes(dish: Dish): number {
  return dish.steps.reduce((sum, step) => sum + step.minutes, 0);
}

/** Unique recipe oven temperatures, in the order the steps declare them. */
export function ovenTempsF(dish: Dish): number[] {
  const temps = new Set<number>();
  for (const step of dish.steps) {
    if (typeof step.ovenTempF === "number") temps.add(step.ovenTempF);
  }
  return [...temps];
}

export function summarizeDishes(dishes: Dish[]): DishSummary[] {
  return dishes.map((dish) => ({
    id: dish.id,
    name: dish.name,
    icon: dish.icon,
    holdMinutes: dish.holdMinutes,
    totalMinutes: totalMinutes(dish),
    ovenTempsF: ovenTempsF(dish),
  }));
}
