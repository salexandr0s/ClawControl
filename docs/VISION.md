# ClawControl Vision Document

> **The goal:** A standalone, CLI-agnostic multi-agent orchestration platform that doesn't depend on any single AI framework.

---

## 1. What We're Building

ClawControl is **mission control for AI agent swarms** — a complete orchestration layer that:

1. **Spawns and manages agents** across any CLI (Claude, Codex, Cursor, Gemini, OpenCode, etc.)
2. **Routes messages** between agents in real-time (sub-10ms)
3. **Orchestrates workflows** with work orders, operations, and approval gates
4. **Governs dangerous actions** with typed confirms and tool policies
5. **Persists everything** — receipts, trajectories, handoffs, artifacts

**Not** another wrapper around one AI. **The** control plane for all of them.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLAWCONTROL PLATFORM                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        CONTROL PLANE                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │   │
│  │  │ Work     │  │ Operation│  │ Approval │  │ Governor         │ │   │
│  │  │ Orders   │  │ Router   │  │ Gates    │  │ (Tool Policies)  │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      MESSAGING LAYER                             │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                    Message Bus                            │   │   │
│  │  │  • Agent-to-Agent (pub/sub, <10ms)                       │   │   │
│  │  │  • Human-to-Agent (commands, approvals)                  │   │   │
│  │  │  • Agent-to-System (receipts, artifacts)                 │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       AGENT LAYER                                │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │   │
│  │  │  Adapter   │ │  Adapter   │ │  Adapter   │ │  Adapter   │   │   │
│  │  │  Claude    │ │  Codex     │ │  Cursor    │ │  Gemini    │   │   │
│  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘   │   │
│  │        │              │              │              │          │   │
│  │        ▼              ▼              ▼              ▼          │   │
│  │  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │   │
│  │  │ claude   │   │ codex    │   │ cursor   │   │ gemini   │   │   │
│  │  │ CLI      │   │ CLI      │   │ composer │   │ CLI      │   │   │
│  │  └──────────┘   └──────────┘   └──────────┘   └──────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PERSISTENCE LAYER                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │   │
│  │  │ SQLite   │  │ Receipts │  │Trajector-│  │ Artifacts        │ │   │
│  │  │ + FTS5   │  │ + Logs   │  │ ies      │  │ (files, diffs)   │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Control Plane

The brain. Manages work orders, routes operations to agents, enforces policies.

| Component | Responsibility |
|-----------|----------------|
| **Work Order Manager** | Create, update, track work orders (WO-0001, etc.) |
| **Operation Router** | Assign operations to agents based on station/role |
| **Approval Gates** | Human-in-the-loop checkpoints |
| **Governor** | Tool policies, typed confirms, security rules |
| **Workflow Engine** | Define multi-step workflows (plan→build→review→ship) |

### 3.2 Messaging Layer

Real-time communication bus. Every agent connects here.

| Feature | Description |
|---------|-------------|
| **Agent Registry** | Who's online, what role, what CLI |
| **Pub/Sub Channels** | Topic-based messaging (e.g., `wo:0001`, `station:build`) |
| **Direct Messages** | Agent-to-agent with delivery confirmation |
| **Broadcast** | System announcements, work order updates |
| **Message Queue** | Reliable delivery with retry for offline agents |

**Protocol Options:**
- WebSocket (default) — low latency, bidirectional
- File-based (Agent Relay style) — works with any CLI
- HTTP polling (fallback) — universal compatibility

### 3.3 Agent Layer (Adapters)

Uniform interface to any CLI tool.

```typescript
interface AgentAdapter {
  // Lifecycle
  spawn(config: SpawnConfig): Promise<AgentHandle>
  kill(handle: AgentHandle): Promise<void>
  
  // Communication
  send(handle: AgentHandle, message: Message): Promise<void>
  onMessage(handle: AgentHandle, callback: (msg: Message) => void): void
  
  // State
  getStatus(handle: AgentHandle): AgentStatus
  getContext(handle: AgentHandle): ContextInfo  // tokens used, etc.
  
  // Continuity
  saveState(handle: AgentHandle): Promise<SessionState>
  loadState(handle: AgentHandle, state: SessionState): Promise<void>
}

interface SpawnConfig {
  name: string
  cli: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' | 'custom'
  role: string              // Path to role.md
  task?: string             // Initial task
  workDir?: string          // Working directory
  env?: Record<string, string>
  model?: string            // Override default model
  tools?: ToolPolicy        // Allowed/denied tools
  shadow?: ShadowConfig     // Attach a shadow agent
}
```

**Adapters to Build:**

| Adapter | CLI | I/O Method | Priority |
|---------|-----|------------|----------|
| `@clawcontrol/adapter-claude` | `claude` | stdin/stdout JSON | P0 |
| `@clawcontrol/adapter-codex` | `codex` | stdin/stdout JSON | P0 |
| `@clawcontrol/adapter-cursor` | Cursor Composer | API | P1 |
| `@clawcontrol/adapter-gemini` | `gemini` | stdin/stdout | P1 |
| `@clawcontrol/adapter-opencode` | `opencode` | stdin/stdout | P2 |
| `@clawcontrol/adapter-aider` | `aider` | stdin/stdout | P2 |
| `@clawcontrol/adapter-openclaw` | OpenClaw gateway | WebSocket | P0 (existing) |

### 3.4 Persistence Layer

Everything is recorded.

| Store | Contents |
|-------|----------|
| **Work Orders** | WO metadata, state, ownership |
| **Operations** | Tasks within WOs, assignments |
| **Receipts** | Execution logs (stdout, stderr, exit codes) |
| **Trajectories** | Reasoning traces (decisions, chapters, retrospectives) |
| **Artifacts** | Files created, diffs, screenshots |
| **Handoffs** | Session continuity documents |
| **Messages** | Full message history with threading |

