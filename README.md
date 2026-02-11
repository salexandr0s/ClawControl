<p align="center">
  <img src="assets/logo-icon.png" alt="ClawControl" width="120" />
</p>

<h1 align="center">ClawControl</h1>
<p align="center"><strong>Local-first mission control for OpenClaw agent operations.</strong></p>

ClawControl is a dashboard + orchestration layer for running governed multi-agent workflows on top of OpenClaw.

## What It Does

- Runs work through a **single workflow engine**: `work-order -> workflow -> stage -> operation -> completion`.
- Enforces governance gates (approvals, risk controls, typed confirmations).
- Streams real-time system and run activity.
- Manages agents, templates, skills, plugins, and workspace files from one UI.

https://github.com/user-attachments/assets/36603984-969c-4942-9201-5afbcf792e2b

## Architecture Snapshot

- **apps/clawcontrol**: Next.js app (UI + API)
- **apps/clawcontrol-desktop**: Electron wrapper for local desktop distribution
- **packages/core**: shared types and governance primitives
- **packages/adapters-openclaw**: OpenClaw CLI/gateway adapters
- **packages/ui**: shared UI components

## Installation

### Option A: Download Desktop Release (recommended)

1. Go to [Releases](https://github.com/salexandr0s/ClawControl/releases)
2. Download the latest macOS artifact (`.dmg` or `.zip`)
3. Install and launch ClawControl

Note: unsigned builds may require right-click -> Open on first launch.

### Option B: Run From Source (web)

```bash
git clone https://github.com/salexandr0s/ClawControl.git
cd ClawControl
npm install
npm run db:migrate
npm run dev
```

Then open `http://127.0.0.1:3000`.

### Option C: Run Desktop Wrapper From Source

```bash
git clone https://github.com/salexandr0s/ClawControl.git
cd ClawControl
npm install
npm run build --workspace=clawcontrol
npm run dev --workspace=clawcontrol-desktop
```

## Requirements

- Node.js `20+`
- npm `10+`
- OpenClaw CLI installed and discoverable (`openclaw` on `PATH`, or `OPENCLAW_BIN` set)

## Dependency Model (important)

ClawControl surfaces two separate runtime layers:

1. **Gateway reachability** (HTTP/WebSocket)
2. **CLI availability** (OpenClaw CLI)

Some features are CLI-backed (Models, Plugins, Cron, Maintenance actions). If CLI is unavailable, these features degrade with explicit errors and fix hints.

## Common Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run monorepo dev mode |
| `npm run build` | Build all packages/apps |
| `npm run test` | Run test suite |
| `npm run lint` | Lint repository |
| `npm run typecheck` | Type-check repository |
| `npm run db:migrate` | Apply Prisma migrations for `clawcontrol` |
| `./start.sh --web` | Start local web runtime |
| `./start.sh --desktop` | Start desktop mode |
| `./stop.sh` | Stop local processes |

## Documentation

- Product/API docs (Mintlify): `mintlify/`
- Agent template guide: [docs/agent-templates.md](docs/agent-templates.md)
- Agent starter contract: [docs/AGENT_STARTER_TEMPLATE.md](docs/AGENT_STARTER_TEMPLATE.md)
- Remote tunnel access: [docs/REMOTE_TAILSCALE.md](docs/REMOTE_TAILSCALE.md)
- Local-only administration: [docs/local-only-admin.md](docs/local-only-admin.md)

## Security and Operations

- Local-first networking (loopback-first by default)
- Workspace path safety checks and allowlist controls
- Protected actions require typed confirmation based on policy
- Audit/activity trail for operational actions

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
