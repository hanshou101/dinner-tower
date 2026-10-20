import { describe, expect, it } from "vitest";
import { formatDuration, formatRange, formatTime, formatTime12h, parseTime } from "../src/time";

describe("time", () => {
  it("parses 24-hour HH:MM into minutes since midnight", () => {
    expect(parseTime("19:00")).toBe(1140);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:55")).toBe(1435);
    expect(parseTime("07:05")).toBe(425);
  });

  it("rejects malformed or out-of-range times", () => {
    expect(() => parseTime("7 PM")).toThrow(/HH:MM/);
    expect(() => parseTime("24:00")).toThrow(/24:00/);
    expect(() => parseTime("19:60")).toThrow(/19:60/);
  });

  it("formats 24-hour HH:MM", () => {
    expect(formatTime(1140)).toBe("19:00");
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(1439)).toBe("23:59");
  });

  it("formats 12-hour clock times the way the prompts spell them", () => {
    expect(formatTime12h(1140)).toBe("7:00 PM");
    expect(formatTime12h(900)).toBe("3:00 PM");
    expect(formatTime12h(1310)).toBe("9:50 PM");
    expect(formatTime12h(720)).toBe("12:00 PM");
    expect(formatTime12h(0)).toBe("12:00 AM");
    expect(formatTime12h(1145)).toBe("7:05 PM");
  });

  it("formats durations like '3 h 40 min'", () => {
    expect(formatDuration(220)).toBe("3 h 40 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(0)).toBe("0 min");
  });

  it("formats a step range with an en dash", () => {
    expect(formatRange(910, 930)).toBe("15:10–15:30");
  });
});
