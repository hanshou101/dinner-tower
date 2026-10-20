/**
 * Dinner Tower — departure board MCP App entry point.
 *
 * Adapted from modelcontextprotocol/ext-apps `examples/basic-server-vanillajs`
 * (`src/mcp-app.ts`, MIT, https://github.com/modelcontextprotocol/ext-apps):
 * `new App(...)`, handlers registered before `connect()`, `callServerTool` for
 * buttons. Changes: renders the PlanView, and every button re-renders from the
 * tool result instead of a single demo value.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { BoardView } from "./board-view.js";
import type { PlanView } from "./types.js";
import "./board.css";

function planFromResult(result: CallToolResult): PlanView | null {
  const structured = result.structuredContent as PlanView | undefined;
  if (!structured || !Array.isArray(structured.steps) || typeof structured.serveAt !== "string") {
    return null;
  }
  return structured;
}

function errorText(result: CallToolResult, fallback: string): string {
  const text = result.content?.find((item) => item.type === "text");
  return text && "text" in text && typeof text.text === "string" ? text.text : fallback;
}

const app = new App({ name: "Dinner Tower Board", version: "1.0.0" });

const view = new BoardView({
  onDelay: (stepId) => {
    void callPlanTool("report_delay", { target: stepId, minutes: 10 });
  },
  onPlanOption: (option) => {
    const plan = view.currentPlan;
    if (!plan) return;
    void callPlanTool("plan_dinner", {
      dishes: plan.dishes.map((dish) => dish.id),
      serveAt: plan.serveAt,
      option,
    });
  },
});

/**
 * The board talks to the server itself — no voice turn needed (SPEC §3, 1:50).
 * Whatever comes back is a fresh PlanView, so the board simply re-renders.
 */
async function callPlanTool(name: string, args: Record<string, unknown>): Promise<void> {
  view.setBusy(true);
  try {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) {
      view.showError(errorText(result, `${name} failed`));
      return;
    }
    const plan = planFromResult(result);
    if (plan) {
      view.update(plan);
    } else {
      view.showError(`${name} returned no plan for the board`);
    }
  } catch (error) {
    view.showError(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    view.setBusy(false);
  }
}

// Handlers must be registered before connect().
app.ontoolresult = (result) => {
  const plan = planFromResult(result);
  if (plan) {
    view.update(plan);
    return;
  }
  if (result.isError) {
    view.showError(errorText(result, "The plan could not be loaded"));
  }
};
app.onerror = (error) => {
  console.error("[dinner-tower-board]", error);
};

void app.connect().catch((error: unknown) => {
  view.showError(`Could not connect to the host: ${error instanceof Error ? error.message : String(error)}`);
});
