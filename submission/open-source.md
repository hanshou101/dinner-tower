# Open Source mini challenge — submission fields

> 角色：包装（T10）。Devpost 的 **Open Source** mini challenge（$5,000 + $5,000 AWS Credits）。
> 下面每个字段都可以直接复制粘贴；英文字段保持原样，不要改写。
> 前提：主控在提交前把 `https://github.com/hanshou101/dinner-tower` 建出来（公开快照），
> 本文件按任务书写死该 URL。写本文件时（2026-10-20）该仓库尚未创建。

## 1. Links

| 项 | 值 |
| --- | --- |
| Contribution URL（开源贡献仓库） | https://github.com/hanshou101/echo-mcp-apps-sim |
| Project repository URL（本次参赛项目） | https://github.com/hanshou101/dinner-tower |
| GitHub username | hanshou101 |
| Mini challenge | Open Source |

## 2. Field: What I did

```text
I built and open-sourced echo-mcp-apps-sim, a small web host that turns any MCP
server into something you can watch on an Echo Show-style screen.

Dinner Tower needs an MCP Apps surface (a departure board rendered from a
ui:// resource) and a way for the server to ask a question in the middle of a
tool call (elicitation). When we went looking for a host to develop against,
there was nothing we were allowed to use: the official voice-assistant
simulators are not publicly available, and the existing MCP inspectors show
JSON, not a screen. So I extracted the host half of our demo into its own
repository, replaced everything product-specific with configuration, and
published it under MIT so the next team does not lose the same days.

The result is a real MCP client in the browser, not a mock: Streamable HTTP
with stateful sessions, a double-iframe MCP Apps sandbox, form elicitation in
both the titled-enum and legacy-enum schema shapes, a tool console, an
optional OpenAI-compatible agent mode, and a headless Playwright suite that
proves each of those against a bundled example server.
```

## 3. Field: How it works

```text
The page is a 1280x720 web app. The browser opens a Streamable HTTP session
with @modelcontextprotocol/client, declares elicitation(form) and the MCP Apps
UI extension, then lists and calls tools exactly like any other client. A tool
result that references a ui:// resource is read with resources/read, written
into a sandboxed iframe on a second origin, and wired to the server through
the MCP Apps AppBridge; calls the App makes itself are forwarded through the
host and shown in the log.

Elicitation requests arrive as elicitation/create and are rendered as a card
over the screen: the server's message plus one large button per option,
supplied either as a 2025-11-25 titled enum (oneOf: [{const, title}]) or as the
legacy enum + enumNames pair. The click is returned as
{action: "accept", content: {choice}}.

Two small Node processes serve it: the page and its JSON API on 8180, the
sandbox proxy on 8181 (a separate origin is what makes the sandbox meaningful),
and the server under test wherever it listens (3301 for the bundled example).
Everything the page needs to know comes from GET /api/config, so pointing it at
another server is one environment variable.

Direct mode (quick-action chips and a tool console) needs no model at all.
Agent mode is optional: with an OpenAI-compatible endpoint configured, the page
runs a bounded tool loop in the browser while the key stays on the host server,
and every elicitation is still answered by the person clicking.

The repository ships the tests that matter: the E2E suite connects over
Streamable HTTP, checks the negotiated protocol and session id, asserts the App
rendered inside the iframe by reading its DOM, clicks a button inside the App
and sees the forwarded tools/call, answers both elicitation schema shapes, and
checks the demo clock only appears when the server exposes it.
```

## 4. Field: Why it matters

```text
MCP Apps put a real interface on the glass, but the feedback loop for building
one is bad: most clients show you protocol JSON, and the simulators for
voice-first assistants are not something a random developer can log into. You
end up shipping a board you have never seen, a sandbox CSP you have never
tripped, and an elicitation schema you have only read about.

This repository closes that gap for everyone, not just for us. Any MCP server
author can clone it, run two commands, and watch their App render and their
question get answered, on a screen shaped like the device the app is for. It is
deliberately small and product-neutral: no account, no cloud, no vendor SDK,
one JSON file for the quick actions you care about.

We also think the honest bits matter. The page says "Simulated Alexa+
experience - unofficial demo" and uses no Amazon logos, because pretending to
be the official simulator would be worse than having none. Where a capability
is missing (no voice input, Streamable HTTP only) the README says so in a
Limits section instead of hiding it. If this saves one team the two days we
spent reverse-engineering the sandbox handshake, it has done its job.
```

## 5. 提交前检查（给人看的，不进表单）

- [ ] `https://github.com/hanshou101/echo-mcp-apps-sim` 公开可访问、About 显示 MIT。
- [ ] `https://github.com/hanshou101/dinner-tower` 已由主控建好并公开（本文件按任务书写死）。
- [ ] 表单里 GitHub username 用 `hanshou101`。
- [ ] 若 Devpost 要求填的是「贡献」而非仓库：链接填 contribution URL 那一行。
