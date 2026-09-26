# Sentinel

Local debug agent for web apps. It discovers safe read-only routes, runs browser flows, records evidence and coverage gaps, and proposes reviewable fixes when a root cause is supported.

`v0.2.0` · 8 workspaces · MIT

> **Work in progress** — This project is not feature-complete. Feel free to fork, modify, and build on top of it.

---

## Quick Start

### Launch Sentinel

```
Double-click start.command
```

Every time. First time it installs dependencies and builds the UI. After that it starts instantly.

Browser opens automatically → http://127.0.0.1:4317

---

## How to Use (Web Console)

1. **Open Console** → `sentinel ui` (browser opens automatically)
2. **Step 1: Settings** → Configure your LLM provider (API key, model)
3. **Step 2: Add Project** → Select your web project folder
4. **Step 3: Run** → Click Run. Sentinel will:
   - Initialize project-local `.sentinel/` data and start a detected dev server
   - Discover public pages and safe GET endpoints, then run browser/API assertions
   - Save evidence, findings, coverage gaps, and a run summary in that project
   - Propose fixes only when available evidence supports a root cause

Add explicit project flows for login, publishing, comments, settings, dynamic URLs and permission checks. Sentinel does not guess business outcomes or automatically click write actions.

### Project-specific checks

Create `.sentinel/app.map.ts` in the target project to define outcomes the project expects. For example:

```ts
export default {
  flows: [
    {
      id: 'save-settings',
      description: 'A changed setting remains after reload',
      steps: [
        { action: 'visit', url: '/settings' },
        { action: 'fill', selector: '[name="displayName"]', value: 'Sentinel test' },
        { action: 'click', selector: 'button[type="submit"]' },
        { action: 'visit', url: '/settings' },
        { action: 'assert', kind: 'text', expected: 'Sentinel test' },
      ],
    },
  ],
};
```

Use a staging environment and a disposable test account for flows that change data. Explicit `flows` replace generated baseline flows; the run summary reports what was and was not executed.

---

## CLI Commands

For power users who prefer the terminal:

| Command | Description |
|---------|-------------|
| `sentinel ui` | Launch Web Console |
| `sentinel run --project=/path` | Full debug pipeline |
| `sentinel run --demo` | 3 hardcoded sample reports (no LLM key, no real bug detection) |
| `sentinel run --tier 0` | Report only, no patches |
| `sentinel map --project=/path` | Generate FeatureMap only |
| `sentinel doctor` | Check environment & config |
| `sentinel hello` | Test LLM connectivity |
| `sentinel init --project=/path` | Initialize `.sentinel/` in target project |
| `sentinel update` | Self-update Sentinel (M8.5 stub) |

---

## LLM Configuration

Configure via the WebUI Settings page, or edit `.sentinel/llm.yml` directly:

```yaml
default: my-provider

providers:
  my-provider:
    type: openai-compatible    # or ollama-native (local models)
    baseUrl: https://api.example.com/v1
    apiKey: your-key-here
    model: model-name
```

Supported:
- **openai-compatible** — Compatible API services and LM Studio (`http://localhost:1234/v1`)
- **ollama-native** — Local Ollama (`http://localhost:11434`)

---

## How It Works

```
Mapper → Runner + Browser/HTTP → Analyst → Critic → Verifier → Planner → Enhancer → Executor
```

1. **Mapper** — Detects frameworks, routes, data models; auto-generates user flows
2. **Runner** — Executes safe browser/API assertions and captures failure evidence; targeted Sensor requests are available separately
3. **Analyst** — Suggests a root-cause hypothesis from evidence
4. **Critic** — Checks whether runtime and source evidence actually support that hypothesis
5. **Verifier** — Rejects conclusions without sufficient supporting evidence
6. **Planner** — Ranks three fix options by confidence, impact, stage, effort and risk
7. **Enhancer** — Optionally searches external knowledge; `--no-enhance` skips search without breaking reporting
8. **Executor** — Writes valid generated patches to `.sentinel/auto-patches/` for review; generating a patch does not apply or verify it
9. **Reporter** — Saves findings and run coverage to the target project

---

## Automation Features

- **Auto-init** — First run creates project-local directories and budget; global LLM secrets are not copied into projects
- **Auto dev server** — Detects `dev`/`start`/`serve` scripts and starts the server for you
- **Global config** — LLM settings saved once apply to all future projects
- **Auto cleanup** — Dev server stops automatically after debug completes

The global project list and default LLM connection live under `~/.sentinel/`. Each project's flow overrides and run history live in its own `.sentinel/`; reports live in that project's `reports/`. The WebUI loads the latest saved result when reopened. A project-specific `.sentinel/llm.yml` overrides the global provider.

---

## Project Structure

```
Sentinel/
├── start.command       ← Double-click to install + launch
├── packages/
│   ├── core/           Microkernel (Bus / Budget / Kernel)
│   ├── subagents/      Mapper, runner, analyst, critic, verifier, planner, enhancer and executor
│   ├── adapters/       13 framework detectors
│   ├── providers/      LLM / Memory / Skills / MCP / Knowledge providers
│   ├── reporters/      Markdown + JSON report generators + CLI printer
│   ├── sensors/        Evidence types + dedupe helpers (sensor agent lives in subagents)
│   └── cli/            CLI entry point
├── sentinel-ui/        React 19 + Vite Web Console
├── examples/           nextjs-blog sample project
└── docs/               Architecture, config spec, roadmap
```

---

## Requirements

- [bun](https://bun.sh) (install: `curl -fsSL https://bun.sh/install | bash`)
- macOS / Linux
- An LLM API key (or local Ollama for free usage)

---

## License

MIT
