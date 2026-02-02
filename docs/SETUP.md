# SAVORG Mission Control Setup Guide

This guide covers detailed setup instructions for both demo mode and operational mode.

---

## Prerequisites

### Required

| Tool | Version | Check Command |
|------|---------|---------------|
| Node.js | 20+ | `node -v` |
| npm | 10+ | `npm -v` |

### Optional (for Operational Mode)

| Tool | Version | Check Command |
|------|---------|---------------|
| OpenClaw | Latest | `openclaw --version` |

---

## Quick Install

```bash
# Clone repository
git clone https://github.com/your-org/savorgos.git
cd savorgos

# Install dependencies
npm install

# Copy environment file
cp apps/mission-control/.env.example apps/mission-control/.env

# Initialize database
npm run db:migrate

# Start development server
npm run dev
```

---

## Step-by-Step Setup

### 1. Install Node.js

We recommend using [nvm](https://github.com/nvm-sh/nvm) for Node version management:

```bash
# Install nvm (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload shell
source ~/.bashrc  # or ~/.zshrc

# Install and use correct Node version
cd savorgos
nvm install
nvm use
```

This reads the `.nvmrc` file and installs Node 20.

### 2. Install Dependencies

```bash
npm install
```

This installs dependencies for:
- Root workspace
- `apps/mission-control` (Next.js dashboard)
- `packages/core` (shared types and mocks)
- `packages/ui` (shared components)
- `packages/adapters-openclaw` (CLI adapter)

### 3. Configure Environment

```bash
# Copy the example environment file
cp apps/mission-control/.env.example apps/mission-control/.env
```

Edit `.env` if you need to customize:

```bash
# Required: Database location
DATABASE_URL="file:../data/mission-control.db"

# Optional: Force mock mode
# USE_MOCK_DATA="true"
```

### 4. Initialize Database

```bash
# Run migrations
npm run db:migrate
```

This creates the SQLite database at `data/mission-control.db` with:
- Work orders table
- Agents table
- Activities table (audit log)
- Receipts table (command logs)
- Approvals table (pending gates)

### 5. Seed Demo Data (Optional)

```bash
npm run db:seed
```

Populates the database with:
- Sample work orders at various stages
- Example agents
- Historical activities

### 6. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Operational Mode Setup

To connect to a real OpenClaw installation:

### 1. Install OpenClaw

Follow the [OpenClaw installation guide](https://github.com/openclaw/openclaw).

### 2. Verify Installation

```bash
# Should return a path
which openclaw

# Should show version
openclaw --version
```

### 3. Configure Workspace

Mission Control expects OpenClaw workspace structure at your current directory:

```
your-project/
├── .openclaw/
│   └── config.yaml
├── agents/
│   ├── AGENTS.md
│   └── *.soul.md
├── overlays/
│   └── *.md
├── skills/
│   └── *.md
└── playbooks/
    └── *.md
```

### 4. Start Mission Control

```bash
cd your-project
npm run dev --prefix /path/to/savorgos/apps/mission-control
```

Or symlink the Mission Control into your project for convenience.

---

## Database Management

### View Database (Prisma Studio)

```bash
npm run db:studio
```

Opens a web UI at [http://localhost:5555](http://localhost:5555).

### Reset Database

```bash
npm run db:reset
```

**Warning:** This deletes all data and re-runs migrations.

### Create New Migration

```bash
cd apps/mission-control
npx prisma migrate dev --name your_migration_name
```

---

## Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type checking |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:push` | Push schema without migration history |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |

---

## Troubleshooting

### Port 3000 Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

### Database Locked Error

SQLite uses file-level locking. Ensure only one process accesses the database:

1. Close Prisma Studio
2. Stop any other `npm run dev` instances
3. Retry

### OpenClaw Not Detected

Mission Control checks `which openclaw` on startup. Ensure:

1. OpenClaw is installed
2. OpenClaw binary is on your PATH
3. Restart the development server after installing

### Type Errors After Pulling

```bash
# Clean and rebuild
npm run clean
npm install
npm run typecheck
```

---

## Next Steps

- [OpenClaw Integration](./OPENCLAW_INTEGRATION.md) - Deep dive into OpenClaw connection
- [Security Model](./SECURITY.md) - Understanding Governor and approval gates
- [Path Policy](./PATH_POLICY.md) - Workspace file safety rules
