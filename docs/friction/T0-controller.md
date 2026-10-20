# T0：主控在闸 A 亲手遇到的坑（2026-10-20）

### Alexa+ developer tools are unavailable to hackathon participants
- Tool / API / SDK: Alexa+ Add-on developer tools (Category SDK, MCP Toolkit, CLI, Web Simulator)
- Task attempted: Find an official way to test a self-hosted MCP server inside an Alexa+ experience.
- Steps taken: Read the hackathon Resources page and the add-on setup guides, then the hackathon FAQ.
- Expected: A web simulator or test console for Alexa+ add-ons, since the track asks for Alexa+ MCP servers.
- Actual: FAQ: "available to select partners only - there is currently no way for hackathon participants to apply for or gain access"; individual setup-guide pages do not say so.
- Severity: Major
- Workaround: Built our own Echo-style web simulator that is a real MCP client and MCP Apps host.
- Actionable suggestion: Ship a public, rate-limited Alexa+ add-on simulator (or open the Web Simulator in read-only mode) for hackathons, and put the "partners only" note on every setup-guide page.

### MCP Apps SDK 2.x needs the split v2 MCP SDK packages, not @modelcontextprotocol/sdk
- Tool / API / SDK: @modelcontextprotocol/ext-apps 2.0.3, @modelcontextprotocol/sdk 1.32.1
- Task attempted: Pick SDK versions for an MCP server with an MCP App UI.
- Steps taken: Installed @modelcontextprotocol/sdk 1.32.1 together with ext-apps 2.0.3 in a scratch project; inspected ext-apps peer dependencies and the official examples' package.json.
- Expected: ext-apps works with @modelcontextprotocol/sdk, the package name used by the MCP TypeScript SDK until v2.
- Actual: ext-apps 2.0.3 peer-depends on @modelcontextprotocol/client|core|server ^2.0.0 and zod ^4.2.0, not on @modelcontextprotocol/sdk (latest 1.32.1); the official ext-apps examples import the v2 split packages.
- Severity: Minor
- Workaround: Pinned @modelcontextprotocol/server|client 2.3.1, node 2.1.1, express 2.0.2, zod 4.
- Actionable suggestion: State the SDK generation requirement at the top of the MCP Apps quickstart and in the Alexa+ resources section.
