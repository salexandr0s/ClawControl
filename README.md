# ClawHub

**Local-first ops console for AI agent orchestration.**

Built on [OpenClaw](https://github.com/openclaw/openclaw). Track work orders, govern dangerous actions, stream agent activity in real-time.

---

## Quick Start

### Option A: Web Only (Simplest)
```bash
git clone https://github.com/salexandr0s/savORG.git
cd savorg
npm install && npm run db:migrate && npm run dev
# → http://localhost:3000
```

### Option B: Mac App + Backend
```bash
git clone https://github.com/salexandr0s/savORG.git
cd savorg
npm install && npm run db:migrate
./start.sh --build    # Builds Mac app and starts everything
```

### Option C: Download Release
1. Download `MissionControl-vX.X.X-macos.zip` from [Releases](../../releases)
2. Extract and move `MissionControl.app` to Applications
3. Start the backend:
   ```bash
   git clone https://github.com/salexandr0s/savORG.git
   cd savorg && npm install && npm run db:migrate && npm run start
   ```
4. Open MissionControl.app (first time: right-click → Open)

> **Note**: The Mac app is a native wrapper that connects to the backend at `localhost:3000`. The backend must be running for the app to work.

---

## Why Mission Control

| Problem | Solution |
|---------|----------|
| AI agents run commands without oversight | **Governor** — typed confirmation for dangerous actions |
| No visibility into what agents are doing | **Live View** — real-time activity stream + receipt tailing |
| Features ship without tracking | **Work Orders** — spec → build → QA → ship pipeline |
| Agent state scattered across files | **Workspace** — browse/edit souls, overlays, skills, playbooks |
| Plugins change behavior silently | **Capability Probing** — UI shows what OpenClaw actually supports |

---

## Features

- **Work Orders** — Kanban board + table view for feature tracking
- **Governor** — Policy-enforced approval gates (ALLOW / CONFIRM / WO_CODE / DENY)
- **Live View** — Streaming timeline, visualizer, receipt tail
- **Agents** — Soul files, overlays, capabilities, WIP limits
- **Templates** — Parameterized agent creation with validation
- **Skills** — Filesystem-backed, global or agent-scoped
- **Plugins** — OpenClaw-authoritative with capability probing
- **Maintenance** — Health checks, doctor, recovery workflows
- **Audit Trail** — Every action logged with receipts

---

## Demo Mode vs Operational Mode

| Mode | When | Behavior |
|------|------|----------|
| **Demo** | OpenClaw not on PATH | Mock data, simulated execution, full UI |
| **Operational** | OpenClaw detected | Real commands, real workspace, real governance |

Demo mode is automatic — no configuration needed to explore.

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 20+ |
| npm | 10+ |
| OpenClaw | 0.1.0+ (optional for demo) |

```bash
node -v          # v20.x+
openclaw --version  # 0.1.0+ (for operational mode)
```

---

## Key Pages

| URL | Purpose |
|-----|---------|
| `/` | Dashboard overview |
| `/now` | Live activity stream |
| `/live` | Timeline + visualizer + receipts |
| `/work-orders` | Work order table + Kanban |
| `/agents` | Agent configuration |
| `/agent-templates` | Template management |
| `/skills` | Skill browser |
| `/plugins` | Plugin management |
| `/approvals` | Pending approval gates |
| `/workspace` | File browser |
| `/maintenance` | Health + recovery |

---

## Security

Mission Control is designed for **local-first, single-user** operation.

### Governor System

Dangerous actions require typed confirmation:

```
Action: plugin.install
Policy: CONFIRM
→ Type "CONFIRM" to proceed
```

Risk levels: **ALLOW** (auto) → **CONFIRM** → **WO_CODE** → **DENY** (blocked)

### Path Safety

- No path traversal (`..` rejected)
- Allowlist: `agents/`, `overlays/`, `skills/`, `playbooks/`, `plugins/`

### Command Allowlist

OpenClaw execution limited to pre-defined commands. No arbitrary shell. Uses `spawn()` with array args.

### Audit Trail

All actions logged with timestamp, actor, entity, payload, receipt ID.

See [docs/SECURITY.md](docs/SECURITY.md) for full threat model.

---

## Project Structure

```
savorg/
├── start.sh                    # Launcher script (backend + Mac app)
├── stop.sh                     # Stop all processes
├── apps/
│   ├── mission-control/        # Next.js dashboard
│   │   ├── app/                # Pages + API routes
│   │   ├── lib/                # Repos, adapters, utilities
│   │   └── prisma/             # Database schema
│   └── mission-control-mac/    # Native macOS app wrapper
├── packages/
│   ├── core/                   # Types, Governor, mocks
│   ├── ui/                     # Shared components
│   └── adapters-openclaw/      # CLI adapter
├── docs/                       # Documentation
└── data/                       # SQLite (gitignored)
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `./start.sh` | Start backend + Mac app (app must be built) |
| `./start.sh --build` | Build Mac app, then start everything |
| `./start.sh --web` | Start backend only (use browser) |
| `./stop.sh` | Stop all Mission Control processes |
| `npm run dev` | Development server (hot reload) |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:studio` | Open Prisma Studio |

---

## Updating

```bash
git pull origin main
npm install
npm run db:migrate
npm run dev
```

---

## License

See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Links

- [OpenClaw Integration](docs/OPENCLAW_INTEGRATION.md)
- [Security Model](docs/SECURITY.md)
- [Path Policy](docs/PATH_POLICY.md)
