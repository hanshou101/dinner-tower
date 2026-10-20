/**
 * §6.2.2 core scheduler: backwards greedy, deterministic.
 *
 * Everything below follows the spec literally — the sort key is (-prio, di, -si),
 * the placement scan walks down one minute at a time, and the first oven that fits
 * wins. Do not "optimise" it: the §6.2.6 golden tables were produced by exactly
 * this algorithm.
 */
import { MINUTES_PER_DAY } from "./time.js";
import type {
  Dish,
  Kitchen,
  Resource,
  ScheduleInput,
  ScheduleResult,
  ScheduledStep,
  Step,
  Violation,
} from "./types.js";

interface PlanStep {
  step: Step;
  id: string;
  label: string;
  dishId: string;
  dishName: string;
  icon: string;
  /** Dish index in this plan. */
  di: number;
  /** Step index inside its dish. */
  si: number;
  /** Effective minutes (alt / extra applied). */
  minutes: number;
  uses: Resource[];
  /** Effective temperature (alt applied); null when no oven. */
  tempF: number | null;
  usedAlt: boolean;
  after: string[];
  succ: string[];
  head: number;
  tail: number;
  prio: number;
}

interface Fit {
  start: number;
  oven: number | null;
}

function compareSteps(a: PlanStep, b: PlanStep): number {
  if (a.prio !== b.prio) return b.prio - a.prio; // sort key -prio, ascending
  if (a.di !== b.di) return a.di - b.di;
  return b.si - a.si; // sort key -si, ascending
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const kitchen: Kitchen = input.kitchen;
  const altSteps = new Set(input.altSteps ?? []);
  const fixed = input.fixed ?? new Map();
  const extra = input.extra ?? new Map<string, number>();
  const now = input.now ?? null;
  const serveAt = input.serveAt;

  const catalog = new Map(input.dishes.map((dish) => [dish.id, dish]));
  const seen = new Set<string>();
  const menu: Dish[] = [];
  for (const id of input.dishIds) {
    if (seen.has(id)) continue;
    const dish = catalog.get(id);
    if (!dish) continue;
    seen.add(id);
    menu.push(dish);
  }

  // 1. Expand steps: dish order, step order; alt/extra folded into minutes and temperature.
  const plan: PlanStep[] = [];
  const byId = new Map<string, PlanStep>();
  menu.forEach((dish, di) => {
    dish.steps.forEach((step, si) => {
      if (byId.has(step.id)) throw new Error(`Duplicate step id "${step.id}".`);
      const useAlt = altSteps.has(step.id) && step.alt !== undefined;
      const minutes = (useAlt ? step.alt!.minutes : step.minutes) + (extra.get(step.id) ?? 0);
      const tempF = useAlt ? step.alt!.ovenTempF : (step.ovenTempF ?? null);
      if (step.uses.includes("oven") && tempF === null) {
        throw new Error(`Step "${step.id}" uses the oven but declares no ovenTempF.`);
      }
      const ps: PlanStep = {
        step,
        id: step.id,
        label: step.label,
        dishId: dish.id,
        dishName: dish.name,
        icon: dish.icon,
        di,
        si,
        minutes,
        uses: [...step.uses],
        tempF,
        usedAlt: useAlt,
        after: [],
        succ: [],
        head: 0,
        tail: 0,
        prio: 0,
      };
      plan.push(ps);
      byId.set(ps.id, ps);
    });
  });

  // 2. Dependencies (only steps that exist in this plan), head/tail/prio.
  for (const ps of plan) ps.after = (ps.step.after ?? []).filter((id) => byId.has(id));
  for (const ps of plan) for (const dep of ps.after) byId.get(dep)!.succ.push(ps.id);

  const headMemo = new Map<string, number>();
  const headOf = (id: string): number => {
    const cached = headMemo.get(id);
    if (cached !== undefined) return cached;
    const ps = byId.get(id)!;
    headMemo.set(id, 0); // guards against a dependency cycle
    let head = 0;
    for (const dep of ps.after) {
      const predecessor = byId.get(dep)!;
      head = Math.max(head, headOf(dep) + predecessor.minutes);
    }
    headMemo.set(id, head);
    return head;
  };
  const tailMemo = new Map<string, number>();
  const tailOf = (id: string): number => {
    const cached = tailMemo.get(id);
    if (cached !== undefined) return cached;
    const ps = byId.get(id)!;
    tailMemo.set(id, ps.minutes);
    let tail = ps.minutes;
    for (const succ of ps.succ) tail = Math.max(tail, ps.minutes + tailOf(succ));
    tailMemo.set(id, tail);
    return tail;
  };
  for (const ps of plan) {
    ps.head = headOf(ps.id);
    ps.tail = tailOf(ps.id);
    ps.prio = ps.head + ps.tail;
  }

  // 3. Occupancy tables, one slot per minute.
  const hands = new Array<number>(MINUTES_PER_DAY).fill(0);
  const burners = new Array<number>(MINUTES_PER_DAY).fill(0);
  const ovenTemp: number[][] = Array.from({ length: Math.max(0, kitchen.ovens) }, () =>
    new Array<number>(MINUTES_PER_DAY).fill(0),
  );
  const ovenCount: number[][] = Array.from({ length: Math.max(0, kitchen.ovens) }, () =>
    new Array<number>(MINUTES_PER_DAY).fill(0),
  );

  const placed = new Set<string>();
  const startOf = new Map<string, number>();
  const endOf = new Map<string, number>();
  const placedSteps: ScheduledStep[] = [];
  let feasible = true;

  const addOccupancy = (ps: PlanStep, start: number, end: number, oven: number | null, tempF: number | null) => {
    const from = Math.max(0, start);
    const to = Math.min(MINUTES_PER_DAY, end);
    for (let m = from; m < to; m++) {
      if (ps.uses.includes("hands")) hands[m]! += 1;
      if (ps.uses.includes("burner")) burners[m]! += 1;
    }
    if (oven !== null && tempF !== null) {
      for (let m = from; m < to; m++) {
        ovenTemp[oven]![m] = tempF;
        ovenCount[oven]![m]! += 1;
      }
    }
  };

  const record = (ps: PlanStep, start: number, end: number, oven: number | null, tempF: number | null) => {
    placedSteps.push({
      stepId: ps.id,
      dishId: ps.dishId,
      dishName: ps.dishName,
      icon: ps.icon,
      label: ps.label,
      minutes: end - start,
      uses: [...ps.uses],
      start,
      end,
      oven: oven === null ? null : oven + 1,
      ovenTempF: tempF,
      usedAlt: ps.usedAlt,
    });
    placed.add(ps.id);
    startOf.set(ps.id, start);
    endOf.set(ps.id, end);
  };

  const fits = (ps: PlanStep, start: number): Fit | null => {
    const end = start + ps.minutes;
    if (start < 0 || end > MINUTES_PER_DAY) return null;
    if (ps.uses.includes("hands")) {
      for (let m = start; m < end; m++) if (hands[m]! >= kitchen.cooks) return null;
    }
    if (ps.uses.includes("burner")) {
      for (let m = start; m < end; m++) if (burners[m]! >= kitchen.burners) return null;
    }
    if (ps.uses.includes("oven")) {
      const tempF = ps.tempF!;
      const gap = kitchen.ovenSwitchMinutes;
      for (let oven = 0; oven < kitchen.ovens; oven++) {
        let ok = true;
        for (let m = start; m < end && ok; m++) {
          const t = ovenTemp[oven]![m]!;
          if ((t !== 0 && t !== tempF) || ovenCount[oven]![m]! >= kitchen.ovenRacks) ok = false;
        }
        // The oven must already be at this temperature (or off) for `gap` minutes on both sides.
        for (let m = Math.max(0, start - gap); m < start && ok; m++) {
          const t = ovenTemp[oven]![m]!;
          if (t !== 0 && t !== tempF) ok = false;
        }
        for (let m = end; m < Math.min(MINUTES_PER_DAY, end + gap) && ok; m++) {
          const t = ovenTemp[oven]![m]!;
          if (t !== 0 && t !== tempF) ok = false;
        }
        if (ok) return { start, oven };
      }
      return null;
    }
    return { start, oven: null };
  };

  // Fixed steps keep their slots before anything else is placed.
  for (const [id, slot] of fixed) {
    const ps = byId.get(id);
    if (!ps) continue;
    const oven = slot.oven === null ? null : slot.oven - 1;
    addOccupancy(ps, slot.start, slot.end, oven, slot.ovenTempF);
    record(ps, slot.start, slot.end, oven, slot.ovenTempF);
    if (slot.start < 0 || slot.end > MINUTES_PER_DAY || slot.start >= slot.end) feasible = false;
  }

  // 4. Backwards greedy.
  const remaining = plan.filter((ps) => !placed.has(ps.id));
  while (remaining.length > 0) {
    const ready = remaining.filter((ps) => ps.succ.every((id) => placed.has(id)));
    if (ready.length === 0) {
      feasible = false; // dependency cycle or an unplaceable successor
      break;
    }
    ready.sort(compareSteps);
    const ps = ready[0]!;

    let latestEnd = serveAt;
    let hasSuccessor = false;
    for (const id of ps.succ) {
      const successorStart = startOf.get(id);
      if (successorStart === undefined) continue;
      if (!hasSuccessor || successorStart < latestEnd) latestEnd = successorStart;
      hasSuccessor = true;
    }

    let lowerBound = now ?? 0;
    for (const dep of ps.after) {
      if (!fixed.has(dep)) continue;
      lowerBound = Math.max(lowerBound, endOf.get(dep) ?? 0);
    }

    let fit: Fit | null = null;
    for (let start = latestEnd - ps.minutes; start >= 0; start--) {
      fit = fits(ps, start);
      if (fit) break;
    }
    if (!fit) {
      feasible = false; // does not fit anywhere before midnight
      break;
    }

    addOccupancy(ps, fit.start, fit.start + ps.minutes, fit.oven, ps.tempF);
    record(ps, fit.start, fit.start + ps.minutes, fit.oven, ps.tempF);
    if (fit.start < lowerBound) feasible = false;
    remaining.splice(remaining.indexOf(ps), 1);
  }

  // 5. Ready times, waits, violations.
  const readyAt: Record<string, number> = {};
  const waits: Record<string, number> = {};
  const violations: Violation[] = [];
  for (const dish of menu) {
    const last = dish.steps[dish.steps.length - 1];
    if (!last) continue;
    const end = endOf.get(last.id);
    if (end === undefined) continue;
    readyAt[dish.id] = end;
    const wait = serveAt - end;
    waits[dish.id] = wait;
    if (wait < 0 || wait > dish.holdMinutes) {
      violations.push({
        dishId: dish.id,
        dishName: dish.name,
        readyAt: end,
        waitMinutes: wait,
        holdMinutes: dish.holdMinutes,
      });
    }
  }

  placedSteps.sort((a, b) => a.start - b.start || (a.stepId < b.stepId ? -1 : a.stepId > b.stepId ? 1 : 0));

  return { feasible, serveAt, steps: placedSteps, readyAt, waits, violations };
}
