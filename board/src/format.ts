/**
 * Pure formatting helpers for the departure board (SPEC §6.4: "時間一律 12 小時制").
 * No DOM in this module so it can be unit tested under plain Node.
 */
import type { PlanStep } from "./types.js";

export type Badge = "DONE" | "NOW" | "NEXT" | "LATER";

/** "HH:MM" (24h, SPEC §6.3 wire format) → minutes of day. */
export function minutesOf(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":");
  const h = Number.parseInt(hours ?? "", 10);
  const m = Number.parseInt(minutes ?? "", 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Not a HH:MM time: ${String(hhmm)}`);
  }
  return h * 60 + m;
}

/** 1140 → "7:00 PM"; 5 → "12:05 AM". */
export function formatMinutes(totalMinutes: number): string {
  const normalised = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalised / 60);
  const minutes = normalised % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

/** "19:00" → "7:00 PM"; "00:05" → "12:05 AM". */
export function formatTime(hhmm: string): string {
  return formatMinutes(minutesOf(hhmm));
}

/**
 * STATUS column: the engine's own status wins for DONE/NOW; upcoming steps are
 * NEXT while they are in `PlanView.next` and LATER afterwards.
 */
export function statusBadge(step: PlanStep, next: string[]): Badge {
  if (step.status === "done") return "DONE";
  if (step.status === "active") return "NOW";
  return next.includes(step.stepId) ? "NEXT" : "LATER";
}

/**
 * STATION column: `OVEN 1 · 325°F`, `BURNER`, `PREP`, `BURNER + PREP`, `REST`.
 * "hands" is shown as PREP, matching SPEC §6.4.
 */
export function stationText(
  step: Pick<PlanStep, "uses" | "oven" | "ovenTempF">,
): string {
  if (step.uses.includes("oven")) {
    const oven = step.oven ?? 1;
    return step.ovenTempF === null ? `OVEN ${oven}` : `OVEN ${oven} · ${step.ovenTempF}°F`;
  }
  const burner = step.uses.includes("burner");
  const hands = step.uses.includes("hands");
  if (burner && hands) return "BURNER + PREP";
  if (burner) return "BURNER";
  if (hands) return "PREP";
  return "REST";
}
