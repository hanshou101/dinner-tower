import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Household store (SPEC §6.3 "持久化").
 *
 * One JSON file at `DT_DATA_FILE` (default `server/data/household.json`):
 * `{ version: 1, kitchen, activePlan }`. Writes go to a temp file next to the
 * target and are renamed into place, so a crash never leaves half a file.
 *
 * `activePlan` is the T4 plan tools' record; T2 only owns its shape and the
 * read/write accessors. Times inside the plan are minutes since midnight
 * (the scheduler's unit); the MCP layer formats them as "HH:MM" on the wire.
 */

export interface Kitchen {
  ovens: number;
  ovenRacks: number;
  burners: number;
  cooks: number;
  ovenSwitchMinutes: number;
}

export const DEFAULT_KITCHEN: Kitchen = {
  ovens: 1,
  ovenRacks: 2,
  burners: 4,
  cooks: 2,
  ovenSwitchMinutes: 10,
};

export const KITCHEN_LIMITS: Record<keyof Kitchen, { min: number; max: number }> = {
  ovens: { min: 1, max: 2 },
  ovenRacks: { min: 1, max: 3 },
  burners: { min: 1, max: 8 },
  cooks: { min: 1, max: 4 },
  ovenSwitchMinutes: { min: 0, max: 30 },
};

export type PlanOption = "primary" | "share-oven" | "keep-temps";

/** One placed step inside the active plan (minutes since midnight). */
export interface PlanStepRecord {
  stepId: string;
  start: number;
  end: number;
  minutes: number;
  /** 1-based oven number, or null when the step does not use an oven. */
  oven: number | null;
  ovenTempF: number | null;
  usedAlt: boolean;
}

/** The plan `plan_dinner` / `report_delay` persist and `whats_next` replays. */
export interface ActivePlan {
  dishIds: string[];
  serveAt: number;
  originalServeAt: number;
  option: PlanOption;
  altSteps: string[];
  steps: PlanStepRecord[];
  revision: number;
}

export interface Household {
  version: 1;
  kitchen: Kitchen;
  activePlan: ActivePlan | null;
}

export const DEFAULT_DATA_FILE = fileURLToPath(new URL("../data/household.json", import.meta.url));

function emptyHousehold(): Household {
  return { version: 1, kitchen: { ...DEFAULT_KITCHEN }, activePlan: null };
}

export type KitchenPatchResult =
  | { ok: true; patch: Partial<Kitchen> }
  | { ok: false; error: string };

/**
 * Validate a partial kitchen update against SPEC §6.2.1 ranges.
 * Ranges live here (not in the JSON Schema) so an out-of-range call comes back
 * as a tool result with `isError: true` instead of a protocol-level failure.
 */
export function validateKitchenPatch(input: Record<string, unknown>): KitchenPatchResult {
  const patch: Partial<Kitchen> = {};
  for (const key of Object.keys(KITCHEN_LIMITS) as Array<keyof Kitchen>) {
    const value = input[key];
    if (value === undefined) continue;
    const limits = KITCHEN_LIMITS[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, error: `${key} must be a whole number between ${limits.min} and ${limits.max}.` };
    }
    if (value < limits.min || value > limits.max) {
      return { ok: false, error: `${key} must be between ${limits.min} and ${limits.max} (got ${value}).` };
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Provide at least one kitchen field to update: " + Object.keys(KITCHEN_LIMITS).join(", ") + "." };
  }
  return { ok: true, patch };
}

export class Store {
  readonly file: string;

  constructor(file: string = DEFAULT_DATA_FILE) {
    this.file = file;
  }

  /** `DT_DATA_FILE`, or `server/data/household.json`. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Store {
    return new Store(env.DT_DATA_FILE?.trim() ? env.DT_DATA_FILE : DEFAULT_DATA_FILE);
  }

  read(): Household {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyHousehold();
      throw error;
    }
    const parsed = JSON.parse(raw) as Partial<Household>;
    return {
      version: 1,
      kitchen: { ...DEFAULT_KITCHEN, ...(parsed.kitchen ?? {}) },
      activePlan: parsed.activePlan ?? null,
    };
  }

  write(household: Household): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(household, null, 2)}\n`, "utf8");
    renameSync(temp, this.file);
  }

  getKitchen(): Kitchen {
    return this.read().kitchen;
  }

  updateKitchen(patch: Partial<Kitchen>): Kitchen {
    const household = this.read();
    household.kitchen = { ...household.kitchen, ...patch };
    this.write(household);
    return household.kitchen;
  }

  getActivePlan(): ActivePlan | null {
    return this.read().activePlan;
  }

  /** Persist (or clear, with null) the plan the plan tools own. */
  setActivePlan(plan: ActivePlan | null): void {
    const household = this.read();
    household.activePlan = plan;
    this.write(household);
  }
}
