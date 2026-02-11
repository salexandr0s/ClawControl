<p align="center">
  <img src="assets/logo-icon.png" alt="ClawControl" width="120">
</p>

<h1 align="center">ClawControl</h1>

<p align="center"><strong>Local-first ops console for AI agent orchestration.</strong></p>

Built on [OpenClaw](https://github.com/openclaw/openclaw). Track work orders, govern dangerous actions, stream agent activity in real-time.

---

## Quick Start

### Option A: Web Only (Simplest)
```bash
git clone https://github.com/salexandr0s/clawcontrol.git
cd clawcontrol
./setup.sh
npm run dev
# → http://localhost:3000
```

### Option B: Desktop App (Electron) + Backend
```bash
git clone https://github.com/salexandr0s/clawcontrol.git
cd clawcontrol
npm install
cp apps/clawcontrol/.env.example apps/clawcontrol/.env
npm run db:migrate
npm run build --workspace=clawcontrol
./start.sh --desktop  # Starts backend + desktop app
```

### Option C: Download Release
1. Download the macOS desktop app artifact from [Releases](https://github.com/salexandr0s/clawcontrol/releases)
2. Install it (DMG/ZIP instructions vary by artifact)
3. Launch ClawControl (first time: right-click → Open to bypass Gatekeeper)

> **Note**: The desktop app auto-starts a local backend bound to `127.0.0.1:3000`.
> For remote control, use tunnel-only access. See [docs/REMOTE_TAILSCALE.md](docs/REMOTE_TAILSCALE.md).

---

## Why clawcontrol

| Problem | Solution |
|---------|----------|
| AI agents run commands without oversight | **Governor** — typed confirmation for dangerous actions |
| No visibility into what agents are doing | **Live View** — real-time activity stream + receipt tailing |
| Features ship without tracking | **Work Orders** — spec → build → QA → ship pipeline |
| Agent state scattered across files | **Workspace** — browse/edit souls, overlays, skills, playbooks |
| Plugins change behavior silently | **Capability Probing** — UI shows what OpenClaw actually supports |

---

## Features

- **Work Orders** — Workflow-only execution with deterministic stage progression
- **Governor** — Policy-enforced approval gates (ALLOW / CONFIRM / WO_CODE / DENY)
- **Live View** — Streaming timeline, visualizer, receipt tail
- **Agents** — Soul files, overlays, capabilities, WIP limits
- **Templates** — Parameterized agent creation with validation
- **Skills** — Filesystem-backed, global or agent-scoped
- **Plugins** — OpenClaw-authoritative with capability probing
- **Maintenance** — Health checks, doctor, recovery workflows
- **Audit Trail** — Every action logged with receipts

---

## Execution Model

ClawControl runs a single execution mode for work delivery:

- `work-order -> workflow -> stage -> operation -> completion -> next stage`
- Work order start is only via `POST /api/work-orders/:id/start`
- Workflow definitions are loaded from YAML and selected deterministically
- Manual operation graph/status mutation is blocked by API guards

Canonical station names for workflows/agents: [docs/STATIONS.md](docs/STATIONS.md)

---

## Workflow Example

https://github.com/user-attachments/assets/d489ee35-f4a6-4008-b2bb-be171fcde541

---


## OpenClaw Connection

ClawControl is designed to show **only real data**.

There are two dependency layers:

1. **Gateway reachability (HTTP/WebSocket)** — used for gateway health/status.
2. **OpenClaw CLI availability** — required for CLI-backed features.

This means gateway can be reachable while CLI-backed screens are unavailable. Settings now shows both statuses separately (`Gateway` and `CLI`).

CLI-backed features in this release:

- Maintenance actions (`/maintenance`)
- Models (`/models`)
- Plugins (`/plugins`)
- Cron control (`/cron`)
- Runtime capability probing (`/api/openclaw/capabilities`)

When CLI-dependent APIs fail, responses include machine-readable error metadata:

- `code`: `CLI_UNAVAILABLE`, `CLI_JSON_PARSE_FAILED`, or `OPENCLAW_COMMAND_FAILED`
- `fixHint`: operator guidance when available

First launch/workspace changes now auto-bootstrap required workspace structure (`agents/`, `skills/`, `agent-templates/`, `memory/`, `docs/`, `playbooks/`, plus `AGENTS.md`).

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | 20+ |
| npm | 10+ |
| OpenClaw | 0.1.0+ (recommended for full functionality) |

```bash
node -v          # v20.x+
openclaw --version  # 0.1.0+ (recommended)
```

---

## Key Pages

| URL | Purpose |
|-----|---------|
| `/` | Redirects to `/dashboard` |
| `/dashboard` | Dashboard overview |
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

clawcontrol is designed for **local-first, single-user** operation.

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
- No backslashes or null bytes in workspace paths
- Symlink escape checks via resolved real paths
- Optional strict root allowlist mode via `CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY=1`

### Command Allowlist

OpenClaw execution limited to pre-defined commands. No arbitrary shell. Uses `spawn()` with array args.

### Audit Trail

All actions logged with timestamp, actor, entity, payload, receipt ID.

See [docs/SECURITY.md](docs/SECURITY.md) for full threat model.

### Local-only Networking

- ClawControl stays bound to loopback only (`127.0.0.1` / `::1`)
- Never expose ClawControl via `0.0.0.0`, reverse proxies, or `tailscale serve`
- Remote access is supported only via user-initiated SSH tunnel (including over Tailscale)

---

## Project Structure

```
clawcontrol/
├── start.sh                    # Launcher script (backend + desktop)
├── stop.sh                     # Stop all processes
├── apps/
│   ├── clawcontrol/            # Next.js app (UI + API)
│   │   ├── app/                # Pages + API routes
│   │   ├── lib/                # Repos, adapters, utilities
│   │   ├── prisma/             # Database schema + migrations
│   │   └── data/               # SQLite (gitignored)
│   └── clawcontrol-desktop/    # Electron desktop wrapper
├── packages/
│   ├── core/                   # Types, Governor
│   ├── ui/                     # Shared components
│   └── adapters-openclaw/      # CLI adapter
├── docs/                       # Documentation
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `./start.sh` | Start backend + desktop app (Electron) |
| `./start.sh --desktop` | Start backend + desktop app (Electron) |
| `./start.sh --web` | Start backend only (use browser) |
| `./stop.sh` | Stop all clawcontrol processes |
| `npm run dev` | Development server (hot reload) |
| `npm run build` | Production build |
| `npm run start --workspace=clawcontrol` | Production server |
| `npm run init:agents -- --prefix <org>` | Generate full starter agent markdown + config templates |
| `npm run check:agent-docs` | Validate required global/agent markdown contracts |
| `npm run test` | Run Vitest tests |
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
- [Remote Access (Tailscale Tunnel)](docs/REMOTE_TAILSCALE.md)
- [Path Policy](docs/PATH_POLICY.md)
- [Agent Starter Template](docs/AGENT_STARTER_TEMPLATE.md)
