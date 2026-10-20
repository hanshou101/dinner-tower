/** Data model — SPEC §6.2.1, verbatim. */

export type Resource = "oven" | "burner" | "hands";

export interface StepAlt {
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
  /** Alternative when the oven is shared: same tray, another temperature/time. */
  alt?: StepAlt;
  /** Step ids this step waits for (may cross dishes). */
  after?: string[];
}

export interface Dish {
  id: string;
  name: string;
  icon: string;
  holdMinutes: number;
  steps: Step[];
}

export interface Kitchen {
  ovens: number;
  ovenRacks: number;
  burners: number;
  cooks: number;
  ovenSwitchMinutes: number;
}

/** SPEC §5: the golden kitchen. */
export const GOLDEN_KITCHEN: Kitchen = {
  ovens: 1,
  ovenRacks: 2,
  burners: 4,
  cooks: 2,
  ovenSwitchMinutes: 10,
};

/** A step that has already started; it keeps its slot and may only be extended. */
export interface FixedStep {
  start: number;
  end: number;
  /** 1-based oven number, or null when the step does not use an oven. */
  oven: number | null;
  ovenTempF: number | null;
}

export interface ScheduleInput {
  dishes: Dish[];
  dishIds: string[];
  /** Minute of day; the plan never crosses midnight. */
  serveAt: number;
  kitchen: Kitchen;
  altSteps?: Iterable<string>;
  fixed?: Map<string, FixedStep>;
  /** Lower bound: nothing may start before this minute. */
  now?: number | null;
  /** Extra minutes for steps that have not started yet. */
  extra?: Map<string, number>;
}

export interface ScheduledStep {
  stepId: string;
  dishId: string;
  dishName: string;
  icon: string;
  label: string;
  /** Actual minutes on the clock (extended for a delayed fixed step). */
  minutes: number;
  uses: Resource[];
  start: number;
  end: number;
  /** 1-based oven number, null when the step does not use an oven. */
  oven: number | null;
  ovenTempF: number | null;
  usedAlt: boolean;
}

export interface Violation {
  dishId: string;
  dishName: string;
  readyAt: number;
  waitMinutes: number;
  holdMinutes: number;
}

export interface ScheduleResult {
  /** False when a step could not be placed, or when one had to start before `now`. */
  feasible: boolean;
  serveAt: number;
  /** Sorted by (start, stepId). */
  steps: ScheduledStep[];
  /** dishId → minute its last step ends. */
  readyAt: Record<string, number>;
  /** dishId → serveAt − readyAt. */
  waits: Record<string, number>;
  violations: Violation[];
}
