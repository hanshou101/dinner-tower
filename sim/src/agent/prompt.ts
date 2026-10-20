/**
 * System prompt for agent mode (SPEC §6.5): the Agent Skill body, then the MCP
 * server's `instructions`, then the fixed Alexa persona sentence. Order is
 * fixed by the SPEC; the unit test pins it.
 */
export const ALEXA_PERSONA =
  "You are Alexa+ (simulated) on an Echo Show in the kitchen. Speak in at most two short sentences and use 12-hour times.";

/** Exactly the sentence the disabled agent input shows (SPEC §6.5). */
export const AGENT_DISABLED_MESSAGE =
  "Set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env to enable agent mode";

export interface SystemPromptParts {
  /** Body of `skills/dinner-tower/SKILL.md`, frontmatter already stripped. */
  skill: string;
  /** `instructions` from the MCP server's initialize result. */
  instructions?: string;
}

export function buildSystemPrompt({ skill, instructions }: SystemPromptParts): string {
  return [skill.trim(), (instructions ?? "").trim(), ALEXA_PERSONA]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
