# Yakshas-v1

A **multi-device, multi-LLM, multi-channel AI automation platform** that orchestrates Android phones, PCs, Google APIs, and third-party services with intelligent task decomposition, reinforcement learning, and behavioral adaptation.

```
Telegram/Discord/Slack/WhatsApp  →  Orchestrator  →  Multi-LLM  →  ADB/PC/APIs/3rd-Party
```

---

## Key Capabilities

**Device Control**
- 📱 Android (UI automation, screenshots, app control via ADB)
- 🖥️ PC (shell, file management, browser control)
- ☁️ Google Workspace (16 APIs: Gmail, Calendar, Drive, Sheets, Docs, YouTube, Maps, etc.)
- 🔗 Third-Party APIs (REST integration for Odoo, Shopify, etc.)

**Intelligent Automation**
- 💡 Task Decomposition — Breaks complex tasks into parallel/sequential subtasks
- 📚 Learning — Logs interactions, generates reusable skills with reward tracking
- 🧠 Digital Soul — Learns user behavior, predicts preferences, adapts communication
- 🔄 Workflows — Event-triggered, conditional automation with error recovery

**Core Features**
| Category | Details |
|----------|---------|
| AI/Learning | Multi-agent planning, tool calling, reinforcement learning |
| Memory | Experience logging, semantic search, skill generation |
| Autonomy | Event monitoring, cron scheduling, self-healing, loop detection |
| Tools | 100+ built-in + dynamic API generator |
| LLMs | Ollama (local), Claude, Gemini, Grok |
| Security | Command filtering, OAuth, audit trail, prompt guards |
| Channels | Telegram, WhatsApp, Discord, Slack, Teams, Signal, Matrix |

---

## Quick Start

### Prerequisites

