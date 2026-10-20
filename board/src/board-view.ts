/**
 * Departure-board view (SPEC §6.4): header, five-column table, conflict banner
 * and the timeline strip. Rendering is plain DOM — no framework — so the App
 * stays one self-contained HTML file and runs in any MCP Apps host.
 */
import { formatMinutes, formatTime, statusBadge, stationText } from "./format.js";
import { setFlipText } from "./flip.js";
import { buildTimeline } from "./timeline.js";
import type { PlanStep, PlanView } from "./types.js";

export interface BoardHandlers {
  onDelay: (stepId: string) => void;
  onPlanOption: (option: "share-oven" | "keep-temps") => void;
}

const CHANGE_HIGHLIGHT_MS = 5000;
const ERROR_VISIBLE_MS = 6000;

interface RowRefs {
  root: HTMLDivElement;
  time: HTMLElement;
  icon: HTMLElement;
  dish: HTMLElement;
  step: HTMLElement;
  station: HTMLElement;
  badge: HTMLElement;
  delay: HTMLButtonElement;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Oven temperatures get a fixed palette so the strip reads as a heat scale:
// amber at 325°F (the Thanksgiving workhorse) drifting to crimson when hot.
const TEMP_COLORS: { tempF: number; color: string }[] = [
  { tempF: 300, color: "#f2b64a" },
  { tempF: 325, color: "#f0a13a" },
  { tempF: 350, color: "#ec8038" },
  { tempF: 375, color: "#e4623c" },
  { tempF: 400, color: "#d84d4f" },
  { tempF: 425, color: "#c33f6b" },
  { tempF: 450, color: "#a83a80" },
];

/** Nearest palette entry — deterministic, and amber stays amber at 325°F. */
export function tempColor(tempF: number): string {
  let best = TEMP_COLORS[0]!;
  for (const entry of TEMP_COLORS) {
    if (Math.abs(entry.tempF - tempF) < Math.abs(best.tempF - tempF)) best = entry;
  }
  return best.color;
}

export class BoardView {
  private plan: PlanView | null = null;
  private readonly rows = new Map<string, RowRefs>();
  private highlightTimer: number | undefined;
  private errorTimer: number | undefined;

  private readonly els = {
    root: document.getElementById("board") as HTMLElement,
    serve: document.getElementById("serve") as HTMLElement,
    serveBlock: document.getElementById("serve-block") as HTMLElement,
    now: document.getElementById("now") as HTMLElement,
    nowBlock: document.getElementById("now-block") as HTMLElement,
    demoBadge: document.getElementById("demo-badge") as HTMLElement,
    rows: document.getElementById("rows") as HTMLElement,
    empty: document.getElementById("empty") as HTMLElement,
    conflict: document.getElementById("conflict") as HTMLElement,
    conflictMessage: document.getElementById("conflict-message") as HTMLElement,
    conflictActions: document.getElementById("conflict-actions") as HTMLElement,
    timeline: document.getElementById("timeline") as HTMLElement,
    error: document.getElementById("board-error") as HTMLElement,
  };

  constructor(private readonly handlers: BoardHandlers) {}

  get currentPlan(): PlanView | null {
    return this.plan;
  }

  update(plan: PlanView): void {
    this.plan = plan;
    this.els.root.dataset.revision = String(plan.revision);
    this.els.root.dataset.option = plan.option;

    const serve = formatTime(plan.serveAt);
    setFlipText(this.els.serve, serve);
    this.els.serveBlock.setAttribute("aria-label", `SERVE ${serve}`);

    const now = formatTime(plan.now);
    this.els.now.textContent = now;
    this.els.nowBlock.setAttribute("aria-label", `NOW ${now}`);
    this.els.demoBadge.hidden = !plan.demoClock;

    this.renderRows(plan);
    this.renderConflict(plan);
    this.renderTimeline(plan);
    this.highlightChanges(plan);

    this.els.empty.hidden = plan.steps.length > 0;
  }

