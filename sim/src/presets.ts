/**
 * Direct-mode quick actions (no LLM).
 *
 * The tool names and arguments are the dinner-tower contract from
 * docs/01-SPEC.md §6.5. A chip is disabled when the connected server does not
 * expose its tool, so the simulator can also be pointed at other MCP servers.
 */

export const GOLDEN_MENU = [
  "turkey",
  "stuffing",
  "mashed_potatoes",
  "green_beans",
  "gravy",
  "rolls",
] as const;

export interface Preset {
  id: string;
  label: string;
  tool: string;
  args: Record<string, unknown>;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "plan",
    label: "Plan Thanksgiving for 7 PM",
    tool: "plan_dinner",
    args: { dishes: [...GOLDEN_MENU], serveAt: "19:00" },
  },
  {
    id: "next",
    label: "What's next?",
    tool: "whats_next",
    args: {},
  },
  {
    id: "delay",
    label: "Turkey +20 min",
    tool: "report_delay",
    args: { target: "turkey", minutes: 20 },
  },
  {
    id: "kitchen",
    label: "Show kitchen",
    tool: "get_kitchen",
    args: {},
  },
];

/** True when every tool the preset needs is exposed by the connected server. */
export function isPresetAvailable(
  preset: Preset,
  toolNames: readonly string[],
): boolean {
  return toolNames.includes(preset.tool);
}
