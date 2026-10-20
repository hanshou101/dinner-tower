import { resolve } from "node:path";
import { expect, test, type FrameLocator, type Page } from "@playwright/test";

/**
 * AC-8 in a real MCP Apps host: the board is served as a `ui://` resource, the
 * host pushes the fixture through AppBridge, and every button must reach the
 * server as a real `tools/call`.
 */
const PROOF = resolve(process.cwd(), "..", "proof");
const GOLDEN_DISHES = ["turkey", "stuffing", "mashed_potatoes", "green_beans", "gravy", "rolls"];

async function openBoard(page: Page, fixture: string): Promise<FrameLocator> {
  await page.goto(`/?fixture=${fixture}`);
  const board = page.frameLocator("[data-testid=app-frame]");
  await expect(board.locator("[data-testid=board]")).toBeVisible();
  return board;
}

async function callEntry(page: Page, tool: string) {
  const entry = page.locator(`[data-testid="call-entry"][data-tool="${tool}"]`).first();
  await expect(entry).toBeVisible();
  return entry;
}

async function entryArgs(entry: ReturnType<Page["locator"]>): Promise<Record<string, unknown>> {
  const raw = await entry.getAttribute("data-args");
  return JSON.parse(raw ?? "{}") as Record<string, unknown>;
}

test("renders the share-oven plan for a 7:00 PM serve", async ({ page }) => {
  const board = await openBoard(page, "plan-1300");

  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:00 PM",
  );
  await expect(board.locator("[data-testid=serve]")).toHaveText("7:00 PM");
  await expect(board.locator("[data-testid=now]")).toHaveText("1:00 PM");
  await expect(board.locator("[data-testid=demo-clock-badge]")).toBeVisible();

  const rows = board.locator('[data-testid="rows"] [data-testid="row"]');
  await expect(rows).toHaveCount(13);

  const turkey = board.locator('[data-step-id="turkey.roast"]');
  await expect(turkey.locator(".col-time")).toHaveText("3:30 PM");
  await expect(turkey.locator(".dish-icon")).toHaveText("🦃");
  await expect(turkey.locator(".dish-name")).toHaveText("Roast Turkey");
  await expect(turkey.locator(".col-step")).toHaveText("Roast the turkey");
  await expect(turkey.locator(".col-station")).toHaveText("OVEN 1 · 325°F");
  // Only the first three upcoming steps are NEXT at 1:00 PM; the roast is later.
  await expect(turkey.locator(".badge")).toHaveText("LATER");

  // Five columns on every row, and the station vocabulary from SPEC §6.4.
  await expect(board.locator('[data-step-id="turkey.rest"] .col-station')).toHaveText("REST");
  await expect(board.locator('[data-step-id="mashed_potatoes.boil"] .col-station')).toHaveText("BURNER");
  await expect(board.locator('[data-step-id="mashed_potatoes.peel"] .col-station')).toHaveText("PREP");
  await expect(board.locator('[data-step-id="green_beans.saute"] .col-station')).toHaveText(
    "BURNER + PREP",
  );
  await expect(board.locator('[data-step-id="turkey.prep"] .badge')).toHaveText("NEXT");
  await expect(board.locator('[data-step-id="gravy.make"] .badge')).toHaveText("LATER");
  await expect(board.locator(".delay:visible")).toHaveCount(0);

  // One 325°F oven block for the whole bake, and no NOW line before the window.
  await expect(board.locator('[data-testid="timeline-lane-oven-1"]')).toContainText("325°F");
  await expect(board.locator('[data-testid="timeline-lane-burners"]')).toBeVisible();
  await expect(board.locator('[data-testid="timeline-lane-hands"]')).toBeVisible();
  await expect(board.locator('[data-testid="now-line"]')).toHaveCount(0);

  const overflow = await board
    .locator("[data-testid=board]")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBe(0);

  await page.waitForTimeout(600);
  await page.locator("[data-testid=screen]").screenshot({ path: resolve(PROOF, "T5-board-1300.png"), animations: "disabled" });
});

test("shows NOW on the running step with a +10 MIN button at 6:20 PM", async ({ page }) => {
  const board = await openBoard(page, "plan-1820");

  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:00 PM",
  );
  await expect(board.locator("[data-testid=now]")).toHaveText("6:20 PM");

  const nowRows = board.locator('[data-status="active"]');
  await expect(nowRows).toHaveCount(3);
  for (const stepId of ["turkey.roast", "stuffing.bake", "mashed_potatoes.peel"]) {
    await expect(board.locator(`[data-step-id="${stepId}"] .badge`)).toHaveText("NOW");
  }
  await expect(board.locator('[data-step-id="turkey.roast"] .delay')).toHaveText("+10 MIN");
  await expect(board.locator('[data-step-id="turkey.roast"] .delay')).toBeVisible();
  await expect(board.locator('[data-step-id="green_beans.trim"] .delay')).toBeHidden();
  await expect(board.locator('[data-step-id="turkey.prep"] .badge')).toHaveText("DONE");

  await expect(board.locator('[data-testid="timeline-lane-oven-1"]')).toContainText("325°F");
  await expect(board.locator('[data-testid="now-line"]')).toBeVisible();

  await page.waitForTimeout(600);
  await page.locator("[data-testid=screen]").screenshot({ path: resolve(PROOF, "T5-board-1820.png"), animations: "disabled" });
});

