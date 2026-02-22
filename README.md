# Yakshas-v1

A comprehensive **multi-device, multi-LLM, multi-channel orchestration platform** that automates Android phones, PCs, Google APIs, and third-party services. Yakshas-v1 features intelligent task decomposition, reinforcement learning, event-driven workflows, and a digital soul that learns user behavior patterns.

```
Telegram/Discord/Slack/WhatsApp  →  Orchestrator  →  Multi-LLM  →  ADB/PC/APIs/3rd-Party
```

---

## What It Does

Yakshas-v1 is a **full-stack autonomous agent platform** that orchestrates complex workflows across multiple domains:

### Device & System Control
- **📱 Android Phones** — UI automation (tap, swipe, type), screenshot, accessibility tree parsing, app control, shell commands via ADB
- **🖥️ PC/Desktop** — Terminal execution, file management, browser control, clipboard access, window management  
- **📱 Cross-Device** — Coordinate between phone and desktop in a single workflow

### Cloud & Enterprise Integration
- **☁️ Google Workspace** — 16 APIs (Gmail, Calendar, Drive, Sheets, Docs, Photos, YouTube, Maps, Tasks, People, Translate, Books, Classroom, Forms, Chat, Slides, Blogger)
- **🔗 Third-Party APIs** — Dynamic connector for any REST API (Odoo, Shopify, Instagram, WhatsApp, custom services, etc.)
- **📊 Webhooks** — Trigger workflows from external events

### Intelligent Automation
- **💡 Multi-Agent Orchestration** — Decomposes complex tasks into subtasks, executes in parallel or sequence
- **📚 Learning** — Logs all interactions, learns from successes, generates reusable skills
- **🧠 Digital Soul** — Passive observation learns user behavior, communication styles, predicts user preferences
- **🔄 Workflows** — Event-triggered, conditional, multi-step automation with error recovery

### Communication Channels
- **Telegram** (primary), **WhatsApp**, **Discord**, **Slack**, **Teams**, **Signal**, **Matrix**, and custom webhooks

---

## Core Capabilities

| Domain | Capabilities |
|--------|--------------|
| **Intelligence** | Multi-agent planning, tool calling, context-aware prompting, reinforcement learning (RLHF) |
| **Memory & Learning** | Experience logging, vector embeddings, semantic search, skill generation, reward tracking |
| **Autonomy** | Event monitoring, cron scheduling, workflow engine, self-healing, loop detection |
| **Coverage** | 100+ built-in tools + dynamic API generator for infinite extensibility |
| **LLMs** | Ollama (local), Claude (Anthropic), Gemini (Google), Grok (xAI) |
| **Security** | Command filtering, execution audit trail, OAuth, prompt guards, dangerous-op blocking |

---

## Quick Start

### Prerequisites

