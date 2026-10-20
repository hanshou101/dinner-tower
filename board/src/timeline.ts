/**
 * Timeline-strip maths for the bottom lane (SPEC §6.4): one lane per oven
 * (coloured by temperature), one for burners and one for hands, spanning the
 * earliest step start to the serve time. Pure functions, unit tested.
 */
import { minutesOf } from "./format.js";
import type { PlanView } from "./types.js";

export interface Interval {
  start: number;
  end: number;
}

export interface LaneSegment extends Interval {
  count: number;
}

export interface OvenTempLane {
  tempF: number;
  segments: Interval[];
}

export interface OvenLane {
  oven: number;
  temps: OvenTempLane[];
}

export interface TimelineModel {
  /** Minutes of day. */
  start: number;
  end: number;
  /** Null when the demo clock sits outside the board window (line is hidden). */
  now: number | null;
  serve: number;
  ovens: OvenLane[];
  burners: LaneSegment[];
  hands: LaneSegment[];
}

function normalise(intervals: Interval[]): Interval[] {
  return intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Sweep overlapping intervals into segments that carry how many run at once.
 * Adjacent segments with the same count are joined so the strip has no seams.
 */
export function mergeOccupancy(intervals: Interval[]): LaneSegment[] {
  const sorted = normalise(intervals);
  if (sorted.length === 0) return [];

  const deltas = new Map<number, number>();
  for (const interval of sorted) {
    deltas.set(interval.start, (deltas.get(interval.start) ?? 0) + 1);
    deltas.set(interval.end, (deltas.get(interval.end) ?? 0) - 1);
  }

  const out: LaneSegment[] = [];
  let count = 0;
  let previous: number | null = null;
  for (const [minute, delta] of [...deltas.entries()].sort((a, b) => a[0] - b[0])) {
    if (previous !== null && minute > previous && count > 0) {
      const last = out[out.length - 1];
      if (last && last.end === previous && last.count === count) {
        last.end = minute;
      } else {
        out.push({ start: previous, end: minute, count });
      }
    }
    count += delta;
    previous = minute;
  }
  return out;
}

/**
 * Union of intervals: two steps at the same oven temperature form one block on
 * the strip, however much they overlap (SPEC §6.4: 烤箱泳道按溫度著色).
 */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = normalise(intervals);
  const out: Interval[] = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      out.push({ ...interval });
    }
  }
  return out;
}

export function buildTimeline(plan: PlanView): TimelineModel {
  const serve = minutesOf(plan.serveAt);
  const starts = plan.steps.map((step) => minutesOf(step.start));
  const start = starts.length > 0 ? Math.min(...starts) : serve - 1;

  const ovens = new Map<number, Map<number, Interval[]>>();
  const burnerIntervals: Interval[] = [];
  const handIntervals: Interval[] = [];

  for (const step of plan.steps) {
    const interval = { start: minutesOf(step.start), end: minutesOf(step.end) };
    if (step.uses.includes("burner")) burnerIntervals.push(interval);
    if (step.uses.includes("hands")) handIntervals.push(interval);
    if (step.oven !== null && step.ovenTempF !== null) {
      const byTemp = ovens.get(step.oven) ?? new Map<number, Interval[]>();
      const list = byTemp.get(step.ovenTempF) ?? [];
      list.push(interval);
      byTemp.set(step.ovenTempF, list);
      ovens.set(step.oven, byTemp);
    }
  }

  const ovenLanes: OvenLane[] = [...ovens.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([oven, byTemp]) => ({
      oven,
      temps: [...byTemp.entries()]
        .map(([tempF, intervals]) => ({ tempF, segments: mergeIntervals(intervals) }))
        .sort((a, b) => (a.segments[0]?.start ?? 0) - (b.segments[0]?.start ?? 0)),
    }));

  const nowValue = minutesOf(plan.now);
  const now = nowValue >= start && nowValue <= serve ? nowValue : null;

  return {
    start,
    end: serve,
    now,
    serve,
    ovens: ovenLanes,
    burners: mergeOccupancy(burnerIntervals),
    hands: mergeOccupancy(handIntervals),
  };
}
