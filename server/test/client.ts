import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export interface TestClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  sessionId: string | undefined;
  close: () => Promise<void>;
}

/** Connect a real MCP client over Streamable HTTP, exactly like a host application would. */
export async function connectClient(mcpUrl: string, name = "dinner-tower-test"): Promise<TestClient> {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  return {
    client,
    transport,
    sessionId: transport.sessionId,
    close: async () => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    },
  };
}