  showError(message: string): void {
    this.els.error.textContent = message;
    this.els.error.hidden = false;
    window.clearTimeout(this.errorTimer);
    this.errorTimer = window.setTimeout(() => {
      this.els.error.hidden = true;
    }, ERROR_VISIBLE_MS);
  }

  setBusy(busy: boolean): void {
    if (busy) {
      this.els.root.dataset.busy = "true";
    } else {
      delete this.els.root.dataset.busy;
    }
    for (const button of this.els.root.querySelectorAll("button")) {
      button.disabled = busy;
    }
  }

  private createRow(step: PlanStep): RowRefs {
    const root = make("div", "row");
    root.dataset.stepId = step.stepId;
    root.setAttribute("data-testid", "row");

    const time = make("span", "cell col-time");
    const dish = make("span", "cell col-dish");
    const icon = make("span", "dish-icon");
    const dishName = make("span", "dish-name");
    dish.append(icon, dishName);
    const stepLabel = make("span", "cell col-step");
    const station = make("span", "cell col-station");
    const status = make("span", "cell col-status");
    const badge = make("span", "badge");
    const delay = make("button", "delay");
    delay.type = "button";
    delay.textContent = "+10 MIN";
    delay.title = "Push this step back by 10 minutes";
    delay.setAttribute("data-testid", `delay-${step.stepId}`);
    delay.addEventListener("click", () => this.handlers.onDelay(step.stepId));
    status.append(badge, delay);

    root.append(time, dish, stepLabel, station, status);
    return { root, time, icon, dish: dishName, step: stepLabel, station, badge, delay };
  }

  private renderRows(plan: PlanView): void {
    const seen = new Set<string>();
    for (const step of plan.steps) {
      seen.add(step.stepId);
      let row = this.rows.get(step.stepId);
      if (!row) {
        row = this.createRow(step);
        this.rows.set(step.stepId, row);
      }
      this.updateRow(row, step, plan.next);
      // Re-appending keeps the DOM in plan order (steps are sorted by start).
      this.els.rows.append(row.root);
    }
    for (const [stepId, row] of this.rows) {
      if (!seen.has(stepId)) {
        row.root.remove();
        this.rows.delete(stepId);
      }
    }
  }

  private updateRow(row: RowRefs, step: PlanStep, next: string[]): void {
    const badge = statusBadge(step, next);
    row.root.dataset.status = step.status;
    row.root.dataset.badge = badge;

    setFlipText(row.time, formatTime(step.start));
    row.icon.textContent = step.icon;
    setFlipText(row.dish, step.dishName);
    setFlipText(row.step, step.label);
    setFlipText(row.station, stationText(step));
    setFlipText(row.badge, badge);
    row.badge.dataset.badge = badge;

    row.delay.hidden = step.status !== "active";
  }

  private renderConflict(plan: PlanView): void {
    const conflict = plan.conflict;
    if (!conflict) {
      this.els.conflict.hidden = true;
      return;
    }
    this.els.conflict.hidden = false;
    this.els.conflictMessage.textContent = conflict.message;
    this.els.conflictActions.replaceChildren();
    for (const option of conflict.options) {
      const button = make("button", "conflict-option", option.label);
      button.type = "button";
      button.dataset.option = option.id;
      button.setAttribute("data-testid", `conflict-option-${option.id}`);
      button.addEventListener("click", () => this.handlers.onPlanOption(option.id));
      this.els.conflictActions.append(button);
    }
  }