**Tech:** SQLite + FTS5 (local-first), optional sync to cloud.

---

## 4. Key Features

### 4.1 Shadow Agents

Passive monitors that review primary agents' work.

```yaml
agents:
  Lead:
    cli: claude
    shadow:
      name: Auditor
      cli: claude
      role: reviewer
      triggers: [CODE_WRITTEN, SESSION_END]
```

Shadow receives copies of all messages, can speak when triggered.

### 4.2 Trajectories

Structured reasoning logs (inspired by Agent Relay).

```typescript
interface Trajectory {
  id: string
  task: { title: string; description: string }
  status: 'in_progress' | 'completed' | 'failed'
  chapters: Chapter[]
  retrospective?: {
    summary: string
    confidence: number
    learnings: string[]
  }
}

interface Chapter {
  title: string  // "Planning", "Implementation", "Testing"
  events: TrajectoryEvent[]
}

interface TrajectoryEvent {
  type: 'decision' | 'action' | 'observation' | 'error'
  content: string
  reasoning?: string
  significance: 'low' | 'medium' | 'high'
  timestamp: number
}
```

### 4.3 Session Continuity

When an agent session ends (or hits context limit), it writes a handoff.

```typescript
interface Handoff {
  agent: string
  timestamp: number
  summary: string
  completed: string[]
  inProgress: string[]
  blockers: string[]
  decisions: { what: string; why: string }[]
  files: string[]
  nextSteps: string[]
}
```

Next agent (or same agent, new session) loads the handoff automatically.

### 4.4 Multi-Project Bridge

Orchestrate across repositories.

```bash
clawcontrol bridge ~/auth ~/frontend ~/api
```

Agents can message cross-project: `auth:SecurityReviewer`.

### 4.5 Workflow Definitions

Declarative multi-step workflows.

```yaml
# workflows/feature-request.yaml
name: feature_request
stages:
  - name: plan
    station: plan
    agent: Planner
    requires_approval: false
    
  - name: plan_review
    station: review
    agent: PlanReviewer
    requires_approval: true
    approval_prompt: "Plan looks good?"
    
  - name: build
    station: build
    agent: Builder
    parallel: true  # Can spawn multiple
    max_agents: 3
    
  - name: build_review
    station: review
    agent: BuildReviewer
    requires_approval: true
    
  - name: security
    station: security
    agent: SecurityAuditor
    can_veto: true
    
  - name: ship
    station: plan
    agent: Lead
    auto_complete: true
```

---

## 5. What We Build vs Integrate

| Component | Build | Integrate | Notes |
|-----------|-------|-----------|-------|
| Control Plane | ✅ | | Core IP |
| Messaging Layer | ✅ | | Must own for latency |
| CLI Adapters | ✅ | | Per-CLI, ~300 lines each |
| Persistence | ✅ | | SQLite + Prisma |
| Dashboard UI | ✅ | | Next.js (existing) |
| Mac App | ✅ | | Swift (existing) |
| Agent Relay | | 🤔 | Maybe use as alt messaging |
| OpenClaw | | ✅ | One adapter among many |
| MCP | | ✅ | Tool protocol support |

---

## 6. Milestones

### Phase 1: Foundation (Current)
- [x] SQLite + Prisma schema
- [x] Work Orders, Operations, Receipts
- [x] Basic dashboard
- [x] OpenClaw adapter
- [ ] Mac app performance fix

### Phase 2: Standalone Mode
- [ ] Claude Code adapter (no OpenClaw dependency)
- [ ] Codex adapter
- [ ] Own messaging bus (WebSocket)
- [ ] Agent spawning without OpenClaw

### Phase 3: Advanced Features
- [ ] Shadow agents
- [ ] Trajectories (reasoning logs)
- [ ] Session continuity / handoffs
- [ ] Multi-project bridge

### Phase 4: Scale
- [ ] Cloud sync (optional)
- [ ] Team collaboration
- [ ] Agent marketplace / templates
- [ ] Hosted cloud version

---

## 7. Technical Decisions

### Why Not Just Use Agent Relay?

Agent Relay is excellent at messaging but lacks:
- Work order management
- Approval gates with typed confirms
- Tool policy enforcement
- Persistent operations database
- Full dashboard UI

We could use Agent Relay *as* our messaging layer, but we need everything else.

### Why SQLite?

- Local-first (works offline)
- Single file (easy backup/sync)
- FTS5 for search
- No server dependency
- Fast enough for thousands of agents

### Why Build Own Adapters?

Each CLI has quirks:
- **Claude**: Clean JSON mode, interruptible
- **Codex**: Deep focus, poor at status updates, 7+ min silences
- **Cursor**: Fast but different API
- **Gemini**: Different output format

Generic wrappers miss these nuances. Per-CLI adapters let us optimize.

---

## 8. Non-Goals (For Now)

- **Training/fine-tuning** — We orchestrate, not train
- **Model hosting** — Use existing providers
- **IDE integration** — Focus on CLI-first
- **Mobile app** — Desktop/server only

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Agent spawn latency | < 2s |
| Message delivery | < 10ms (local) |
| Work order throughput | 100+ concurrent |
| Adapter count | 5+ CLIs supported |
| Dashboard response | < 100ms |

---

## 10. The Vision

> ClawControl becomes the **Kubernetes for AI agents** — the standard way to orchestrate, govern, and observe multi-agent systems, regardless of which AI CLI or model you use.

When someone asks "how do I run 10 agents on a complex task?", the answer is ClawControl.

---

*Document version: 0.1.0*
*Last updated: 2026-02-05*
