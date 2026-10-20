/**
 * Time helpers. Every instant inside the engine is an integer "minute of day"
 * (0–1439); anything that leaves the engine is either "HH:MM" (24h, SPEC §6.2.1)
 * or a 12-hour clock label for spoken/UI copy (§6.2.3).
 */

export const MINUTES_PER_DAY = 1440;

const HH_MM = /^(\d{1,2}):(\d{2})$/;

/** "19:00" → 1140. Throws on anything that is not a valid 24-hour HH:MM. */
export function parseTime(value: string): number {
  const raw = String(value).trim();
  const match = HH_MM.exec(raw);
  if (!match) throw new Error(`Invalid time "${value}" — expected HH:MM (24-hour).`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${value}" — hours 0–23, minutes 0–59.`);
  return hours * 60 + minutes;
}

/** 1140 → "19:00" */
export function formatTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 1140 → "7:00 PM" (the only clock form users and the board see). */
export function formatTime12h(minutes: number): string {
  const wrapped = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** 220 → "3 h 40 min"; 45 → "45 min"; 60 → "1 h" (§6.2.3 copy). */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** 910, 930 → "15:10–15:30" (en dash, as the spec writes ranges). */
export function formatRange(start: number, end: number): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}
