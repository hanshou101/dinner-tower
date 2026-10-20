/**
 * The recording overlay and the full-screen cards used by the demo video.
 *
 * Everything the video shows is rendered by Chromium: the simulator page for
 * the live scenes, and these self-contained HTML cards for the title,
 * architecture and closing shots. Subtitles and the simulated-pointer live in a
 * fixed overlay so they land in the recording itself — the mux step never has
 * to draw text, which keeps the pipeline free of font and libass surprises.
 */

/** Class used on the subtitle bar so the spec check can look for it. */
export const SUBTITLE_ID = "demo-sub";

/**
 * Installed as an init script (every navigation) and re-run after
 * `page.setContent()` (which replaces the document without navigating).
 * Runs in the top document only — never inside the board's sandbox iframes.
 */
export const INIT_SCRIPT = String.raw`
(() => {
  if (window.top !== window) return;
  if (window.__demo && window.__demo.version === 1) { window.__demo.ensure(); return; }

  const STYLE = ` + "`" + `
    #demo-sub {
      position: fixed; left: 0; right: 0; bottom: 26px; margin: 0 auto;
      width: max-content; max-width: 1060px; padding: 9px 20px 10px; border-radius: 12px;
      background: rgba(4, 10, 18, 0.86); color: #f7f3e8;
      font: 500 21px/1.34 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
      text-align: center; letter-spacing: 0.1px; z-index: 2147483647;
      opacity: 0; transition: opacity 140ms ease; pointer-events: none;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    }
    #demo-sub[data-visible="true"] { opacity: 1; }
    #demo-sub .who {
      color: #7fd1ff; font-weight: 700; font-size: 15px; letter-spacing: 0.12em;
      text-transform: uppercase; margin-right: 10px; vertical-align: 2px;
    }
    #demo-sub .who.user { color: #ffd28a; }
    #demo-cursor {
      position: fixed; left: 0; top: 0; width: 24px; height: 24px; border-radius: 50%;
      border: 2px solid #ffffff; background: rgba(240, 161, 58, 0.55);
      box-shadow: 0 0 0 5px rgba(0, 0, 0, 0.28), 0 8px 20px rgba(0, 0, 0, 0.45);
      transform: translate(-50%, -50%); z-index: 2147483646; opacity: 0;
      transition: left 420ms cubic-bezier(.22,.61,.36,1), top 420ms cubic-bezier(.22,.61,.36,1), opacity 120ms linear;
      pointer-events: none;
    }
    #demo-cursor[data-visible="true"] { opacity: 1; }
    #demo-cursor::after {
      content: ""; position: absolute; inset: -10px; border-radius: 50%;
      border: 3px solid rgba(240, 161, 58, 0.9); opacity: 0;
    }
    #demo-cursor[data-pulse="true"]::after { animation: demo-pulse 520ms ease-out; }
    @keyframes demo-pulse {
      0% { transform: scale(0.45); opacity: 0.95; }
      100% { transform: scale(1.5); opacity: 0; }
    }
    #demo-sample-strip {
      position: fixed; left: 0; right: 0; bottom: 0; height: 24px; z-index: 2147483647;
      background: #b3261e; color: #fff8f2;
      font: 700 13px/24px -apple-system, "Helvetica Neue", Arial, sans-serif;
      letter-spacing: 0.16em; text-transform: uppercase; text-align: center;
    }
  ` + "`" + `;

  function ensure() {
    if (!document.getElementById("demo-style")) {
      const style = document.createElement("style");
      style.id = "demo-style";
      style.textContent = STYLE;
      document.head ? document.head.append(style) : document.documentElement.append(style);
    }
    for (const id of ["demo-sub", "demo-cursor"]) {
      if (!document.getElementById(id)) {
        const node = document.createElement("div");
        node.id = id;
        node.setAttribute("aria-hidden", "true");
        document.body ? document.body.append(node) : document.documentElement.append(node);
      }
    }
    if (!document.getElementById("demo-sample-strip") && window.__demo && window.__demo.badgeText) {
      const strip = document.createElement("div");
      strip.id = "demo-sample-strip";
      strip.textContent = window.__demo.badgeText;
      (document.body ? document.body : document.documentElement).append(strip);
    }
  }

  window.__demo = {
    version: 1,
    badgeText: (window.__demo && window.__demo.badgeText) || "",
    ensure,
    sub(role, text) {
      ensure();
      const node = document.getElementById("demo-sub");
      if (!node) return;
      node.replaceChildren();
      if (role === "user" || role === "alexa") {
        const who = document.createElement("span");
        who.className = "who " + role;
        who.textContent = role === "user" ? "You" : "Alexa";
        node.append(who);
      }
      node.append(document.createTextNode(text));
      node.dataset.visible = "true";
    },
    clearSub() {
      ensure();
      const node = document.getElementById("demo-sub");
      if (node) { node.dataset.visible = "false"; node.replaceChildren(); }
    },
    badge(text) {
      this.badgeText = text;
      ensure();
      const node = document.getElementById("demo-sample-strip");
      if (!node) return;
      if (text) node.textContent = text;
      else node.remove();
    },
    cursor(x, y) {
      ensure();
      const node = document.getElementById("demo-cursor");
      if (!node) return;
      // First appearance: jump to the target. Only later moves animate, so the
      // pointer never flies across the frame from the top-left corner.
      const first = node.dataset.visible !== "true";
      if (first) node.style.transition = "none";
      node.style.left = x + "px";
      node.style.top = y + "px";
      if (first) {
        void node.offsetWidth;
        node.style.transition = "";
      }
      node.dataset.visible = "true";
    },
    async pulse() {
      ensure();
      const node = document.getElementById("demo-cursor");
      if (!node) return;
      node.dataset.pulse = "false";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      node.dataset.pulse = "true";
      await new Promise((r) => setTimeout(r, 520));
      node.dataset.pulse = "false";
    },
    hideCursor() {
      ensure();
      const node = document.getElementById("demo-cursor");
      if (node) node.dataset.visible = "false";
    },
  };
  ensure();
})();
`;

