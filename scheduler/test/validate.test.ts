import { describe, expect, it } from "vitest";
import { schedule } from "../src/schedule";
import { validatePlan } from "../src/validate";
import type { ScheduledStep } from "../src/types";
import { GOLDEN_MENU, SERVE_AT, at, dishes, kitchen, stepOf } from "./helpers";

const ALT = new Set(["stuffing.bake", "rolls.bake"]);
const planB = () => schedule({ dishes, dishIds: GOLDEN_MENU, serveAt: SERVE_AT, kitchen, altSteps: ALT });
const base = planB().steps;

function tamper(stepId: string, patch: Partial<ScheduledStep>): ScheduledStep[] {
  return base.map((step) => (step.stepId === stepId ? { ...step, ...patch } : step));
}

function validate(steps: ScheduledStep[]) {
  return validatePlan({ dishes, dishIds: GOLDEN_MENU, kitchen, serveAt: SERVE_AT, steps });
}

describe("validatePlan (AC-3 a–d, independent of the scheduler)", () => {
  it("accepts the golden share-oven plan", () => {
    const result = validate(base);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts a plan built by hand, step by step", () => {
    const result = validatePlan({
      dishes,
      dishIds: ["rolls"],
      kitchen,
      serveAt: at("19:00"),
      steps: [
        {
          stepId: "rolls.bake",
          dishId: "rolls",
          dishName: "Dinner Rolls",
          icon: "🥖",
          label: "Warm the dinner rolls",
          minutes: 12,
          uses: ["oven"],
          start: at("18:48"),
          end: at("19:00"),
          oven: 1,
          ovenTempF: 400,
          usedAlt: false,
        },
      ],
    });
    expect(result.errors).toEqual([]);
  });

  it("(b) rejects two recipes at different temperatures in the same oven at once", () => {
    const result = validate(tamper("stuffing.bake", { ovenTempF: 350 }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/temperature/i);
  });

  it("(a) rejects three cooks' worth of hands-on work at the same minute", () => {
    const result = validate(tamper("mashed_potatoes.peel", { start: at("18:45"), end: at("19:00") }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/hands/i);
  });

  it("(c) rejects a step that starts before the step it depends on ends", () => {
    const result = validate(tamper("green_beans.blanch", { start: at("18:30"), end: at("18:35") }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/green_beans\.blanch/);
  });

  it("(d) rejects a dish that is ready outside its hold window", () => {
    const steps = tamper("stuffing.bake", { start: at("16:15"), end: at("17:00") }).map((step) =>
      step.stepId === "stuffing.prep" ? { ...step, start: at("16:00"), end: at("16:15") } : step,
    );
    const result = validate(steps);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/hold|ready/i);
  });

  it("(a) rejects a third tray in a two-rack oven", () => {
    const extra: ScheduledStep = {
      ...stepOf(planB(), "rolls.bake"),
      stepId: "rolls.bake.extra",
      start: at("18:40"),
      end: at("18:52"),
    };
    const result = validate([...base, extra]);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/rack/i);
  });
});