- **Node.js 22+** — [download](https://nodejs.org)
- **One LLM Provider**:
  - Ollama (free, local) — [download](https://ollama.com)
  - OR Claude API key — [get](https://console.anthropic.com)
  - OR Gemini API key — [get](https://makersuite.google.com/app/apikey)
  - OR Grok API key — [get](https://console.x.ai)
- **ADB** (Android Debug Bridge) in PATH — [setup](https://developer.android.com/tools/releases/platform-tools)
- **Android phone** with USB Debugging enabled (optional, for phone control)
- **Telegram bot token** — [@BotFather](https://t.me/BotFather)

### Installation

```bash
# Clone & install
git clone <repo-url>
cd phone-agent
npm install

# Create config
cp .env.example .env

# Edit .env with your settings:
# For Ollama (local, free):
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5

# For Claude:
ANTHROPIC_API_KEY=sk-ant-...

# For Gemini:
GOOGLE_API_KEY=...

# Telegram (required)
TELEGRAM_BOT_TOKEN=123456:ABCdef...
```

### Run

```bash
# Start supporting services
adb devices              # Check phone connection
ollama serve           # If using Ollama

# Start the agent
npx tsx src/index.ts
```

The agent starts a dashboard on `http://localhost:3456` and listens for Telegram messages. Use `/start` in Telegram to begin.

---

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────┐
│    Multi-Channel Gateway                        │
│  Telegram • Discord • Slack • WhatsApp • Teams  │
│  Signal • Matrix • Custom Webhooks              │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│   Orchestrator (Multi-Agent Planner)            │
├────────────────────────────────────────────────┤
│  • Task decomposition & planning                │
│  • Context builder from memory & experience     │
│  • Experience replay & skill matching           │
│  • Reward computation & learning feedback       │
│  • Digital soul builder (user profiling)        │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│   Agent Loop (Perception → Plan → Act → Verify) │
├────────────────────────────────────────────────┤
│  • LLM Provider (pluggable: Ollama/Claude/etc) │
│  • Tool registry & executor (100+ tools)        │
│  • Memory store (vectors + persistent DB)       │
│  • Self-correction & retry logic                │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│   Tool Executor (6 Tiers)                       │
├────────────────────────────────────────────────┤
│  Tier 1: Phone (ADB)                            │
│    → screenshot, ui_tree, tap, swipe, type      │
│    → key, long_press, wait, app_launch, shell   │
│                                                   │
│  Tier 2: Google APIs (16 services)              │
│    → Gmail, Calendar, Drive, Sheets, Docs, etc  │
│    → YouTube, Maps, Photos, Tasks, People, etc  │
│    → Event triggers (auto-react to changes)     │
│                                                   │
│  Tier 3: PC Control                             │
│    → pc_shell, file_list, file_read/write       │
│    → browser_open, clipboard, windows           │
│                                                   │
│  Tier 4: Integrations                           │
│    → integration_add, integration_call          │
│    → Dynamic REST API connector                 │
│                                                   │
│  Tier 5: Workflows & Autonomy                   │
│    → workflow_create, workflow_execute          │
│    → cron_schedule, event_listen, agenda        │
│    → Conditional branching, error recovery      │
│                                                   │
│  Tier 6: Memory & Learning                      │
│    → soul_observe, soul_predict, memory_search  │
│    → skill_list, skill_generate                 │
└────────────────────────────────────────────────┘
```

### Tool Registry (100+ Tools)

| Tier | Count | Examples | Purpose |
|------|-------|----------|---------|
| **Tier 1: Phone** | 13 | screenshot, ui_tree, tap, swipe, type, app_launch, adb_shell | Android UI automation |
| **Tier 2: Google APIs** | 16 services | gmail_send, calendar_create, drive_upload, sheets_append, docs_edit, youtube_search, maps_directions | Cloud productivity |
| **Tier 3: Desktop** | 8 | pc_shell, file_list, file_read, file_write, browser_open, clipboard_copy, windows_list | PC control |
| **Tier 4: Integrations** | 4 | integration_add, integration_call, integration_list, integration_remove | Any REST API |
| **Tier 5: Automation** | 8+ | workflow_create, workflow_execute, cron_schedule, event_listen, agenda_set, heartbeat | Workflows & events |
| **Tier 6: Learning** | 6 | soul_observe_start, soul_predict, memory_search, skill_list, skill_generate, observation_save | Learning & memory |

---

## Usage Examples

### Via Telegram (Natural Language)

Simply chat with your bot:

```
"Take a screenshot"
"Open Gmail and show me unread messages"
"Create a calendar event for tomorrow at 3pm"
"Update my Google Sheet with sales data"
"Open YouTube and search for cooking tutorials"
"Send an email to alice@company.com"
"Create a document and add today's notes"
"What's my schedule for next week?"
"List all files in my Downloads folder"
```

The agent:
1. **Understands** the natural language
2. **Plans** which tools to use
3. **Executes** the actions
4. **Verifies** the results
5. **Reports** back with screenshots/outputs

### Via CLI

```bash
npx tsx src/cli.ts "take a screenshot"
npx tsx src/cli.ts "open WhatsApp and read messages"
npx tsx src/cli.ts "create a Google Sheet with my data"
```

### Via API Gateway

The agent runs a REST API on `http://localhost:3457`:

```bash
curl -X POST http://localhost:3457/task \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Take a screenshot", "chatId": 123}'
```

---

## Advanced Features

### Experience Logging & Learning

Every interaction is logged and analyzed:

```json
{
  "id": "exp_2026_02_23_001",
  "timestamp": "2026-02-23T10:30:00Z",
  "task": "Send WhatsApp to Alice",
  "tools_used": [
    "adb_screenshot",
    "adb_tap",
    "adb_type",
    "adb_app_launch"
  ],
  "success": true,
  "duration_ms": 8500,
  "reward": 0.95,
  "generated_skill": "open_whatsapp_to_contact"
}
```

Location: `data/memory/phone_agent_experiences.json`

### Skill Generation

After successful workflows, the agent generates reusable skills:

```typescript
// Auto-generated skill from experience
"open_whatsapp_to_contact": {
  "steps": [
    "adb_app_launch(com.whatsapp)",
    "adb_ui_tree()",
    "adb_tap(search_box)",
    "adb_type(contact_name)"
  ],
  "preconditions": ["phone_unlocked", "whatsapp_installed"],
  "postconditions": ["contact_conversation_open"]
}
```

### Digital Soul (Behavioral Profiling)

The agent can learn your habits and predict your actions:

```javascript
// Start passive observation
soul_observe_start(interval_seconds: 30)

// Generate behavioral profile
soul_build()

// Ask what you'd likely do
soul_predict(scenario: "New email from CEO arrives")
// Returns: "User usually replies within 5 minutes"

// Get communication style for a contact
soul_style(contact: "Alice")
// Returns: "Professional, concise, uses emojis sparingly"
```

### Workflow Engine

Define multi-step automations with conditionals and error handling:

```json
{
  "id": "daily_briefing",
  "name": "Daily Morning Briefing",
  "steps": [
    {
      "id": "step_1",
      "instruction": "Check new emails",
      "tool": "gmail_list_messages",
      "condition": "new_messages.count > 0",
      "timeout_ms": 30000
    },
    {
      "id": "step_2",
      "instruction": "Create summary in Google Docs",
      "tool": "docs_append",
      "toolArgs": {
        "documentId": "{{context.docId}}",
        "content": "Daily Summary: {{context.email_summary}}"
      }
    },
    {
      "id": "step_3",
      "instruction": "Wait until 9am",
      "waitForEvent": "time:09:00:00"
    },
    {
      "id": "step_4",
      "instruction": "Send email summary",
      "tool": "gmail_send",
      "toolArgs": {
        "to": "self@company.com",
        "subject": "Morning Briefing",
        "body": "{{context.summary}}"
      },
      "retryCount": 3,
      "onFailure": "skip"
    }
  ]
}
```

Execute via: `"Run my daily briefing"`

### Event-Driven Automation

Automatically react to events:

```javascript
// Listen for new Gmail messages from CEO
event_listen(
  trigger: "gmail:new_message",
  filter: "from:ceo@company.com",
  action: "adb_app_launch(com.whatsapp)" // Alert on phone
)

// Schedule daily task
cron_schedule(
  expression: "0 9 * * MON",
  description: "Weekly team meeting reminder"
)

// Wait for external event
workflow_wait(
  eventType: "webhook:github_push",
  timeout_ms: 3600000
)
```

### Dynamic API Integration

Connect any REST API:

```javascript
// Connect Odoo
integration_add(
  name: "odoo",
  baseUrl: "https://odoo.company.com",
  authType: "oauth2",
  credentials: { clientId: "...", clientSecret: "..." }
)

// Use it in workflows
integration_call(
  integrationId: "odoo",
  method: "GET",
  path: "/api/res.partner",
  queryParams: { limit: "10" }
)
```

### Self-Healing & Adaptation

The agent detects and recovers from failures:

- **Loop Detection** — Detects and breaks infinite tap loops
- **UI Adaptation** — Learns UI changes and adjusts element locations
- **Fallback Strategies** — Tries alternative UI paths when primary fails
- **Graceful Degradation** — Skips non-critical steps to complete main task
- **Healer Agents** — Spawn sub-agents to repair failed states

---

## Configuration

### Environment Variables

```bash
# LLM Provider (choose one)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5
# OR
ANTHROPIC_API_KEY=sk-ant-...
# OR
GOOGLE_API_KEY=...
# OR
GROK_API_KEY=...

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# Optional
DEBUG=false
LOG_LEVEL=info
MAX_TASK_DURATION_MS=300000  # 5 minutes
ADB_DEVICE=                  # Auto-detect by default
DASHBOARD_PORT=3456
GATEWAY_PORT=3457
```

### Data Directories

- `data/memory/` — Experience logs, vector embeddings, learned skills
- `data/workflows/` — Saved workflow definitions
- `data/observations/` — Screenshot snapshots & UI state
- `data/security/` — Execution audit trail
- `data/skills/` — Per-app skill definitions
- `data/soul/` — Behavioral profile & communication styles

---

## Troubleshooting

### "Device not found"
```bash
adb devices              # Check connection
adb kill-server         # Reset ADB
adb start-server
adb devices
```

### "LLM connection refused"
```bash
# For Ollama
ollama serve

# For Claude/Gemini/Grok
# Check API key in .env
```

### "Telegram not responding"
- Verify `TELEGRAM_BOT_TOKEN` in `.env`
- Check bot is not running elsewhere
- Ensure internet connection
- Check Telegram bot is in chat

### "Tool execution times out"
- Increase `MAX_TASK_DURATION_MS` in `.env`
- Close unnecessary apps on phone/PC
- Ensure LLM model is fully loaded
- Check network connectivity

### "No tools available"
- Verify `adb devices` shows connected phone
- Check `http://localhost:3456/api/tools` to list available tools
- Ensure plugins are properly registered

---

## Commands

### Telegram Bot Commands

```
/start          # Show welcome & device status
/screenshot     # Quick screenshot
/status         # Battery, WiFi, current app
/tools          # List available tools
/help           # Usage guide
/stop           # Cancel running task
/memory         # Show memory statistics
/workflows      # List saved workflows
/skills         # View learned skills
```

---

## Security

Phone Agent includes multiple security layers:

| Layer | Feature |
|-------|---------|
| **Command Filtering** | Blocks dangerous commands (rm -rf, format, shutdown, etc.) |
| **Execution Audit** | Logs all tool executions to `data/security/exec-log.json` |
| **OAuth Support** | Integrates with Google OAuth for scoped API access |
| **Prompt Guards** | Validates incoming messages for injection attacks |
| **Rate Limiting** | Prevents abuse from rapid tool calls |

All security events are logged and available in the dashboard.

---

## Performance Tips

1. **Use Ollama locally** — Faster, private, no API costs
2. **Pre-warm the model** — Run a quick task before important ones
3. **Optimize workflows** — Use parallel steps where possible
4. **Archive old experiences** — Keep `data/memory/` manageable
5. **Monitor dashboard** — Check `http://localhost:3456` for bottlenecks

---

## Architecture Details

### Multi-Agent Decomposition

When given a complex task, the orchestrator:

1. **Analyzes** the request against learned patterns
2. **Decomposes** into subtasks (if needed)
3. **Assigns** subtasks to parallel or sequential agents
4. **Monitors** progress and collects results
5. **Recomposes** outputs into final result
6. **Stores** experience for future learning

### Reinforcement Learning

After each task:

1. **Compute reward** — Success metric (0.0 to 1.0)
2. **Log experience** — Store interaction trace
3. **Match skills** — Compare against known patterns
4. **Generate skills** — If new successful pattern found
5. **Update memory** — Index for semantic search
6. **Predict rewards** — Learn reward patterns from context

### Memory System

**Vector Store**
- Stores embeddings of all experiences
- Enables semantic search (similarity-based retrieval)
- Used for context augmentation in prompts

**Experience Store**
- JSON-based persistent log
- Tracks success/failure, duration, tools used
- Enables historical analysis & learning

**Skill Library**
- Generated reusable procedures
- Templated for different contexts
- Used to shortcut future similar tasks

---

## Extending Phone Agent

### Adding a Custom Tool

```typescript
// src/tools/my-tool.ts
import type { ToolDefinition, ToolResult } from "../agent/tool-registry.js";

export const myCustomTool: ToolDefinition = {
  name: "my_tool",
  description: "Does something special",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string", description: "First parameter" },
      param2: { type: "number", description: "Second parameter" }
    },
    required: ["param1"]
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const param1 = String(args.param1);
    const param2 = Number(args.param2 ?? 0);
    
    // Do something
    const result = await doSomething(param1, param2);
    
    return {
      type: "text",
      content: `Result: ${result}`
    };
  }
};
```

Register in `src/agent/tool-registry.ts`:

```typescript
registry.register(myCustomTool);
```

### Adding a Custom LLM Provider

1. Implement `LLMProvider` interface in `src/llm/llm-provider.ts`
2. Add to provider factory in `src/llm/provider-factory.ts`
3. Set via environment variable

---

## Data Privacy

Phone Agent stores data locally by default:

- **Local Mode** (Ollama) — No data sent to external servers
- **API Mode** — Requests sent to Claude/Gemini/Grok (read their privacy policies)
- **All interactions** logged to `data/` folder on your machine
- **No telemetry** by default (opt-in via `TELEMETRY_ENABLED`)

---

## Contributing

Contributions welcome! Areas of interest:

- New tool implementations
- LLM provider integrations
- UI improvements
- Test coverage
- Documentation

Please fork, create a feature branch, and submit a PR.

---

## License

MIT License — See LICENSE file

---

## Resources

- **Android ADB** — [Documentation](https://developer.android.com/tools/adb)
- **Ollama Models** — [Model library](https://ollama.com/library)
- **Claude API** — [Documentation](https://docs.anthropic.com)
- **Google APIs** — [Workspace APIs](https://developers.google.com/workspace)
- **Telegram Bot API** — [Documentation](https://core.telegram.org/bots/api)

---

**Phone Agent** — Intelligent, autonomous, multi-device automation for the AI era.
