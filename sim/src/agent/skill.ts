/**
 * Loading the Agent Skill (SPEC §6.6).
 *
 * The page cannot read the repository, so the sim server reads the skill file
 * once and hands the body (frontmatter stripped) to the browser through
 * `/api/config`. The system prompt is composed in the browser from that body,
 * the MCP server's `instructions`, and the fixed Alexa persona sentence.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_RELATIVE_PATH = join("skills", "dinner-tower", "SKILL.md");

/** Repository root, from `sim/src/agent/` (three levels up). */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Drop a leading YAML frontmatter block (`---` … `---`). Frontmatter is for
 * skill loaders, not for the model.
 */
export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^\uFEFF/, "");
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

/** Read `skills/dinner-tower/SKILL.md` and return its body; "" when absent. */
export function readSkillBody(root: string = repoRoot()): string {
  const file = join(root, SKILL_RELATIVE_PATH);
  if (!existsSync(file)) return "";
  return stripFrontmatter(readFileSync(file, "utf8"));
}
