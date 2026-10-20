/**
 * The `PlanView` contract, copied from docs/01-SPEC.md §6.3 (field names and
 * types are frozen; the server in T4 produces it, this App consumes it).
 * The board never imports server code: the only thing shared between them is
 * this wire shape.
 */

export type StepStatus = "done" | "active" | "upcoming";

export interface Kitchen {
  ovens: number;
  ovenRacks: number;
  burners: number;
  cooks: number;
  ovenSwitchMinutes: number;
}

export interface PlanDish {
  id: string;
  name: string;
  icon: string;
  readyAt: string;
  waitMinutes: number;
  holdMinutes: number;
  ok: boolean;
}

export type PlanResource = "oven" | "burner" | "hands";

export interface PlanStep {
  stepId: string;
  dishId: string;
  dishName: string;
  icon: string;
  label: string;
  start: string;
  end: string;
  minutes: number;
  uses: PlanResource[];
  oven: number | null;
  ovenTempF: number | null;
  usedAlt: boolean;
  status: StepStatus;
}

export interface PlanConflict {
  message: string;
  options: { id: "share-oven" | "keep-temps"; label: string }[];
  waits: { dishId: string; readyAt: string; waitMinutes: number }[];
}

export interface PlanChange {
  stepId: string;
  label: string;
  from: string;
  to: string;
}

export interface PlanView {
  serveAt: string;
  originalServeAt: string;
  now: string;
  demoClock: boolean;
  option: "primary" | "share-oven" | "keep-temps";
  revision: number;
  kitchen: Kitchen;
  dishes: PlanDish[];
  steps: PlanStep[];
  next: string[];
  conflict: PlanConflict | null;
  changes: PlanChange[];
}
