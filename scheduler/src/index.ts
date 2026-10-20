/**
 * Dinner Tower scheduling engine — public surface.
 *
 * Zero runtime dependencies, deterministic: the same input always returns the
 * same plan, byte for byte. The MCP server imports this module directly.
 */
export * from "./types.js";
export { formatDuration, formatRange, formatTime, formatTime12h, parseTime, MINUTES_PER_DAY } from "./time.js";
export { schedule } from "./schedule.js";
export { findEarliestServe, planOptions } from "./options.js";
export type { EarliestServe, EarliestServeInput, OptionContext, PlanConflict, PlanOption, PlanOptions } from "./options.js";
export { ReplanError, replan, resolveTarget } from "./replan.js";
export type { PlanChange, ReplanContext, ReplanResult } from "./replan.js";
export { validatePlan } from "./validate.js";
export type { ValidateInput, ValidationResult } from "./validate.js";
