import { describe, expect, it } from "vitest";
import { findEarliestServe, planOptions } from "../src/options";
import { GOLDEN_MENU, SERVE_AT, at, dishes, kitchen, range, stepOf } from "./helpers";
import { TABLE_A, TABLE_B, SHARE_OVEN_ALT_STEPS } from "./golden";

const ctx = { dishes, dishIds: GOLDEN_MENU, serveAt: SERVE_AT, kitchen, now: 13 * 60 };

describe("§6.2.3 conflict options", () => {
  const result = planOptions(ctx);

  it("primary is table A and keeps recipe temperatures", () => {
    for (const [stepId, row] of Object.entries(TABLE_A)) {
      expect({ stepId, range: range(stepOf(result.primary, stepId)) }).toEqual({ stepId, range: row.range });
    }
    expect(result.primary.violations).toHaveLength(1);
    expect(result.primary.violations[0]!.dishId).toBe("stuffing");
    expect(result.conflict).not.toBeNull();
    expect(result.conflict!.waits).toEqual([
      { dishId: "stuffing", dishName: "Sourdough Stuffing", readyAt: at("15:20"), waitMinutes: 220, holdMinutes: 20 },
    ]);
  });

  it("iterates to altSteps = {stuffing.bake, rolls.bake}", () => {
    expect([...result.altSteps].sort()).toEqual(SHARE_OVEN_ALT_STEPS);
    expect(result.shareOven).not.toBeNull();
    expect(result.shareOven!.violations).toEqual([]);
  });

  it("share-oven plan is table B", () => {
    const plan = result.shareOven!;
    for (const [stepId, row] of Object.entries(TABLE_B)) {
      expect({ stepId, range: range(stepOf(plan, stepId)) }).toEqual({ stepId, range: row.range });
    }
  });

  it("offers exactly share-oven and keep-temps, in that order", () => {
    expect(result.conflict!.options.map((o) => o.id)).toEqual(["share-oven", "keep-temps"]);
  });

  it("uses the §6.2.3 English copy, 12-hour times, hours/minutes durations", () => {
    expect(result.conflict!.message).toBe(
      "Your oven can only hold one temperature at a time, so Sourdough Stuffing would finish early and wait too long. How should I plan it?",
    );
    expect(result.conflict!.options[0]!.label).toBe(
      "Share the oven: bake Sourdough Stuffing and Dinner Rolls at 325°F alongside the rest — everything lands at 7:00 PM.",
    );
    expect(result.conflict!.options[1]!.label).toBe(
      "Keep recipe temperatures: Sourdough Stuffing is ready at 3:20 PM and waits 3 h 40 min.",
    );
  });
});

describe("§6.2.3 no conflict", () => {
  it("returns conflict: null when the primary plan has no violations", () => {
    const clean = planOptions({ dishes, dishIds: ["rolls"], serveAt: SERVE_AT, kitchen, now: 13 * 60 });
    expect(clean.primary.violations).toEqual([]);
    expect(clean.conflict).toBeNull();
    expect(clean.shareOven).toBeNull();
    expect(clean.altSteps).toEqual([]);
  });
});

describe("§6.2.4 earliest serve time (AC-7)", () => {
  it("finds 21:50 with every alt step on, 22:40 without alt, and reports the earlier of the two", () => {
    const earliest = findEarliestServe({ dishes, dishIds: GOLDEN_MENU, kitchen, from: SERVE_AT, now: at("18:00") });
    expect(earliest).toEqual({ ok: true, serveAt: at("21:50"), noAlt: at("22:40"), allAlt: at("21:50") });
  });

  it("gives up when even the all-alt plan cannot land before midnight", () => {
    const earliest = findEarliestServe({ dishes, dishIds: GOLDEN_MENU, kitchen, from: SERVE_AT, now: at("23:50") });
    expect(earliest).toEqual({ ok: false, serveAt: null, noAlt: null, allAlt: null });
  });
});