  private renderTimeline(plan: PlanView): void {
    const host = this.els.timeline;
    host.replaceChildren();
    if (plan.steps.length === 0) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const model = buildTimeline(plan);
    const span = Math.max(1, model.end - model.start);
    const pct = (minute: number): number => ((minute - model.start) / span) * 100;

    const axis = make("div", "tl-axis");
    axis.append(make("div", "tl-gutter"));
    const scale = make("div", "tl-scale");
    scale.append(
      make("span", "tl-tick", formatMinutes(model.start)),
      make("span", "tl-tick", formatMinutes(Math.round((model.start + model.end) / 2))),
      make("span", "tl-tick", formatMinutes(model.end)),
    );
    axis.append(scale);

    const body = make("div", "tl-body");
    const lanes: HTMLElement[] = [];

    for (const oven of model.ovens) {
      const blocks: HTMLElement[] = [];
      for (const temp of oven.temps) {
        for (const segment of temp.segments) {
          const block = make("div", "tl-block oven");
          block.dataset.temp = String(temp.tempF);
          block.style.left = `${pct(segment.start)}%`;
          block.style.width = `${Math.max(pct(segment.end) - pct(segment.start), 1)}%`;
          block.style.background = tempColor(temp.tempF);
          block.title = `OVEN ${oven.oven} · ${temp.tempF}°F`;
          block.append(make("span", "tl-block-label", `${temp.tempF}°F`));
          blocks.push(block);
        }
      }
      lanes.push(this.renderLane(`OVEN ${oven.oven}`, `oven-${oven.oven}`, blocks));
    }

    lanes.push(
      this.renderLane(
        "BURNERS",
        "burners",
        model.burners.map((segment) => {
          const block = make("div", "tl-block burner");
          block.style.left = `${pct(segment.start)}%`;
          block.style.width = `${Math.max(pct(segment.end) - pct(segment.start), 1)}%`;
          block.dataset.count = String(segment.count);
          block.style.background = `rgba(63, 214, 255, ${(0.2 + segment.count * 0.18).toFixed(2)})`;
          if (segment.count > 1) block.append(make("span", "tl-block-label", `×${segment.count}`));
          return block;
        }),
      ),
    );

    lanes.push(
      this.renderLane(
        "HANDS",
        "hands",
        model.hands.map((segment) => {
          const block = make("div", "tl-block hands");
          block.style.left = `${pct(segment.start)}%`;
          block.style.width = `${Math.max(pct(segment.end) - pct(segment.start), 1)}%`;
          block.dataset.count = String(segment.count);
          block.style.background = `rgba(150, 120, 255, ${(0.18 + segment.count * 0.2).toFixed(2)})`;
          if (segment.count > 1) block.append(make("span", "tl-block-label", `×${segment.count}`));
          return block;
        }),
      ),
    );

    body.append(...lanes);

    const lines = make("div", "tl-lines");
    if (model.now !== null) {
      const nowLine = make("div", "tl-line now");
      nowLine.setAttribute("data-testid", "now-line");
      nowLine.style.left = `${pct(model.now)}%`;
      lines.append(nowLine);
    }
    const serveLine = make("div", "tl-line serve");
    serveLine.setAttribute("data-testid", "serve-line");
    serveLine.style.left = "100%";
    lines.append(serveLine);
    body.append(lines);

    host.append(axis, body);
  }

  private renderLane(label: string, laneId: string, blocks: HTMLElement[]): HTMLElement {
    const lane = make("div", "tl-lane");
    lane.dataset.lane = laneId;
    lane.setAttribute("data-testid", `timeline-lane-${laneId}`);
    const track = make("div", "tl-track");
    track.append(...blocks);
    lane.append(make("span", "tl-label", label), track);
    return lane;
  }

  private highlightChanges(plan: PlanView): void {
    window.clearTimeout(this.highlightTimer);
    for (const row of this.rows.values()) row.root.classList.remove("changed");
    if (plan.changes.length === 0) return;
    for (const change of plan.changes) {
      this.rows.get(change.stepId)?.root.classList.add("changed");
    }
    this.highlightTimer = window.setTimeout(() => {
      for (const row of this.rows.values()) row.root.classList.remove("changed");
    }, CHANGE_HIGHLIGHT_MS);
  }
}
