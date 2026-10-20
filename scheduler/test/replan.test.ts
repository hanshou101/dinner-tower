import { describe, expect, it } from "vitest";
import { schedule } from "../src/schedule";
import { ReplanError, replan } from "../src/replan";
import { GOLDEN_MENU, SERVE_AT, at, dishes, kitchen, range, stepOf } from "./helpers";
import { TABLE_C, TABLE_D } from "./golden";

const ALT = new Set(["stuffing.bake", "rolls.bake"]);

const tableB = () =>
  schedule({ dishes, dishIds: GOLDEN_MENU, serveAt: SERVE_AT, kitchen, altSteps: ALT });

function run(overrides: Partial<Parameters<typeof replan>[0]> & { target: string; minutes: number; now: number }) {
  return replan({
    dishes,
    dishIds: GOLDEN_MENU,
    kitchen,
    plan: tableB(),
    serveAt: SERVE_AT,
    altSteps: [...ALT],
    ...overrides,
  });
}

function expectTable(plan: ReturnType<typeof schedule>, table: typeof TABLE_C) {
  for (const [stepId, row] of Object.entries(table)) {
    expect({ stepId, range: range(stepOf(plan, stepId)) }).toEqual({ stepId, range: row.range });
    if (row.tempF !== undefined) expect({ stepId, tempF: stepOf(plan, stepId).ovenTempF }).toEqual({ stepId, tempF: row.tempF });
  }
}

describe("§6.2.5 replan", () => {
  it("table C: 18:20, turkey +20 → serve 19:20, 9 changed steps", () => {
    const result = run({ target: "turkey", minutes: 20, now: at("18:20") });
    expect(result.serveAt).toBe(at("19:20"));
    expect(result.originalServeAt).toBe(at("19:00"));
    expect(result.targetStepId).toBe("turkey.roast");
    expect(result.schedule.feasible).toBe(true);
    expect(result.schedule.violations).toEqual([]);
    expectTable(result.schedule, TABLE_C);

    const changedIds = Object.entries(TABLE_C)
      .filter(([, row]) => row.changed)
      .map(([id]) => id)
      .sort();
    expect(result.changes.map((c) => c.stepId).sort()).toEqual(changedIds);
    expect(result.changes).toHaveLength(9);
    expect(result.changes.find((c) => c.stepId === "turkey.roast")).toEqual({
      stepId: "turkey.roast",
      label: "Roast the turkey",
      from: "15:30–18:30",
      to: "15:30–18:50",
    });
    expect(result.changes.find((c) => c.stepId === "turkey.rest")).toEqual({
      stepId: "turkey.rest",
      label: "Rest the turkey under foil",
      from: "18:30–19:00",
      to: "18:50–19:20",
    });
  });

  it("table C leaves steps that started before 18:20 untouched", () => {
    const result = run({ target: "turkey", minutes: 20, now: at("18:20") });
    for (const stepId of ["turkey.prep", "stuffing.prep", "stuffing.bake", "mashed_potatoes.peel"]) {
      expect({ stepId, range: range(stepOf(result.schedule, stepId)) }).toEqual({
        stepId,
        range: range(stepOf(tableB(), stepId)),
      });
    }
    const later = result.schedule.steps.filter((s) => s.start >= at("18:20"));
    expect(later.length).toBeGreaterThan(0);
  });

  it("table D: 18:40, turkey.rest +15 → serve 19:15", () => {
    const result = run({ target: "turkey.rest", minutes: 15, now: at("18:40") });
    expect(result.serveAt).toBe(at("19:15"));
    expect(result.originalServeAt).toBe(at("19:00"));
    expect(result.schedule.violations).toEqual([]);
    expectTable(result.schedule, TABLE_D);
    const changedIds = Object.entries(TABLE_D)
      .filter(([, row]) => row.changed)
      .map(([id]) => id)
      .sort();
    expect(result.changes.map((c) => c.stepId).sort()).toEqual(changedIds);
  });

  it("extra golden: green_beans.trim +5 at 18:20 keeps serve 19:00, only trim moves", () => {
    const result = run({ target: "green_beans.trim", minutes: 5, now: at("18:20") });
    expect(result.serveAt).toBe(at("19:00"));
    expect(result.changes).toEqual([
      { stepId: "green_beans.trim", label: "Trim the green beans", from: "18:27–18:37", to: "18:22–18:37" },
    ]);
  });

  it("extra golden (AC-8): turkey.roast +10 at 18:20 → serve 19:10, no violations", () => {
    const result = run({ target: "turkey.roast", minutes: 10, now: at("18:20") });
    expect(result.serveAt).toBe(at("19:10"));
    expect(result.schedule.feasible).toBe(true);
    expect(result.schedule.violations).toEqual([]);
  });

  it("extra golden (demo 1:50): table C at 18:20, potatoes peel +10 keeps serve 19:20", () => {
    const tableC = run({ target: "turkey", minutes: 20, now: at("18:20") });
    const result = replan({
      dishes,
      dishIds: GOLDEN_MENU,
      kitchen,
      plan: tableC.schedule,
      serveAt: tableC.serveAt,
      originalServeAt: tableC.originalServeAt,
      now: at("18:20"),
      target: "mashed_potatoes.peel",
      minutes: 10,
      altSteps: [...ALT],
    });
    expect(result.serveAt).toBe(at("19:20"));
    expect(result.changes).toEqual([
      {
        stepId: "mashed_potatoes.peel",
        label: "Peel & cube the potatoes",
        from: "18:15–18:30",
        to: "18:15–18:40",
      },
    ]);
  });

  it("resolves a dish id to its in-progress step", () => {
    const result = run({ target: "turkey", minutes: 20, now: at("16:00") });
    expect(result.targetStepId).toBe("turkey.roast");
    expect(result.serveAt).toBeGreaterThan(at("19:00"));
  });

  it("refuses a step that is already done", () => {
    expect(() => run({ target: "turkey.prep", minutes: 10, now: at("18:20") })).toThrow(ReplanError);
    expect(() => run({ target: "turkey.prep", minutes: 10, now: at("18:20") })).toThrow(
      "Season & truss the turkey is already done.",
    );
  });

  it("refuses a dish with nothing left to delay", () => {
    expect(() => run({ target: "stuffing", minutes: 10, now: at("19:30") })).toThrow(
      "Nothing left to delay for stuffing.",
    );
  });

  it("refuses an unknown target", () => {
    expect(() => run({ target: "lasagna", minutes: 10, now: at("18:20") })).toThrow(/Unknown target "lasagna"/);
  });
});