- **Node.js 22+** — [download](https://nodejs.org)
- **One LLM Provider**:
  - Ollama (free, local) — [download](https://ollama.com)
  - OR Claude API key — [get](https://console.anthropic.com)
  - OR Gemini API key — [get](https://makersuite.google.com/app/apikey)
- **ADB** in PATH — [setup](https://developer.android.com/tools/releases/platform-tools)
- **Telegram bot token** — [@BotFather](https://t.me/BotFather)

### Installation & Setup

```bash
# Clone & install
git clone <repo-url>
cd Yakshas-v1
npm install

# Configure
cp .env.example .env
# Edit .env with your credentials
```

### Running

```bash
# Start supporting services
adb devices              # Check phone connection
ollama serve           # If using Ollama

# Launch agent
npx tsx src/index.ts
```

Dashboard available at `http://localhost:3456`. Use `/start` in Telegram to begin.

---

## Tool Registry (100+ Tools)

| Tier | Count | Examples |
|------|-------|----------|
| **Phone (Android)** | 13 | screenshot, ui_tree, tap, swipe, type, app_launch, shell |
| **Google APIs** | 16 | gmail_send, calendar_create, drive_upload, sheets_append, docs_edit |
| **PC/Desktop** | 8 | pc_shell, file_read/write, browser_open, clipboard |
| **Integrations** | 4 | integration_add, integration_call, integration_list |
| **Workflows** | 8+ | workflow_create, cron_schedule, event_listen, agenda_set |
| **Learning** | 6 | soul_observe, soul_predict, memory_search, skill_generate |

---

## Usage Examples

### Via Telegram
Simply chat with your bot:
- "Take a screenshot"
- "Open Gmail and show unread messages"
- "Create a calendar event for tomorrow at 3pm"
- "Update my Google Sheet with sales data"
- "Send an email to alice@company.com"

### Via CLI
```bash
npx tsx src/cli.ts "take a screenshot"
npx tsx src/cli.ts "open WhatsApp and read messages"
```

### Via API Gateway
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
  "task": "Send WhatsApp to Alice",
  "tools_used": ["adb_screenshot", "adb_tap", "adb_type", "adb_app_launch"],
  "success": true,
  "duration_ms": 8500,
  "reward": 0.95,
  "generated_skill": "open_whatsapp_to_contact"
}
```

### Skill Generation

Auto-generated reusable skills from successful workflows:
```typescript
"open_whatsapp_to_contact": {
  "steps": [
    "adb_app_launch(com.whatsapp)",
    "adb_ui_tree()",
    "adb_tap(search_box)",
    "adb_type(contact_name)"
  ],
  "preconditions": ["phone_unlocked", "whatsapp_installed"]
}
```

### Digital Soul (Behavioral Learning)

```javascript
soul_observe_start(interval_seconds: 30)  // Passive observation
soul_build()                              // Generate profile
soul_predict(scenario: "New email from CEO")  // Predict actions
soul_style(contact: "Alice")              // Get communication style
```

### Workflow Engine

Define multi-step automations with conditionals & error handling:
```json
{
  "id": "daily_briefing",
  "steps": [
    {"instruction": "Check new emails", "tool": "gmail_list_messages"},
    {"instruction": "Create summary", "tool": "docs_append"},
    {"instruction": "Wait until 9am", "waitForEvent": "time:09:00:00"},
    {"instruction": "Send summary", "tool": "gmail_send", "retryCount": 3}
  ]
}
```

### Event-Driven Automation

```javascript
// Listen for new emails from CEO
event_listen(trigger: "gmail:new_message", filter: "from:ceo@company.com")

// Schedule daily task
cron_schedule(expression: "0 9 * * MON", description: "Weekly reminder")

// Connect any REST API
integration_add(name: "odoo", baseUrl: "https://odoo.company.com", authType: "oauth2")
```

---

## Architecture Overview

```
┌──────────────────────────────────────────┐
│   Multi-Channel Gateway                  │
│  (Telegram, Discord, Slack, WhatsApp)    │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ Orchestrator (Multi-Agent Planner)       │
│ • Task decomposition • Experience replay  │
│ • Reward computation • Digital soul      │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ Agent Loop (Perception → Plan → Act)     │
│ • LLM (Ollama/Claude/Gemini/Grok)        │
│ • Tool registry • Memory • Self-correct   │
└─────────────────┬────────────────────────┘
                  │
┌─────────────────▼────────────────────────┐
│ Tool Executor (6 Tiers - 100+ Tools)     │
│ Tier 1: Phone (ADB)                      │
│ Tier 2: Google APIs (16 services)        │
│ Tier 3: PC Control                       │
│ Tier 4: Integrations (REST APIs)         │
│ Tier 5: Workflows & Autonomy             │
│ Tier 6: Memory & Learning                │
└──────────────────────────────────────────┘
```

---

## Configuration

### Environment Variables
```bash
# LLM (choose one)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5
# OR ANTHROPIC_API_KEY / GOOGLE_API_KEY / GROK_API_KEY

# Required
TELEGRAM_BOT_TOKEN=your_bot_token

# Optional
LOG_LEVEL=info
MAX_TASK_DURATION_MS=300000
DASHBOARD_PORT=3456
GATEWAY_PORT=3457
```

### Data Directories
- `data/memory/` — Experience logs, embeddings, skills
- `data/workflows/` — Workflow definitions
- `data/observations/` — Screenshots & UI state
- `data/security/` — Execution audit trail
- `data/skills/` — Per-app skill definitions

---

## Telegram Commands

```
/start          # Welcome & device status
/screenshot     # Quick screenshot
/status         # Battery, WiFi, current app
/tools          # List available tools
/help           # Usage guide
/memory         # Memory statistics
/workflows      # List saved workflows
/skills         # View learned skills
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Device not found | `adb devices` → `adb kill-server` → `adb start-server` |
| LLM connection refused | Start Ollama with `ollama serve` or check API key in `.env` |
| Telegram not responding | Verify token in `.env`, check internet, ensure bot not running elsewhere |
| Tools timeout | Increase `MAX_TASK_DURATION_MS`, close apps, ensure LLM loaded |

---

## Security

**Built-in Protection:**
- Command filtering (blocks dangerous commands)
- Execution audit trail (`data/security/exec-log.json`)
- OAuth support for scoped API access
- Prompt guards (injection attack validation)
- Rate limiting to prevent abuse

---

## Extending Yakshas-v1

### Add Custom Tool

```typescript
// src/tools/my-tool.ts
export const myCustomTool: ToolDefinition = {
  name: "my_tool",
  description: "Custom functionality",
  parameters: { /* ... */ },
  execute: async (args) => {
    // Your implementation
    return { type: "text", content: "Result" };
  }
};
```

Register in `src/agent/tool-registry.ts`.

---

## Resources

- **ADB Docs** — [Android ADB](https://developer.android.com/tools/adb)
- **Ollama Models** — [Model Library](https://ollama.com/library)
- **Claude API** — [Documentation](https://docs.anthropic.com)
- **Google Workspace** — [APIs](https://developers.google.com/workspace)
- **Telegram Bot** — [API Docs](https://core.telegram.org/bots/api)

---

## License

MIT License — See LICENSE file

**Yakshas-v1** — Intelligent, autonomous, multi-device automation for the AI era.
