import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * AC-8 with the real stack: the T4 MCP server in DEMO_MODE and the T3/T6
 * simulator as the host. Nothing here is a fixture — the board is the built
 * `board/dist/board.html` served from `ui://dinner-tower/board.html`, and the
 * plan comes from the real scheduler.
 *
 * Run: npm --prefix board run test:real   (starts server + simulator itself)
 */
const PROOF = resolve(process.cwd(), "..", "proof");

test("AC-8: plan, 6:20 PM NOW row, +10 MIN, SERVE 7:10 PM", async ({ page }) => {
  // Demo mode is the product surface; the preset chips and the demo clock
  // live in the Developer panel, which `?dev=1` opens.
  await page.goto("/?dev=1");
  await expect(page.getByTestId("connection-badge")).toContainText("dinner-tower");

  // 1. Direct mode: plan the golden menu for 7:00 PM.
  await page.locator('[data-testid="preset"][data-preset="plan"]').click();
  await expect(page.getByTestId("elicitation-card")).toBeVisible();
  await expect(page.getByTestId("elicitation-message")).toContainText(
    "Your oven can only hold one temperature at a time",
  );
  await page.locator('[data-testid="elicitation-option"][data-value="share-oven"]').click();

  // 2. The board renders inside the simulator's MCP App iframe. The host uses
  // the double-iframe sandbox, so the App lives one level below the proxy.
  const board = page.frameLocator("#app-view iframe").frameLocator("iframe");
  await expect(board.locator("[data-testid=board]")).toBeVisible();
  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:00 PM",
  );
  await expect(board.locator('[data-testid="rows"] [data-testid="row"]')).toHaveCount(13);
  await expect(board.locator('[data-step-id="turkey.roast"] .col-station')).toHaveText(
    "OVEN 1 · 325°F",
  );
  await expect(board.locator('[data-testid="timeline-lane-oven-1"]')).toContainText("325°F");

  // 3. Move the demo clock to 18:20 — the simulator calls whats_next.
  await page.locator("#clock-input").fill("18:20");
  await page.locator("#clock-set").click();
  await expect(board.locator('[data-testid=now]')).toHaveText("6:20 PM");
  await expect(board.locator('[data-step-id="turkey.roast"] .badge')).toHaveText("NOW");
  await expect(board.locator('[data-step-id="turkey.roast"] .delay')).toBeVisible();
  await expect(board.locator('[data-testid="now-line"]')).toBeVisible();

  // 4. Tap +10 MIN on the NOW row: the board itself calls report_delay.
  await board.locator('[data-step-id="turkey.roast"] .delay').click();
  await expect(board.locator(".row.changed").first()).toBeVisible();
  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:10 PM",
  );

  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(PROOF, "T5-e2e-real.png"), animations: "disabled" });
});
