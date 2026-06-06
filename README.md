# Sentinel

Autonomous debug agent for web apps. Scans your project, runs user flows with Playwright, collects runtime evidence, diagnoses bugs with LLM, and generates patches.

`v0.1.0-m9rc` · 51 tests · 8 workspaces · MIT

> **Work in progress** — This project is not feature-complete. Feel free to fork, modify, and build on top of it.

---

## Quick Start

```bash
# Install
cd Sentinel && bun install

# Demo (no LLM key needed) — outputs 3 hardcoded sample reports
bun packages/cli/src/index.ts run --demo

# Web UI
bun packages/cli/src/index.ts ui
# → http://127.0.0.1:4317
```

For real bug detection, configure an LLM provider and ensure your target app's dev server is running:

```bash
# Initialize target project
bun packages/cli/src/index.ts init --project=/path/to/your-app

# Edit .sentinel/llm.yml (see "LLM Configuration" below)

# Start your app's dev server in another terminal, then:
bun packages/cli/src/index.ts run --project=/path/to/your-app
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `sentinel run` | Full debug pipeline |
| `sentinel run --demo` | Sample reports (no LLM) |
| `sentinel run --tier 0` | Report only, no patches |
| `sentinel map` | Generate FeatureMap only |
| `sentinel doctor` | Check environment & config |
| `sentinel hello` | Test LLM connectivity |
| `sentinel init` | Initialize `.sentinel/` in target project |
| `sentinel ui` | Launch Web Console |

Global option: `--project <path>` (defaults to cwd)

---

## LLM Configuration

Edit `.sentinel/llm.yml`:

```yaml
default: my-provider

providers:
  my-provider:
    type: openai-compatible    # or ollama-native (local models)
    baseUrl: https://api.example.com/v1
    apiKey: your-key-here
    model: model-name
```

Two protocols supported:

- **openai-compatible** — Any OpenAI Chat Completions API compatible service
- **ollama-native** — Local Ollama or LM Studio (no apiKey needed)

---

## How It Works

```
Mapper → Runner → Analyst → Critic → Planner → Executor
  │         │         │         │         │         │
  ▼         ▼         ▼         ▼         ▼         ▼
FeatureMap  Evidence  Hypothesis Confirm   FixOption  Patch
```

1. **Mapper** — Detects frameworks, routes, data models; generates user flows
2. **Runner** — Executes flows with Playwright, hits API endpoints
3. **Analyst** — LLM diagnoses root cause from collected evidence
4. **Critic** — Validates hypothesis against evidence (confirm/reject)
5. **Planner** — Generates fix options with cost scoring
6. **Executor** — Writes patches to `.sentinel/auto-patches/` (never modifies source directly)

---

## Project Structure

```
Sentinel/
├── packages/
│   ├── core/          Microkernel (Bus / Budget / Kernel)
│   ├── subagents/     8 agents (mapper/sensor/runner/analyst/critic/planner/enhancer/executor)
│   ├── adapters/      13 framework detectors (2 full, 11 dependency-only)
│   ├── providers/     LLM / MCP / Knowledge providers
│   ├── reporters/     Markdown + JSON report generators
│   ├── sensors/       Evidence collection
│   └── cli/           CLI entry point
├── sentinel-ui/       React 19 + Vite Web Console
├── examples/          nextjs-blog sample project
└── docs/              Architecture, config spec, roadmap
```

---

## License

MIT