test("+10 MIN calls report_delay on the server and repaints the changed rows", async ({ page }) => {
  const board = await openBoard(page, "plan-1820");

  await board.locator('[data-step-id="turkey.roast"] .delay').click();

  // 1) the host recorded the exact tools/call the App raised
  const entry = await callEntry(page, "report_delay");
  expect(await entryArgs(entry)).toEqual({ target: "turkey.roast", minutes: 10 });

  // 2) ...and it really reached the server
  const calls = (await (await page.request.get("/__calls")).json()) as {
    name: string;
    arguments: Record<string, unknown>;
  }[];
  expect(calls).toContainEqual({
    name: "report_delay",
    arguments: { target: "turkey.roast", minutes: 10 },
  });

  // 3) the board repainted from the server's PlanView (table C)
  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:20 PM",
  );
  await expect(board.locator('[data-step-id="turkey.roast"] .col-time')).toHaveText("3:30 PM");
  await expect(board.locator('[data-step-id="gravy.make"] .col-time')).toHaveText("7:05 PM");
  await expect(board.locator(".row.changed")).toHaveCount(9);
  await expect(board.locator('[data-step-id="turkey.roast"]')).toHaveClass(/changed/);

  await page.waitForTimeout(900);
  await page.locator("[data-testid=screen]").screenshot({ path: resolve(PROOF, "T5-board-changed.png"), animations: "disabled" });

  // The highlight is a five-second flash, not a permanent state.
  await expect(board.locator(".row.changed")).toHaveCount(0, { timeout: 12_000 });
});

test("conflict banner offers both oven options and calls plan_dinner", async ({ page }) => {
  const board = await openBoard(page, "conflict");

  await expect(board.locator("[data-testid=conflict-banner]")).toBeVisible();
  await expect(board.locator("[data-testid=conflict-message]")).toHaveText(
    "Your oven can only hold one temperature at a time, so Sourdough Stuffing would finish early and wait too long. How should I plan it?",
  );
  await expect(board.locator("[data-testid=conflict-option-share-oven]")).toHaveText(
    "Share the oven: bake Sourdough Stuffing at 325°F alongside the rest — everything lands at 7:00 PM.",
  );
  await expect(board.locator("[data-testid=conflict-option-keep-temps]")).toHaveText(
    "Keep recipe temperatures: Sourdough Stuffing is ready at 3:20 PM and waits 3 h 40 min.",
  );
  await expect(board.locator('[data-step-id="stuffing.bake"] .col-station')).toHaveText(
    "OVEN 1 · 350°F",
  );
  // The banner must not push the timeline off the 550px screen.
  const timelineFits = await board
    .locator("#timeline")
    .evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight + 1);
  expect(timelineFits).toBe(true);

  await page.waitForTimeout(600);
  await page.locator("[data-testid=screen]").screenshot({ path: resolve(PROOF, "T5-board-conflict.png"), animations: "disabled" });

  await board.locator("[data-testid=conflict-option-share-oven]").click();

  const entry = await callEntry(page, "plan_dinner");
  expect(await entryArgs(entry)).toEqual({
    dishes: GOLDEN_DISHES,
    serveAt: "19:00",
    option: "share-oven",
  });

  await expect(board.locator("[data-testid=conflict-banner]")).toBeHidden();
  await expect(board.locator("[data-testid=serve-block]")).toHaveAttribute(
    "aria-label",
    "SERVE 7:00 PM",
  );
  await expect(board.locator('[data-step-id="stuffing.bake"] .col-station')).toHaveText(
    "OVEN 1 · 325°F",
  );
});

test.describe("prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("turns the split-flap animation off", async ({ page }) => {
    const board = await openBoard(page, "plan-1820");
    await expect(board.locator(".flip-char")).toHaveCount(0);

    await board.locator('[data-step-id="turkey.roast"] .delay').click();
    await expect(board.locator("[data-testid=serve]")).toHaveText("7:20 PM");
    await expect(board.locator(".row.changed")).toHaveCount(9);
    await expect(board.locator(".flip-char")).toHaveCount(0);
  });
});
