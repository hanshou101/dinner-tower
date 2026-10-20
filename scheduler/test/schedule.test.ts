import { describe, expect, it } from "vitest";
import { schedule } from "../src/schedule";
import { validatePlan } from "../src/validate";
import { GOLDEN_MENU, GOLDEN_STEP_IDS, SERVE_AT, dishes, kitchen, range, stepOf, at } from "./helpers";
import { TABLE_A, TABLE_B, type GoldenRow } from "./golden";

function expectTable(plan: ReturnType<typeof schedule>, table: Record<string, GoldenRow>) {
  expect(plan.steps.map((s) => s.stepId).sort()).toEqual([...GOLDEN_STEP_IDS].sort());
  for (const stepId of GOLDEN_STEP_IDS) {
    const step = stepOf(plan, stepId);
    const row = table[stepId]!;
    expect({ stepId, range: range(step) }).toEqual({ stepId, range: row.range });
    if (row.tempF !== undefined) {
      expect({ stepId, ovenTempF: step.ovenTempF }).toEqual({ stepId, ovenTempF: row.tempF });
      expect(step.oven).toBe(1);
    }
    if (row.usedAlt !== undefined) expect({ stepId, usedAlt: step.usedAlt }).toEqual({ stepId, usedAlt: row.usedAlt });
  }
}

const primary = () =>
  schedule({ dishes, dishIds: GOLDEN_MENU, serveAt: SERVE_AT, kitchen, altSteps: new Set<string>() });

const shareOven = () =>
  schedule({
    dishes,
    dishIds: GOLDEN_MENU,
    serveAt: SERVE_AT,
    kitchen,
    altSteps: new Set(["stuffing.bake", "rolls.bake"]),
  });

describe("§6.2.6 table A — primary (recipe temperatures)", () => {
  const plan = primary();

  it("is feasible and places all 13 steps exactly as table A", () => {
    expect(plan.feasible).toBe(true);
    expectTable(plan, TABLE_A);
  });

  it("sorts steps by (start, stepId)", () => {
    const keys = plan.steps.map((s) => [s.start, s.stepId] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    expect(keys).toEqual(sorted);
  });

  it("has exactly one violation: stuffing ready at 15:20 and waiting 220 minutes", () => {
    expect(plan.violations).toEqual([
      { dishId: "stuffing", dishName: "Sourdough Stuffing", readyAt: at("15:20"), waitMinutes: 220, holdMinutes: 20 },
    ]);
    expect(plan.readyAt["stuffing"]).toBe(at("15:20"));
    expect(plan.waits["stuffing"]).toBe(220);
  });

  it("records ready times and waits for every dish", () => {
    expect(plan.readyAt).toEqual({
      turkey: at("19:00"),
      stuffing: at("15:20"),
      mashed_potatoes: at("19:00"),
      green_beans: at("18:50"),
      gravy: at("19:00"),
      rolls: at("19:00"),
    });
    expect(plan.waits["green_beans"]).toBe(10);
  });
});

describe("§6.2.6 table B — share the oven (altSteps = {stuffing.bake, rolls.bake})", () => {
  const plan = shareOven();

  it("is feasible and places all 13 steps exactly as table B", () => {
    expect(plan.feasible).toBe(true);
    expectTable(plan, TABLE_B);
  });

  it("has no violations", () => {
    expect(plan.violations).toEqual([]);
  });

  it("passes the independent validator (AC-3 a–d)", () => {
    const result = validatePlan({ dishes, dishIds: GOLDEN_MENU, kitchen, serveAt: SERVE_AT, steps: plan.steps });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("is deterministic: two runs serialise byte-for-byte identically", () => {
    expect(JSON.stringify(shareOven())).toBe(JSON.stringify(shareOven()));
    expect(JSON.stringify(primary())).toBe(JSON.stringify(primary()));
  });
});
