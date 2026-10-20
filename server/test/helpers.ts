import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/** Absolute path of the `server` package root (this file lives in server/test/). */
export const SERVER_ROOT = fileURLToPath(new URL("..", import.meta.url));

export interface StartOptions {
  /** Value for DT_DATA_FILE — every test uses its own temp file. */
  dataFile: string;
  /** Start with DEMO_MODE=1. */
  demo?: boolean;
  /** Value for DEMO_CLOCK_START when demo is on (default 13:00). */
  demoClockStart?: string;
  /** Fixed port; a free ephemeral port is picked when omitted. */
  port?: number;
}

export interface RunningServer {
  port: number;
  baseUrl: string;
  mcpUrl: string;
  /** Everything the child wrote to stdout/stderr so far (for failure messages). */
  output: () => string;
  stop: () => Promise<void>;
}

/** Ask the OS for a free port, then release it. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Spawn a real `server` process (`tsx src/index.ts`) and wait until `GET /health` answers.
 * Tests talk to it over HTTP exactly like any other MCP client would.
 */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const port = opts.port ?? (await freePort());
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        DT_DATA_FILE: opts.dataFile,
        DEMO_MODE: opts.demo ? "1" : "0",
        ...(opts.demo ? { DEMO_CLOCK_START: opts.demoClockStart ?? "13:00" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let log = "";
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString("utf8");
  });

  let exited = false;
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // not listening yet
    }
    await delay(200);
  }

  const stop = async () => {
    if (exited) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 5_000);
    await exitPromise;
    clearTimeout(timer);
  };

  if (!healthy) {
    await stop();
    throw new Error(`server did not become healthy on ${baseUrl}\n--- server output ---\n${log}`);
  }

  return { port, baseUrl, mcpUrl: `${baseUrl}/mcp`, output: () => log, stop };
}
