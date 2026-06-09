# Sentinel

Autonomous debug agent for web apps. Scans your project, runs user flows with Playwright, collects runtime evidence, diagnoses bugs with LLM, and generates patches.

`v0.2.0` · 48 tests · 8 workspaces · MIT

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
   - Auto-initialize `.sentinel/` config in your project
   - Auto-detect and start the dev server
   - Scan routes, generate user flows
   - Execute flows with Playwright
   - Analyze failures with LLM
   - Generate bug reports + patches

No manual commands needed. Everything happens in the UI.

---

## CLI Commands

For power users who prefer the terminal:

| Command | Description |
|---------|-------------|
| `sentinel ui` | Launch Web Console |
| `sentinel run --project=/path` | Full debug pipeline |
| `sentinel run --demo` | Sample reports (no LLM key needed) |
| `sentinel run --tier 0` | Report only, no patches |
| `sentinel map --project=/path` | Generate FeatureMap only |
| `sentinel doctor` | Check environment & config |
| `sentinel hello` | Test LLM connectivity |
| `sentinel init --project=/path` | Initialize `.sentinel/` in target project |

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
- **openai-compatible** — OpenAI, MiniMax, DeepSeek, Groq, Together AI, etc.
- **ollama-native** — Local Ollama or LM Studio (free, no API key)

---

## How It Works

```
Mapper → Runner → Analyst → Critic → Planner → Executor
  │         │         │         │         │         │
  ▼         ▼         ▼         ▼         ▼         ▼
FeatureMap  Evidence  Hypothesis Confirm   FixOption  Patch
```

1. **Mapper** — Detects frameworks, routes, data models; auto-generates user flows
2. **Runner** — Auto-starts dev server, executes flows with Playwright
3. **Analyst** — LLM diagnoses root cause from collected evidence
4. **Critic** — Validates hypothesis against evidence (confirm/reject)
5. **Planner** — Generates fix options with cost scoring
6. **Executor** — Writes patches to `.sentinel/auto-patches/` (never modifies source directly)

---

## Automation Features

- **Auto-init** — First run on a new project automatically creates `.sentinel/` config
- **Auto dev server** — Detects `dev`/`start`/`serve` scripts and starts the server for you
- **Global config** — LLM settings saved once apply to all future projects
- **Auto cleanup** — Dev server stops automatically after debug completes

---

## Project Structure

```
Sentinel/
├── start.command       ← Double-click to install + launch
├── packages/
│   ├── core/           Microkernel (Bus / Budget / Kernel)
│   ├── subagents/      8 agents (mapper/sensor/runner/analyst/critic/planner/enhancer/executor)
│   ├── adapters/       13 framework detectors
│   ├── providers/      LLM / MCP / Knowledge providers
│   ├── reporters/      Markdown + JSON report generators
│   ├── sensors/        Evidence collection
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
