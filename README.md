# SAVORG Mission Control

Mission Control for [OpenClaw](https://github.com/openclaw/openclaw): a multi-agent operating system with governance, live monitoring, receipts, and approval gates.

**Status:** Alpha (v0.1.0) — suitable for local development and experimentation.

---

## What It Is

SAVORG Mission Control is a local-first ops console for orchestrating AI agents. It provides:

- **Work Orders** — Track feature work through spec → build → QA → ship stations
- **Agent Management** — Configure, monitor, and control AI agents via souls and overlays
- **Approval Gates** — Governor-enforced typed confirmation for dangerous actions
- **Live View** — Real-time streaming of agent activities and command receipts
- **Workspace** — Browse and edit agent files (souls, overlays, skills, playbooks)
- **Plugins & Skills** — Install and manage agent capabilities
- **Templates** — Create agents from validated templates with parameterized rendering

---

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 20+ | See `.nvmrc` |
| **npm** | 10+ | Included with Node 20 |
| **OS** | macOS | Linux likely works (untested) |
| **OpenClaw** | Latest | Must be on PATH for operational mode |

### Checking Prerequisites

```bash
# Node version
node -v  # Should be v20.x or higher

# OpenClaw (optional for demo mode)
which openclaw  # Should return a path
openclaw --version
```

---

## Quickstart

```bash
# 1. Clone and install
git clone https://github.com/your-org/savorgos.git
cd savorgos
npm install

# 2. Configure environment
cp apps/mission-control/.env.example apps/mission-control/.env

# 3. Initialize database
npm run db:migrate

# 4. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Demo Mode vs Operational Mode

Mission Control supports two modes:

### Demo Mode (Default)

When OpenClaw is not installed or not on PATH, Mission Control runs with:

- **Mock data** — Pre-populated work orders, agents, activities
- **Simulated execution** — Commands return mock results
- **Full UI exploration** — All features accessible for evaluation

This is ideal for:
- Evaluating the UI and workflow
- Development without OpenClaw dependency
- Learning the system before production use

### Operational Mode

When OpenClaw is detected on PATH, Mission Control:

- **Executes real commands** — `openclaw run`, `openclaw speak`, etc.
- **Reads real workspace** — Agent souls, overlays, skills from disk
- **Persists state** — SQLite database with WAL mode
- **Enforces governance** — Governor policies gate dangerous actions

To enable operational mode:
1. Install OpenClaw following their [setup guide](https://github.com/openclaw/openclaw)
2. Ensure `openclaw` is on your PATH
3. Restart Mission Control

---

## Key URLs

| URL | Description |
|-----|-------------|
| [localhost:3000](http://localhost:3000) | Dashboard home |
| [localhost:3000/now](http://localhost:3000/now) | Live activity stream |
| [localhost:3000/work-orders](http://localhost:3000/work-orders) | Work order management |
| [localhost:3000/agents](http://localhost:3000/agents) | Agent configuration |
| [localhost:3000/agent-templates](http://localhost:3000/agent-templates) | Agent templates |
| [localhost:3000/approvals](http://localhost:3000/approvals) | Pending approval gates |
| [localhost:3000/workspace](http://localhost:3000/workspace) | File browser |
| [localhost:3000/settings](http://localhost:3000/settings) | System configuration |

---

## Security Model

Mission Control is designed for **local-first, single-user** operation. Key security properties:

### Governor System

All dangerous actions require **typed confirmation**:

```
Action: plugin.install
Policy: CONFIRM
Prompt: "Type 'CONFIRM' to install plugin"
```

Actions are categorized by risk level:
- **ALLOW** — Safe read operations (no confirmation)
- **CONFIRM** — Type "CONFIRM" to proceed
- **WO_CODE** — Type the work order code to proceed
- **DENY** — Blocked entirely

### Path Safety

Workspace file operations enforce:
- No path traversal (`..` rejected)
- No backslashes or null bytes
- Allowlist: `agents`, `overlays`, `skills`, `playbooks`, `plugins`

### Command Allowlist

OpenClaw execution is limited to 24 pre-defined commands:
- No arbitrary shell execution
- `spawn()` used with array arguments (no shell interpolation)

### Audit Trail

All significant actions are logged to the activity feed with:
- Timestamp, actor, action type
- Entity references
- Payload details

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model.

---

## Update Strategy

### Checking for Updates

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

### Applying Updates

```bash
# 1. Pull latest code
git pull origin main

# 2. Install any new dependencies
npm install

# 3. Run database migrations
npm run db:migrate

# 4. Restart the server
npm run dev
```

### Breaking Changes

Major version bumps may include:
- Database schema changes (migrations provided)
- Configuration format changes (documented in CHANGELOG)
- API changes (rare in alpha)

Always read the [CHANGELOG](CHANGELOG.md) before updating.

---

## Project Structure

```
savorgos/
├── apps/
│   └── mission-control/     # Next.js dashboard
│       ├── app/             # App router pages
│       ├── components/      # React components
│       ├── lib/             # Server utilities
│       └── prisma/          # Database schema
├── packages/
│   ├── core/                # Shared types, Governor, mock data
│   ├── ui/                  # Shared UI components
│   └── adapters-openclaw/   # OpenClaw CLI adapter
├── docs/                    # Documentation
└── data/                    # SQLite database (gitignored)
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:push` | Push schema without migration |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed demo data |

---

## License

See [LICENSE](LICENSE) for details.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/savorgos/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-org/savorgos/discussions)
