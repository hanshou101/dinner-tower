/**
 * Demo clock (SPEC §6.3).
 *
 * - `DEMO_MODE=1`: the clock is frozen at `DEMO_CLOCK_START` (default 13:00) and
 *   `POST /demo/clock` can move it, so a three-minute video can walk through an
 *   afternoon. This is the mock SPEC §7 explicitly allows.
 * - otherwise: the real local time of the machine, as minutes of the day.
 *
 * All times are minutes since midnight (0–1439); the wire format is "HH:MM".
 */

export interface Clock {
  /** True when the clock is the controllable demo clock. */
  readonly demoClock: boolean;
  /** Current time as minutes since local midnight. */
  nowMinutes(): number;
  /** Current time as "HH:MM" (24-hour). */
  currentTime(): string;
  /** Move the demo clock. Throws when not in demo mode. */
  setTime(time: string): void;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** Parse "HH:MM" (24-hour) into minutes since midnight, or null when invalid. */
export function parseTimeOfDay(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Format minutes since midnight as "HH:MM" (24-hour). */
export function formatTimeOfDay(minutes: number): string {
  const normalized = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.DEMO_MODE ?? "").toLowerCase();
  return value === "1" || value === "true";
}

export function createClock(env: NodeJS.ProcessEnv = process.env): Clock {
  const demoClock = isDemoMode(env);
  const start = parseTimeOfDay(env.DEMO_CLOCK_START ?? "13:00");
  if (demoClock && start === null) {
    throw new Error(`DEMO_CLOCK_START must be "HH:MM", got ${JSON.stringify(env.DEMO_CLOCK_START)}`);
  }
  let frozen = start ?? 13 * 60;

  return {
    demoClock,
    nowMinutes() {
      if (demoClock) return frozen;
      const now = new Date();
      return now.getHours() * 60 + now.getMinutes();
    },
    currentTime() {
      return this.demoClock ? formatTimeOfDay(frozen) : formatTimeOfDay(this.nowMinutes());
    },
    setTime(time: string) {
      if (!demoClock) {
        throw new Error("the clock can only be set when DEMO_MODE=1");
      }
      const minutes = parseTimeOfDay(time);
      if (minutes === null) {
        throw new Error(`time must be "HH:MM" between 00:00 and 23:59, got ${JSON.stringify(time)}`);
      }
      frozen = minutes;
    },
  };
}
