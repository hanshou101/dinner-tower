import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatTime, minutesOf, statusBadge, stationText } from "../../src/format.js";
import { buildTimeline, mergeOccupancy } from "../../src/timeline.js";
import type { PlanView } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): PlanView {
  return JSON.parse(readFileSync(join(here, "..", "fixtures", `${name}.json`), "utf8")) as PlanView;
}

describe("formatTime (12-hour clock, SPEC §6.4)", () => {
  it("formats afternoon times", () => {
    expect(formatTime("19:00")).toBe("7:00 PM");
    expect(formatTime("18:20")).toBe("6:20 PM");
    expect(formatTime("15:10")).toBe("3:10 PM");
    expect(formatTime("13:05")).toBe("1:05 PM");
  });

  it("formats noon and midnight as 12", () => {
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("12:30")).toBe("12:30 PM");
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("00:05")).toBe("12:05 AM");
  });

  it("parses HH:MM to minutes of day", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("13:00")).toBe(780);
    expect(minutesOf("19:20")).toBe(1160);
  });
});

describe("statusBadge (DONE / NOW / NEXT / LATER)", () => {
  const base = fixture("plan-1820");
  const byId = (id: string) => base.steps.find((step) => step.stepId === id)!;

  it("marks finished steps DONE", () => {
    expect(statusBadge(byId("turkey.prep"), base.next)).toBe("DONE");
  });

  it("marks the running step NOW", () => {
    expect(statusBadge(byId("turkey.roast"), base.next)).toBe("NOW");
  });

  it("marks the first upcoming steps NEXT", () => {
    expect(statusBadge(byId("green_beans.trim"), base.next)).toBe("NEXT");
    expect(statusBadge(byId("mashed_potatoes.boil"), base.next)).toBe("NEXT");
    expect(statusBadge(byId("turkey.rest"), base.next)).toBe("NEXT");
  });

  it("marks later upcoming steps LATER", () => {
    expect(statusBadge(byId("gravy.make"), base.next)).toBe("LATER");
    expect(statusBadge(byId("mashed_potatoes.mash"), base.next)).toBe("LATER");
  });

  it("keeps NOW even when the step is also listed in next", () => {
    expect(statusBadge(byId("turkey.roast"), ["turkey.roast"])).toBe("NOW");
  });
});

describe("stationText (OVEN n · temp / BURNER / PREP / REST)", () => {
  const step = (uses: PlanView["steps"][number]["uses"], oven: number | null = null, temp: number | null = null) =>
    stationText({ uses, oven, ovenTempF: temp });

  it("shows the oven number and temperature", () => {
    expect(step(["oven"], 1, 325)).toBe("OVEN 1 · 325°F");
    expect(step(["oven"], 2, 400)).toBe("OVEN 2 · 400°F");
  });

  it("distinguishes burner, prep and both", () => {
    expect(step(["burner"])).toBe("BURNER");
    expect(step(["hands"])).toBe("PREP");
    expect(step(["burner", "hands"])).toBe("BURNER + PREP");
  });

  it("shows REST when the step holds no station", () => {
    expect(step([])).toBe("REST");
  });
});

describe("timeline lanes (SPEC §6.4 bottom strip)", () => {
  it("merges overlapping occupancy into counted segments", () => {
    expect(mergeOccupancy([])).toEqual([]);
    expect(mergeOccupancy([{ start: 600, end: 620 }])).toEqual([{ start: 600, end: 620, count: 1 }]);
    expect(
      mergeOccupancy([
        { start: 600, end: 620 },
        { start: 610, end: 630 },
      ]),
    ).toEqual([
      { start: 600, end: 610, count: 1 },
      { start: 610, end: 620, count: 2 },
      { start: 620, end: 630, count: 1 },
    ]);
  });

  it("joins adjacent intervals with the same count", () => {
    expect(
      mergeOccupancy([
        { start: 600, end: 620 },
        { start: 620, end: 640 },
      ]),
    ).toEqual([{ start: 600, end: 640, count: 1 }]);
  });

  it("spans the earliest start to serve time and runs one 325°F oven block for table B", () => {
    const model = buildTimeline(fixture("plan-1820"));
    expect(model.start).toBe(minutesOf("15:10"));
    expect(model.end).toBe(minutesOf("19:00"));
    expect(model.serve).toBe(minutesOf("19:00"));
    expect(model.now).toBe(minutesOf("18:20"));

    expect(model.ovens).toHaveLength(1);
    expect(model.ovens[0]!.oven).toBe(1);
    expect(model.ovens[0]!.temps).toEqual([
      {
        tempF: 325,
        segments: [{ start: minutesOf("15:30"), end: minutesOf("19:00") }],
      },
    ]);
  });

  it("counts burner occupancy in table B (18:30→19:00)", () => {
    const model = buildTimeline(fixture("plan-1820"));
    expect(model.burners).toEqual([
      { start: minutesOf("18:30"), end: minutesOf("18:37"), count: 1 },
      { start: minutesOf("18:37"), end: minutesOf("18:45"), count: 2 },
      { start: minutesOf("18:45"), end: minutesOf("18:50"), count: 3 },
      { start: minutesOf("18:50"), end: minutesOf("19:00"), count: 1 },
    ]);
  });

  it("counts hand occupancy and stays within the two cooks", () => {
    const model = buildTimeline(fixture("plan-1820"));
    expect(model.hands[0]).toEqual({ start: minutesOf("15:10"), end: minutesOf("15:30"), count: 1 });
    expect(model.hands).toContainEqual({ start: minutesOf("18:27"), end: minutesOf("18:30"), count: 2 });
    // Sauté and gravy overlap from 18:45, and mash joins them at 18:50, so the
    // two-cook stretch runs unbroken to serve time.
    expect(model.hands).toContainEqual({ start: minutesOf("18:45"), end: minutesOf("19:00"), count: 2 });
    expect(Math.max(...model.hands.map((segment) => segment.count))).toBeLessThanOrEqual(2);
  });

  it("hides the NOW line while the demo clock is before the board window", () => {
    const model = buildTimeline(fixture("plan-1300"));
    expect(model.now).toBeNull();
    expect(model.serve).toBe(minutesOf("19:00"));
  });

  it("splits the oven lane by temperature for the keep-temps plan (table A)", () => {
    const model = buildTimeline(fixture("conflict"));
    expect(model.ovens[0]!.temps).toEqual([
      { tempF: 350, segments: [{ start: minutesOf("14:35"), end: minutesOf("15:20") }] },
      { tempF: 325, segments: [{ start: minutesOf("15:30"), end: minutesOf("18:30") }] },
      { tempF: 400, segments: [{ start: minutesOf("18:48"), end: minutesOf("19:00") }] },
    ]);
  });
});
