/**
 * Test-only host harness for the T5 board.
 *
 * A real MCP Apps host, cut down to what the board needs:
 *   - `@modelcontextprotocol/client` over Streamable HTTP to the fixture server,
 *   - the board HTML comes from the `ui://dinner-tower/board.html` resource,
 *   - `AppBridge` + `PostMessageTransport` in a sandboxed iframe, with the tool
 *     result pushed as `structuredContent` (PlanView),
 *   - every `tools/call` the App raises is logged into the page so Playwright
 *     can assert on the exact arguments.
 *
 * Adapted from the T3 simulator host (sim/src/app-host.ts, T3 = AME-853) and
 * modelcontextprotocol/ext-apps `examples/basic-host`.
 */
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import "./harness.css";

const UI_EXTENSION_ID = "io.modelcontextprotocol/ui";
const HOST_INFO = { name: "dinner-tower-board-harness", version: "1.0.0" };
const DEFAULT_UI_URI = "ui://dinner-tower/board.html";
const INIT_TIMEOUT_MS = 20_000;

const fixture = new URLSearchParams(window.location.search).get("fixture") ?? "plan-1300";
const screen = document.getElementById("screen") as HTMLElement;
const callLog = document.getElementById("call-log") as HTMLOListElement;
const statusEl = document.getElementById("status") as HTMLElement;

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.dataset.error = String(error);
}

function recordCall(name: string, args: Record<string, unknown>): void {
  const item = document.createElement("li");
  item.setAttribute("data-testid", "call-entry");
  item.dataset.tool = name;
  item.dataset.args = JSON.stringify(args);
  const toolName = document.createElement("span");
  toolName.className = "call-name";
  toolName.textContent = name;
  const argsEl = document.createElement("code");
  argsEl.className = "call-args";
  argsEl.textContent = JSON.stringify(args);
  item.append(toolName, argsEl);
  callLog.append(item);
}

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", window.location.href));
  const client = new Client(HOST_INFO, {
    capabilities: {
      extensions: { [UI_EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
    },
  });

  // AppBridge raises App tools/call through client.request(), not callTool(),
  // so wrapping request() is the only place the host sees them.
  const loose = client as unknown as {
    request: (request: { method: string; params?: Record<string, unknown> }, ...rest: unknown[]) => Promise<unknown>;
  };
  const originalRequest = loose.request.bind(client);
  loose.request = async (request, ...rest) => {
    if (request?.method === "tools/call") {
      const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
      recordCall(
        typeof params.name === "string" ? params.name : "tools/call",
        (params.arguments as Record<string, unknown>) ?? {},
      );
    }
    return originalRequest(request, ...rest);
  };

  await client.connect(transport);
  const server = client.getServerVersion();
  setStatus(`connected to ${server?.name ?? "?"} ${server?.version ?? ""}`);

  const result = await client.callTool({ name: "show_plan", arguments: { fixture } });
  const uiUri =
    (result as { _meta?: { ui?: { resourceUri?: string } } })._meta?.ui?.resourceUri ??
    DEFAULT_UI_URI;
  const resource = await client.readResource({ uri: uiUri });
  const content = resource.contents[0] as { mimeType?: string; text?: string } | undefined;
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE || typeof content.text !== "string") {
    throw new Error(`Resource ${uiUri} did not return ${RESOURCE_MIME_TYPE} HTML`);
  }

  const iframe = document.createElement("iframe");
  iframe.title = "Dinner Tower board";
  iframe.setAttribute("data-testid", "app-frame");
  // The App is a single self-contained file, so an opaque-origin sandbox is
  // enough: no scripts, styles or fonts may be loaded from anywhere else.
  iframe.setAttribute("sandbox", "allow-scripts");
  screen.append(iframe);

  const bridge = new AppBridge(
    client,
    HOST_INFO,
    { openLinks: {}, serverTools: {}, serverResources: {}, updateModelContext: { text: {} } },
    {
      hostContext: {
        theme: "dark",
        platform: "web",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        containerDimensions: { width: 880, height: 550 },
      },
    },
  );

  let markInitialized: () => void = () => undefined;
  const initialized = new Promise<void>((resolve) => {
    markInitialized = resolve;
  });
  bridge.oninitialized = () => markInitialized();
  bridge.onmessage = async () => ({});
  bridge.onopenlink = async () => ({});
  bridge.onloggingmessage = (params) => console.info("[board]", params.level, params.data);
  bridge.onsizechange = ({ height }) => {
    // The Echo screen is a fixed 880×550: the iframe always fills it. A host
    // that lets the App resize would either clip a taller board or leave a
    // black band under a shorter one.
    console.info("[board] requested height", height);
  };

  // Connect BEFORE the App document exists: the App posts `ui/initialize` as
  // soon as its script runs, and a lost initialize would never be retried.
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  iframe.srcdoc = content.text;

  await Promise.race([
    initialized,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("App did not send ui/initialized")), INIT_TIMEOUT_MS),
    ),
  ]);

  await bridge.sendToolInput({ arguments: { fixture } });
  await bridge.sendToolResult(result as CallToolResult);
  setStatus(`board ready · fixture ${fixture}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(`harness failed: ${message}`, true);
  console.error(error);
});
