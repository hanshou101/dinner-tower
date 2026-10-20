/**
 * SPEC §6.2.6 golden tables. Each row: stepId -> start–end (24h).
 * "變" rows of tables C and D are marked with `changed: true`.
 */
export interface GoldenRow {
  range: string;
  tempF?: number;
  usedAlt?: boolean;
  changed?: boolean;
}

export const TABLE_A: Record<string, GoldenRow> = {
  "turkey.prep": { range: "15:10–15:30" },
  "turkey.roast": { range: "15:30–18:30", tempF: 325 },
  "turkey.rest": { range: "18:30–19:00" },
  "stuffing.prep": { range: "14:20–14:35" },
  "stuffing.bake": { range: "14:35–15:20", tempF: 350 },
  "mashed_potatoes.peel": { range: "18:15–18:30" },
  "mashed_potatoes.boil": { range: "18:30–18:50" },
  "mashed_potatoes.mash": { range: "18:50–19:00" },
  "green_beans.trim": { range: "18:27–18:37" },
  "green_beans.blanch": { range: "18:37–18:42" },
  "green_beans.saute": { range: "18:42–18:50" },
  "gravy.make": { range: "18:45–19:00" },
  "rolls.bake": { range: "18:48–19:00", tempF: 400 },
};

export const TABLE_B: Record<string, GoldenRow> = {
  "turkey.prep": { range: "15:10–15:30" },
  "turkey.roast": { range: "15:30–18:30", tempF: 325 },
  "turkey.rest": { range: "18:30–19:00" },
  "stuffing.prep": { range: "17:50–18:05" },
  "stuffing.bake": { range: "18:05–19:00", tempF: 325, usedAlt: true },
  "mashed_potatoes.peel": { range: "18:15–18:30" },
  "mashed_potatoes.boil": { range: "18:30–18:50" },
  "mashed_potatoes.mash": { range: "18:50–19:00" },
  "green_beans.trim": { range: "18:27–18:37" },
  "green_beans.blanch": { range: "18:37–18:42" },
  "green_beans.saute": { range: "18:42–18:50" },
  "gravy.make": { range: "18:45–19:00" },
  "rolls.bake": { range: "18:42–19:00", tempF: 325, usedAlt: true },
};

export const TABLE_C: Record<string, GoldenRow> = {
  "turkey.prep": { range: "15:10–15:30" },
  "turkey.roast": { range: "15:30–18:50", tempF: 325, changed: true },
  "turkey.rest": { range: "18:50–19:20", changed: true },
  "stuffing.prep": { range: "17:50–18:05" },
  "stuffing.bake": { range: "18:05–19:00", tempF: 325, usedAlt: true },
  "mashed_potatoes.peel": { range: "18:15–18:30" },
  "mashed_potatoes.boil": { range: "18:50–19:10", changed: true },
  "mashed_potatoes.mash": { range: "19:10–19:20", changed: true },
  "green_beans.trim": { range: "18:47–18:57", changed: true },
  "green_beans.blanch": { range: "18:57–19:02", changed: true },
  "green_beans.saute": { range: "19:02–19:10", changed: true },
  "gravy.make": { range: "19:05–19:20", changed: true },
  "rolls.bake": { range: "19:02–19:20", tempF: 325, usedAlt: true, changed: true },
};

export const TABLE_D: Record<string, GoldenRow> = {
  "turkey.prep": { range: "15:10–15:30" },
  "turkey.roast": { range: "15:30–18:30", tempF: 325 },
  "turkey.rest": { range: "18:30–19:15", changed: true },
  "stuffing.prep": { range: "17:50–18:05" },
  "stuffing.bake": { range: "18:05–19:00", tempF: 325, usedAlt: true },
  "mashed_potatoes.peel": { range: "18:15–18:30" },
  "mashed_potatoes.boil": { range: "18:30–18:50" },
  "mashed_potatoes.mash": { range: "19:05–19:15", changed: true },
  "green_beans.trim": { range: "18:27–18:37" },
  "green_beans.blanch": { range: "18:37–18:42" },
  "green_beans.saute": { range: "18:57–19:05", changed: true },
  "gravy.make": { range: "19:00–19:15", changed: true },
  "rolls.bake": { range: "18:57–19:15", tempF: 325, usedAlt: true, changed: true },
};

export const SHARE_OVEN_ALT_STEPS = ["rolls.bake", "stuffing.bake"];
