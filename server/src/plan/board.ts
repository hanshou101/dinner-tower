import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

/**
 * The `ui://` board resource (SPEC §6.3 "資源").
 *
 * The HTML is the single-file MCP App that T5 builds into `board/dist/`. This
 * module only serves it: if the file does not exist the resource answers with an
 * MCP error naming the build command — never placeholder HTML, because a fake
 * board would render in every host and prove nothing.
 */

export const BOARD_URI = "ui://dinner-tower/board.html";

/** The copy SPEC §6.3 pins for a missing build. */
export const BOARD_NOT_BUILT = "Board UI not built. Run: npm --prefix board run build";

/** Repo root, three levels up from `server/src/plan/`. */
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_BOARD_HTML = fileURLToPath(new URL("../../../board/dist/board.html", import.meta.url));

/**
 * `DT_BOARD_HTML` (absolute, or relative to the repo root), else
 * `board/dist/board.html`. Tests point this at `server/test/fixtures/board.html`.
 */
export function boardHtmlPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DT_BOARD_HTML?.trim();
  if (!configured) return DEFAULT_BOARD_HTML;
  return isAbsolute(configured) ? configured : resolve(REPO_ROOT, configured);
}

/** Read the board HTML, or throw the SPEC error. */
export function readBoardHtml(env: NodeJS.ProcessEnv = process.env): string {
  const file = boardHtmlPath(env);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`${BOARD_NOT_BUILT} (looked for ${file})`);
  }
}

export function registerBoardResource(server: Pick<McpServer, "registerResource">): void {
  registerAppResource(
    server,
    "Dinner Tower Board",
    BOARD_URI,
    {
      title: "Dinner Tower departure board",
      description:
        "The departure board: every step of the active plan with its time, station and status, the oven lanes and the next three steps. Rendered by the MCP Apps host from the structuredContent of plan_dinner, whats_next and report_delay.",
    },
    async () => ({
      contents: [
        {
          uri: BOARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readBoardHtml(),
        },
      ],
    }),
  );
}
