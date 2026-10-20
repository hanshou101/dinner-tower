import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/server";
import type { PlanConflict } from "../../../scheduler/src/index.js";

/**
 * Form elicitation for the oven question (SPEC §6.3).
 *
 * The capability gate is its own function so it can be unit-tested against the
 * four shapes a client can actually advertise — `undefined`, `{}`,
 * `{form:{}}` and `{url:{}}` — without a socket in the way.
 */

/** The `elicitation` capability object a client may advertise. */
export type ElicitationCapabilityLike = { form?: unknown; url?: unknown } | null | undefined;

/**
 * True when the client can answer a **form** elicitation.
 *
 * - `undefined` (no `elicitation` capability at all) → no
 * - `{}` → yes: the pre-`mode` rule, an empty capability means form support
 * - `{form:{}}` → yes
 * - `{url:{}}` → no: URL-mode elicitation can never carry the two buttons we need
 *
 * Note the wire schema normalises `{}` to `{form:{}}` before it reaches us, but
 * the raw shape is what this function documents and what the unit test pins.
 */
export function supportsFormElicitation(elicitation: ElicitationCapabilityLike): boolean {
  if (!elicitation) return false;
  if (elicitation.form) return true;
  return Object.keys(elicitation).length === 0;
}

export interface OvenQuestion {
  message: string;
  requestedSchema: ElicitRequestFormParams["requestedSchema"];
}

/**
 * The `elicitation/create` payload: SPEC §6.3's message, and a single `choice`
 * field whose options are the conflict options the engine produced (their
 * labels are the §6.2.3 copy). 2025-11-25 titled enums are spelled `oneOf` of
 * `{const, title}` — the SDK accepts this shape (see docs/friction/T4.md).
 */
export function buildOvenQuestion(conflict: PlanConflict): OvenQuestion {
  const choices = conflict.options.map((option) => ({ const: option.id, title: option.label }));
  return {
    message: conflict.message,
    requestedSchema: {
      type: "object",
      properties: {
        choice: {
          type: "string",
          title: "Oven plan",
          oneOf: choices,
          default: "share-oven",
        },
      },
      required: ["choice"],
    } as ElicitRequestFormParams["requestedSchema"],
  };
}

/**
 * `accept` + `choice` decides; anything else — `decline`, `cancel`, an unknown
 * or missing choice — means "keep the recipe temperatures" (SPEC §6.3).
 */
export function choiceFromElicitResult(result: ElicitResult): "share-oven" | "keep-temps" {
  if (result.action !== "accept") return "keep-temps";
  const content = result.content as { choice?: unknown } | undefined;
  return content?.choice === "share-oven" ? "share-oven" : "keep-temps";
}
