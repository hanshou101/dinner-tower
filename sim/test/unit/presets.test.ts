import { describe, expect, it } from "vitest";
import { GOLDEN_MENU, isPresetAvailable, PRESETS } from "../../src/presets";

describe("direct-mode presets", () => {
  it("uses the dinner-tower tool names from SPEC §6.5", () => {
    expect(PRESETS.map((preset) => preset.tool)).toEqual([
      "plan_dinner",
      "whats_next",
      "report_delay",
      "get_kitchen",
    ]);
  });

  it("plans the golden menu at 19:00", () => {
    const plan = PRESETS.find((preset) => preset.id === "plan");
    expect(plan?.args).toEqual({ dishes: [...GOLDEN_MENU], serveAt: "19:00" });
    expect(plan?.args.dishes).toEqual([
      "turkey",
      "stuffing",
      "mashed_potatoes",
      "green_beans",
      "gravy",
      "rolls",
    ]);
  });

  it("reports a 20 minute turkey delay", () => {
    const delay = PRESETS.find((preset) => preset.id === "delay");
    expect(delay?.args).toEqual({ target: "turkey", minutes: 20 });
  });

  it("greys out a chip when the connected server lacks its tool", () => {
    const plan = PRESETS[0];
    expect(isPresetAvailable(plan, ["plan_dinner", "whats_next"])).toBe(true);
    expect(isPresetAvailable(plan, ["show_echo", "bump_counter"])).toBe(false);
  });
});