const BASE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    width: 1280px; height: 720px; overflow: hidden;
    background:
      radial-gradient(1100px 620px at 18% 8%, rgba(64, 116, 178, 0.28), transparent 62%),
      radial-gradient(900px 520px at 88% 96%, rgba(240, 161, 58, 0.16), transparent 60%),
      linear-gradient(150deg, #060b13 0%, #091320 52%, #0b1726 100%);
    color: #f6f1e6;
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card { position: absolute; inset: 0; padding: 58px 76px 196px; display: flex; flex-direction: column; }
  .kicker { font-size: 15px; letter-spacing: 0.22em; text-transform: uppercase; color: #8fa6bd; }
  .rule { width: 96px; height: 4px; border-radius: 2px; background: #f0a13a; margin: 22px 0 26px; }
  .title { font-size: 92px; line-height: 0.98; letter-spacing: 0.11em; font-weight: 800; margin: 0; }
  .tagline { font-size: 31px; line-height: 1.32; color: #d7dee6; margin: 26px 0 0; max-width: 1010px; font-weight: 500; }
  .chips { display: flex; gap: 12px; flex-wrap: wrap; margin-top: auto; }
  .chip {
    font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: #e9eef4;
    border: 1px solid rgba(190, 210, 230, 0.34); border-radius: 999px; padding: 8px 15px;
    background: rgba(12, 22, 34, 0.55);
  }
  .chip.amber { border-color: rgba(240, 161, 58, 0.6); color: #ffcf8a; }
  .muted { color: #9fb0c3; }
`;

export function titleCard(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}
    .hero { display: flex; flex-direction: column; justify-content: center; flex: 1; }
  </style></head><body>
    <div class="card">
      <div class="kicker">Amazon Developer Hackathon · Alexa+ track</div>
      <div class="hero">
        <div class="rule"></div>
        <h1 class="title">DINNER TOWER</h1>
        <p class="tagline">Air-traffic control for your Thanksgiving kitchen — an Alexa+ MCP server that lands every dish hot at the same minute.</p>
      </div>
      <div class="chips">
        <span class="chip amber">DEMO CLOCK</span>
        <span class="chip">Simulated Alexa+ experience</span>
        <span class="chip">MCP 2025-11-25 · Streamable HTTP</span>
      </div>
    </div>
  </body></html>`;
}

function box(title: string, lines: string[], className = ""): string {
  return `<div class="box ${className}">
    <div class="box-title">${title}</div>
    ${lines.map((line) => `<div class="box-line">${line}</div>`).join("")}
  </div>`;
}

export function architectureCard(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}
    .arch { flex: 1; display: grid; grid-template-columns: 1fr 220px 1fr; gap: 18px; align-items: center; margin-top: 6px; }
    .box { border: 1px solid rgba(150, 180, 210, 0.32); border-radius: 14px; padding: 18px 20px; background: rgba(10, 20, 32, 0.62); }
    .box.hot { border-color: rgba(240, 161, 58, 0.62); background: rgba(38, 28, 14, 0.55); }
    .box-title { font-size: 22px; font-weight: 700; letter-spacing: 0.02em; margin-bottom: 8px; }
    .box-line { font-size: 16px; line-height: 1.45; color: #a9bacb; }
    .stack { display: grid; gap: 12px; }
    .arrow { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #8fa6bd; text-align: center; }
    .arrow .line { width: 100%; height: 2px; background: linear-gradient(90deg, rgba(127, 209, 255, 0.15), rgba(127, 209, 255, 0.85), rgba(127, 209, 255, 0.15)); position: relative; }
    .arrow .line::after { content: ""; position: absolute; right: -2px; top: -5px; border-left: 10px solid rgba(127, 209, 255, 0.9); border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
    .arrow .label { font-size: 13px; line-height: 1.35; letter-spacing: 0.04em; text-transform: uppercase; }
    .arrow .back { font-size: 12px; color: #ffcf8a; text-transform: uppercase; letter-spacing: 0.06em; }
  </style></head><body>
    <div class="card">
      <div class="kicker">Under the hood</div>
      <div class="rule"></div>
      <div class="arch">
        <div class="stack">
          ${box("Echo-style simulator", ["A real MCP client and MCP Apps host", "Text in, Alexa-style voice out"])}
          ${box("Departure board (MCP App)", ["One HTML file in a sandboxed iframe", "Its buttons call the server directly"])}
        </div>
        <div class="arrow">
          <div class="label">MCP 2025-11-25<br>Streamable HTTP<br>stateful session</div>
          <div class="line"></div>
          <div class="back">elicitation · ui:// resource</div>
        </div>
        <div class="stack">
          ${box("Dinner Tower MCP server", ["6 tools, 1 prompt, 1 ui:// resource", "Protocol negotiated at initialize"], "hot")}
          ${box("Grounded in a real scheduler", ["Backwards plan around one oven,", "four burners and two cooks", "Household state survives restarts"])}
        </div>
      </div>
      <div class="chips">
        <span class="chip amber">DEMO CLOCK</span>
        <span class="chip">Simulated Alexa+ experience</span>
        <span class="chip">Elicitation</span>
        <span class="chip">MCP Apps</span>
        <span class="chip">Agent Skills</span>
      </div>
    </div>
  </body></html>`;
}

export function endCard(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}
    .hero { display: flex; flex-direction: column; justify-content: center; flex: 1; }
    .repo { font-size: 22px; color: #7fd1ff; letter-spacing: 0.02em; margin-top: 30px; }
    .last { font-size: 40px; font-weight: 700; color: #ffcf8a; margin-top: 46px; letter-spacing: 0.01em; }
  </style></head><body>
    <div class="card">
      <div class="kicker">Amazon Developer Hackathon · Alexa+ track</div>
      <div class="hero">
        <div class="rule"></div>
        <h1 class="title">DINNER TOWER</h1>
        <p class="tagline">Every dish lands at the same minute — planned backwards from serve time around the oven, the burners and the people you have.</p>
        <div class="repo">github.com/hanshou101/dinner-tower</div>
        <div class="last">Every dish lands on time.</div>
      </div>
      <div class="chips">
        <span class="chip amber">DEMO CLOCK</span>
        <span class="chip">Simulated Alexa+ experience</span>
      </div>
    </div>
  </body></html>`;
}
