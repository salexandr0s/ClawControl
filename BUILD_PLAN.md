# Mission Control Build Plan

**Project**: SavorgOS Mission Control
**Type**: Local-first multi-agent orchestration platform
**Runtime**: OpenClaw (external dependency)
**Stack**: Next.js 14 (App Router) + TypeScript + SQLite + Prisma + Tailwind + shadcn/ui

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Repository Structure](#repository-structure)
3. [Phase 0: Scaffold + Canonical UI](#phase-0-scaffold--canonical-ui)
4. [Phase 1: SQLite + Prisma + FTS5](#phase-1-sqlite--prisma--fts5)
5. [Phase 2: Work Orders + Operations](#phase-2-work-orders--operations)
6. [Phase 3: Activities + Live + Receipts](#phase-3-activities--live--receipts)
7. [Phase 4: Approvals + Typed Confirm](#phase-4-approvals--typed-confirm)
8. [Phase 5: Editors + Schema Validation](#phase-5-editors--schema-validation)
9. [Phase 6: Skills Manager](#phase-6-skills-manager)
10. [Phase 7: Plugins Manager](#phase-7-plugins-manager)
11. [Phase 8: OpenClaw Adapters + Gateway Console](#phase-8-openclaw-adapters--gateway-console)
12. [Phase 9: Create Agent Workflow](#phase-9-create-agent-workflow)
13. [Definition of Done Checklists](#definition-of-done-checklists)
14. [Testing Strategy](#testing-strategy)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mission Control                          │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App (UI + API Routes)                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   /now      │  │ /work-orders│  │  /agents    │  ...        │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  API Layer (/app/api/*)                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Services   │  │   Repos     │  │  SSE Stream │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ┌─────────────────────────────────────────────────┐           │
│  │  SQLite (WAL) + Prisma + FTS5                   │           │
│  │  data/mission-control/mission-control.sqlite    │           │
│  └─────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────┤
│  OpenClaw Adapter (packages/adapters-openclaw)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   Mock   │  │Local CLI │  │  HTTP    │  │    WS    │       │
│  │  (dev)   │  │(default) │  │(optional)│  │(optional)│       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   OpenClaw (Local Machine)    │
              │   openclaw CLI available      │
              └───────────────────────────────┘
```

### Key Principles

1. **Single mouthpiece**: Only savorgCEO communicates with users
2. **Local-first truth**: SQLite is the shared brain
3. **Silent success**: No noise unless actionable
4. **Side-effect gating**: External actions require Approvals
5. **Receipts everywhere**: Every action produces a receipt
6. **Safety by allowlist**: Only allowlisted command templates can run

---

## Repository Structure

```
savorgOS/
├── apps/
│   └── mission-control/          # Next.js 14 App Router
│       ├── app/
│       │   ├── (dashboard)/      # Route group for main UI
│       │   │   ├── now/
│       │   │   ├── work-orders/
│       │   │   ├── agents/
│       │   │   ├── cron/
│       │   │   ├── workspace/
│       │   │   ├── runs/
│       │   │   ├── maintenance/
│       │   │   ├── live/
│       │   │   ├── skills/
│       │   │   ├── plugins/
│       │   │   └── settings/
│       │   ├── api/              # API routes
│       │   │   ├── now/
│       │   │   ├── work-orders/
│       │   │   ├── operations/
│       │   │   ├── agents/
│       │   │   ├── receipts/
│       │   │   ├── approvals/
│       │   │   ├── activities/
│       │   │   ├── search/
│       │   │   ├── stream/       # SSE endpoints
│       │   │   └── openclaw/     # OpenClaw proxy endpoints
│       │   ├── layout.tsx
│       │   ├── globals.css
│       │   └── providers.tsx
│       ├── components/
│       │   ├── shell/            # AppShell, RailNav, TopBar
│       │   ├── data-display/     # StatusPill, Tables, Cards
│       │   ├── interactions/     # Drawer, Tabs, Dialogs
│       │   ├── ops/              # CommandButton, PlaybookRunner
│       │   ├── forms/            # FormField, inputs
│       │   └── editors/          # Markdown, JSON/YAML editors
│       ├── lib/
│       │   ├── db/               # Prisma client, repos
│       │   ├── services/         # Business logic
│       │   ├── state-machine/    # WO/Op transitions
│       │   └── utils/
│       ├── hooks/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       └── public/
│
├── packages/
│   ├── core/                     # Shared domain types, validation
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── schemas/          # Zod schemas
│   │   │   ├── state-machines/
│   │   │   └── invariants/
│   │   └── package.json
│   │
│   ├── ui/                       # Canonical UI components
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── theme/
│   │   │   └── hooks/
│   │   └── package.json
│   │
│   └── adapters-openclaw/        # OpenClaw adapter
│       ├── src/
│       │   ├── index.ts
│       │   ├── types.ts
│       │   ├── mock.ts
│       │   ├── http.ts
│       │   ├── ws.ts
│       │   └── ssh-cli.ts
│       └── package.json
│
├── schemas/                      # JSON Schemas
│   ├── command-template.schema.json
│   ├── playbook.schema.json
│   ├── branch-rules.schema.json
│   └── branch-target.schema.json
│
├── playbooks/                    # Default playbooks
│   ├── gateway-recover.json
│   └── plugin-change-safe.json
│
├── data/                         # SQLite + backups (gitignored)
│   └── mission-control/
│       ├── mission-control.sqlite
│       └── backups/
│
├── agents/                       # Agent overlays
│   └── (created at runtime)
│
├── docs/
│   └── compounds/                # Compounding station outputs
│
├── AGENTS.md                     # Global invariants
├── BUILD_PLAN.md                 # This file
├── package.json                  # Monorepo root
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.json
```

---

## Phase 0: Scaffold + Canonical UI

**Goal**: Boot the Next.js app with ops-dark theme, all route shells, and canonical components with mock data.

**PRs**: 3-4 small PRs

---

### PR 0.1: Monorepo Bootstrap

**Files to create**:

```
savorgOS/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json
├── .gitignore
├── .nvmrc
├── apps/
│   └── mission-control/
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.js
│       ├── tailwind.config.ts
│       ├── postcss.config.js
│       └── app/
│           ├── layout.tsx
│           ├── globals.css
│           └── page.tsx
└── packages/
    ├── core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts
    ├── ui/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts
    └── adapters-openclaw/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts
```

**package.json (root)**:
```json
{
  "name": "savorgos",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "db:migrate": "pnpm --filter mission-control db:migrate",
    "db:seed": "pnpm --filter mission-control db:seed"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Acceptance Criteria**:
- [ ] `pnpm install` succeeds
- [ ] `pnpm dev` starts Next.js on localhost:3000
- [ ] Monorepo structure with turbo pipelines working
- [ ] TypeScript strict mode enabled

---

### PR 0.2: Design System + Theme Tokens

**Files to create/modify**:

```
apps/mission-control/
├── app/globals.css              # CSS variables for theme
├── tailwind.config.ts           # Extended with design tokens
└── lib/
    └── utils.ts                 # cn() helper
```

**globals.css** (canonical tokens from spec):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Backgrounds */
    --bg0: #0B0F14;
    --bg1: #101723;
    --bg2: #121B2A;
    --bg3: #172235;

    /* Text */
    --fg0: #E7EEF8;
    --fg1: #A9B6C8;
    --fg2: #7F8EA3;
    --fg3: #5A6A80;

    /* Borders */
    --bd0: rgba(255, 255, 255, 0.08);
    --bd1: rgba(255, 255, 255, 0.14);

    /* Status semantics */
    --success: #2ECC71;
    --warning: #F2C94C;
    --danger: #EB5757;
    --info: #56CCF2;
    --progress: #6C8CFF;
    --idle: #7F8EA3;

    /* Spacing */
    --spacing-unit: 8px;
  }

  /* Ops Dim preset */
  .theme-dim {
    --fg0: #C8D0DC;
    --fg1: #8A9AAD;
    --bd0: rgba(255, 255, 255, 0.06);
  }
}

body {
  background-color: var(--bg0);
  color: var(--fg0);
  font-family: 'Geist', system-ui, sans-serif;
}
```

**tailwind.config.ts**:
```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: 'var(--bg0)',
          1: 'var(--bg1)',
          2: 'var(--bg2)',
          3: 'var(--bg3)',
        },
        fg: {
          0: 'var(--fg0)',
          1: 'var(--fg1)',
          2: 'var(--fg2)',
          3: 'var(--fg3)',
        },
        bd: {
          0: 'var(--bd0)',
          1: 'var(--bd1)',
        },
        status: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
          progress: 'var(--progress)',
          idle: 'var(--idle)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      fontSize: {
        'page-title': ['20px', { lineHeight: '1.2', fontWeight: '600' }],
        'section-title': ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        'body': ['13px', { lineHeight: '1.4', fontWeight: '450' }],
        'caption': ['12px', { lineHeight: '1.35', fontWeight: '450' }],
        'mono-sm': ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        'mono-md': ['13px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        'card': '12px',
        'input': '10px',
        'pill': '999px',
      },
      spacing: {
        'unit': '8px',
        'panel': '12px',
        'card': '12px',
        'page': '16px',
      },
    },
  },
  plugins: [],
}

export default config
```

**Acceptance Criteria**:
- [ ] Theme tokens applied globally
- [ ] Dark theme visible on page load
- [ ] Geist fonts loading (via next/font or CDN)
- [ ] Density presets switchable via class

---

### PR 0.3: Shell Components (AppShell, RailNav, TopBar)

**Files to create**:

```
apps/mission-control/
├── app/
│   ├── layout.tsx               # Root layout with AppShell
│   └── (dashboard)/
│       └── layout.tsx           # Dashboard layout
└── components/
    └── shell/
        ├── app-shell.tsx
        ├── rail-nav.tsx
        ├── top-bar.tsx
        ├── status-chip-strip.tsx
        ├── drawer.tsx
        └── index.ts
```

**app-shell.tsx** (canonical):
```typescript
'use client'

import { ReactNode, useState } from 'react'
import { RailNav } from './rail-nav'
import { TopBar } from './top-bar'
import { Drawer } from './drawer'

interface AppShellProps {
  children: ReactNode
  rightDrawer?: ReactNode
  drawerTitle?: string
  onDrawerClose?: () => void
}

export function AppShell({
  children,
  rightDrawer,
  drawerTitle,
  onDrawerClose
}: AppShellProps) {
  const [railCollapsed, setRailCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-bg-0">
      {/* Left Rail */}
      <RailNav
        collapsed={railCollapsed}
        onToggle={() => setRailCollapsed(!railCollapsed)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />

        <main className="flex-1 overflow-auto p-page">
          {children}
        </main>
      </div>

      {/* Right Drawer */}
      {rightDrawer && (
        <Drawer
          title={drawerTitle}
          onClose={onDrawerClose}
        >
          {rightDrawer}
        </Drawer>
      )}
    </div>
  )
}
```

**rail-nav.tsx** (canonical nav items):
```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  Bot,
  Clock,
  FolderTree,
  TerminalSquare,
  Wrench,
  Activity,
  Sparkles,
  Puzzle,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { href: '/now', label: 'Now', icon: LayoutDashboard },
  { href: '/work-orders', label: 'Work Orders', icon: ClipboardList },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/cron', label: 'Cron', icon: Clock },
  { href: '/workspace', label: 'Workspace', icon: FolderTree },
  { href: '/runs', label: 'Runs', icon: TerminalSquare },
  { href: '/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/live', label: 'Live', icon: Activity },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/plugins', label: 'Plugins', icon: Puzzle },
]

interface RailNavProps {
  collapsed: boolean
  onToggle: () => void
}

export function RailNav({ collapsed, onToggle }: RailNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className={cn(
        "flex flex-col bg-bg-1 border-r border-bd-0 transition-all duration-200",
        collapsed ? "w-[72px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="h-11 flex items-center px-4 border-b border-bd-0">
        {!collapsed && (
          <span className="text-section-title text-fg-0">SAVORG</span>
        )}
      </div>

      {/* Nav Items */}
      <div className="flex-1 py-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2 mx-2 rounded-input transition-colors",
                isActive
                  ? "bg-bg-3 text-fg-0 border-l-2 border-status-info"
                  : "text-fg-1 hover:bg-bg-3 hover:text-fg-0"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && (
                <span className="text-body truncate">{item.label}</span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Settings + Collapse */}
      <div className="py-2 border-t border-bd-0">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-4 py-2 mx-2 rounded-input text-fg-1 hover:bg-bg-3"
        >
          <Settings className="w-4 h-4" />
          {!collapsed && <span className="text-body">Settings</span>}
        </Link>

        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-4 py-2 mx-2 rounded-input text-fg-2 hover:text-fg-1"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {!collapsed && <span className="text-caption">Collapse</span>}
        </button>
      </div>
    </nav>
  )
}
```

**status-chip-strip.tsx** (TopBar status chips):
```typescript
'use client'

import { cn } from '@/lib/utils'
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Activity,
  ShieldCheck,
  PlayCircle,
  AlertOctagon
} from 'lucide-react'

type ChipStatus = 'ok' | 'degraded' | 'down' | 'unknown'

interface StatusChip {
  id: string
  label: string
  value: string | number
  status: ChipStatus
  age?: string
  icon: React.ComponentType<{ className?: string }>
}

const statusStyles: Record<ChipStatus, string> = {
  ok: 'text-status-success',
  degraded: 'text-status-warning',
  down: 'text-status-danger',
  unknown: 'text-fg-2',
}

const statusIcons: Record<ChipStatus, React.ComponentType<{ className?: string }>> = {
  ok: CheckCircle,
  degraded: AlertTriangle,
  down: XCircle,
  unknown: AlertOctagon,
}

interface StatusChipStripProps {
  chips: StatusChip[]
  onChipClick?: (chipId: string) => void
}

export function StatusChipStrip({ chips, onChipClick }: StatusChipStripProps) {
  return (
    <div className="flex items-center gap-2">
      {chips.map((chip) => {
        const StatusIcon = statusIcons[chip.status]

        return (
          <button
            key={chip.id}
            onClick={() => onChipClick?.(chip.id)}
            className={cn(
              "flex items-center gap-2 px-2.5 py-1.5 rounded-input",
              "bg-bg-2 border border-bd-0 hover:border-bd-1 transition-colors"
            )}
          >
            <StatusIcon className={cn("w-3.5 h-3.5", statusStyles[chip.status])} />
            <span className="text-caption text-fg-1">{chip.label}</span>
            <span className="text-mono-sm font-mono text-fg-0">{chip.value}</span>
            {chip.age && (
              <span className="text-caption text-fg-2">· {chip.age}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] AppShell renders with rail nav + top bar
- [ ] Rail nav collapses/expands
- [ ] Active route highlighted
- [ ] Status chip strip renders in top bar
- [ ] Right drawer slot works

---

### PR 0.4: Route Shells + Mock Data

**Files to create**:

```
apps/mission-control/app/(dashboard)/
├── now/
│   └── page.tsx
├── work-orders/
│   ├── page.tsx
│   └── [id]/
│       └── page.tsx
├── agents/
│   └── page.tsx
├── cron/
│   └── page.tsx
├── workspace/
│   └── page.tsx
├── runs/
│   └── page.tsx
├── maintenance/
│   └── page.tsx
├── live/
│   └── page.tsx
├── skills/
│   └── page.tsx
├── plugins/
│   └── page.tsx
└── settings/
    └── page.tsx
```

Each page should render:
1. Page title
2. Placeholder content with mock data
3. Basic layout structure

**Example: now/page.tsx**:
```typescript
import { StatusPill } from '@/components/data-display/status-pill'

// Mock data for Phase 0
const mockWorkOrders = [
  { id: '1', code: 'WO-0001', title: 'Implement Live View', state: 'active', priority: 'P1' },
  { id: '2', code: 'WO-0002', title: 'Fix auth flow', state: 'blocked', priority: 'P0' },
]

const mockApprovals = [
  { id: '1', type: 'ship_gate', questionMd: 'Ready to ship WO-0001?' },
]

export default function NowPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <h1 className="text-page-title">Now</h1>

      {/* Health Strip */}
      <div className="grid grid-cols-5 gap-4">
        <HealthCard label="Gateway" status="ok" />
        <HealthCard label="Live View" status="ok" />
        <HealthCard label="Approvals" value={1} status="warning" />
        <HealthCard label="Running" value={2} status="ok" />
        <HealthCard label="Incidents" value={0} status="ok" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Active Work Orders */}
        <div className="col-span-8">
          <div className="bg-bg-2 rounded-card border border-bd-0 p-card">
            <h2 className="text-section-title mb-4">Active Work Orders</h2>
            <div className="space-y-2">
              {mockWorkOrders.map((wo) => (
                <WorkOrderRow key={wo.id} workOrder={wo} />
              ))}
            </div>
          </div>
        </div>

        {/* Pending Approvals */}
        <div className="col-span-4">
          <div className="bg-bg-2 rounded-card border border-bd-0 p-card">
            <h2 className="text-section-title mb-4">Pending Approvals</h2>
            <div className="space-y-2">
              {mockApprovals.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-bg-2 rounded-card border border-bd-0 p-card">
        <h2 className="text-section-title mb-4">Recent Activity</h2>
        <ActivityFeed />
      </div>
    </div>
  )
}

// Placeholder components (will be canonical later)
function HealthCard({ label, status, value }: { label: string; status: string; value?: number }) {
  return (
    <div className="bg-bg-2 rounded-card border border-bd-0 p-3">
      <div className="text-caption text-fg-2">{label}</div>
      <div className="text-body text-fg-0">{value ?? status}</div>
    </div>
  )
}

function WorkOrderRow({ workOrder }: { workOrder: typeof mockWorkOrders[0] }) {
  return (
    <div className="flex items-center gap-4 p-2 hover:bg-bg-3 rounded-input">
      <span className="font-mono text-mono-sm text-fg-1">{workOrder.code}</span>
      <span className="flex-1 text-body">{workOrder.title}</span>
      <StatusPill status={workOrder.state as any} />
    </div>
  )
}

function ApprovalCard({ approval }: { approval: typeof mockApprovals[0] }) {
  return (
    <div className="p-2 border-l-2 border-status-warning">
      <div className="text-caption text-fg-2">{approval.type}</div>
      <div className="text-body">{approval.questionMd}</div>
    </div>
  )
}

function ActivityFeed() {
  return (
    <div className="text-fg-2 text-body">
      Activity feed placeholder...
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] All routes render without errors
- [ ] Navigation between routes works
- [ ] Mock data displays correctly
- [ ] Responsive behavior on different screen sizes

---

## Phase 1: SQLite + Prisma + FTS5

**Goal**: Implement the complete database schema with migrations, FTS5 search, and repository layer.

**PRs**: 3-4 PRs

---

### PR 1.1: Prisma Setup + Core Schema

**Files to create**:

```
apps/mission-control/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── lib/
│   └── db/
│       ├── client.ts           # Prisma client singleton
│       ├── pragmas.ts          # SQLite pragmas
│       └── index.ts
└── package.json                # Add prisma deps
```

**schema.prisma** (complete schema from spec):
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:../../data/mission-control/mission-control.sqlite"
}

model WorkOrder {
  id              String   @id @default(cuid())
  code            String   @unique // WO-0001 format
  title           String
  goalMd          String   @map("goal_md")
  state           String   @default("planned") // planned|active|blocked|review|shipped|cancelled
  priority        String   @default("P2") // P0|P1|P2|P3
  owner           String   @default("user") // user|savorgbot
  routingTemplate String   @map("routing_template")
  blockedReason   String?  @map("blocked_reason")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  shippedAt       DateTime? @map("shipped_at")

  operations Operation[]
  messages   Message[]
  artifacts  Artifact[]
  receipts   Receipt[]
  approvals  Approval[]

  @@index([state, priority, updatedAt])
  @@index([updatedAt])
  @@map("work_orders")
}

model Operation {
  id                    String   @id @default(cuid())
  workOrderId           String   @map("work_order_id")
  station               String   // spec|build|qa|ops|update|ship|compound
  title                 String
  status                String   @default("todo") // todo|in_progress|blocked|review|done|rework
  assigneeAgentIds      String   @default("[]") @map("assignee_agent_ids") // JSON array
  dependsOnOperationIds String   @default("[]") @map("depends_on_operation_ids") // JSON array
  wipClass              String   @default("default") @map("wip_class")
  blockedReason         String?  @map("blocked_reason")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  workOrder WorkOrder  @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  messages  Message[]
  artifacts Artifact[]
  receipts  Receipt[]
  approvals Approval[]

  @@index([workOrderId, status, station, updatedAt])
  @@index([status, station, updatedAt])
  @@map("operations")
}

model Agent {
  id               String   @id @default(cuid())
  name             String   @unique // savorgBUILD format
  role             String
  station          String   // primary station
  status           String   @default("idle") // idle|active|blocked|error
  sessionKey       String   @unique @map("session_key")
  capabilitiesJson String   @default("{}") @map("capabilities_json")
  wipLimit         Int      @default(1) @map("wip_limit")
  lastSeenAt       DateTime? @map("last_seen_at")
  lastHeartbeatAt  DateTime? @map("last_heartbeat_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  messages Message[]

  @@index([station, status, lastSeenAt])
  @@map("agents")
}

model Message {
  id          String   @id @default(cuid())
  workOrderId String   @map("work_order_id")
  operationId String?  @map("operation_id")
  fromAgentId String?  @map("from_agent_id")
  bodyMd      String   @map("body_md")
  createdAt   DateTime @default(now()) @map("created_at")

  workOrder WorkOrder  @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  operation Operation? @relation(fields: [operationId], references: [id], onDelete: SetNull)
  fromAgent Agent?     @relation(fields: [fromAgentId], references: [id], onDelete: SetNull)

  @@index([workOrderId, createdAt])
  @@index([operationId, createdAt])
  @@map("messages")
}

model Artifact {
  id          String   @id @default(cuid())
  workOrderId String   @map("work_order_id")
  operationId String?  @map("operation_id")
  type        String   // pr|doc|file|link|patch|screenshot|report
  title       String
  pathOrUrl   String   @map("path_or_url")
  createdBy   String   @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")

  workOrder WorkOrder  @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  operation Operation? @relation(fields: [operationId], references: [id], onDelete: SetNull)

  @@index([workOrderId, createdAt])
  @@map("artifacts")
}

model Receipt {
  id              String   @id @default(cuid())
  workOrderId     String   @map("work_order_id")
  operationId     String?  @map("operation_id")
  kind            String   // playbook_step|cron_run|agent_run|manual
  commandName     String   @map("command_name")
  commandArgsJson String   @default("{}") @map("command_args_json")
  exitCode        Int?     @map("exit_code")
  durationMs      Int?     @map("duration_ms")
  stdoutExcerpt   String   @default("") @map("stdout_excerpt")
  stderrExcerpt   String   @default("") @map("stderr_excerpt")
  parsedJson      String?  @map("parsed_json")
  startedAt       DateTime @map("started_at")
  endedAt         DateTime? @map("ended_at")

  workOrder WorkOrder  @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  operation Operation? @relation(fields: [operationId], references: [id], onDelete: SetNull)

  @@index([workOrderId, startedAt])
  @@index([commandName, startedAt])
  @@map("receipts")
}

model Approval {
  id          String   @id @default(cuid())
  workOrderId String   @map("work_order_id")
  operationId String?  @map("operation_id")
  type        String   // ship_gate|risky_action|scope_change|cron_change|external_side_effect
  questionMd  String   @map("question_md")
  status      String   @default("pending") // pending|approved|rejected
  resolvedBy  String?  @map("resolved_by")
  createdAt   DateTime @default(now()) @map("created_at")
  resolvedAt  DateTime? @map("resolved_at")

  workOrder WorkOrder  @relation(fields: [workOrderId], references: [id], onDelete: Cascade)
  operation Operation? @relation(fields: [operationId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
  @@map("approvals")
}

model Activity {
  id          String   @id @default(cuid())
  ts          DateTime @default(now())
  type        String
  actor       String
  entityType  String   @map("entity_type")
  entityId    String   @map("entity_id")
  summary     String
  payloadJson String   @default("{}") @map("payload_json")

  @@index([ts])
  @@index([entityType, entityId, ts])
  @@map("activities")
}

model Playbook {
  id           String   @id @default(cuid())
  name         String   @unique
  description  String
  severity     String   // info|warn|critical
  allowAutoRun Boolean  @default(false) @map("allow_auto_run")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  steps PlaybookStep[]
  runs  PlaybookRun[]

  @@map("playbooks")
}

model PlaybookStep {
  id                String   @id @default(cuid())
  playbookId        String   @map("playbook_id")
  stepOrder         Int      @map("step_order")
  commandTemplateId String   @map("command_template_id")
  argsJson          String   @default("{}") @map("args_json")
  branchRulesJson   String   @default("{}") @map("branch_rules_json")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  playbook Playbook @relation(fields: [playbookId], references: [id], onDelete: Cascade)

  @@unique([playbookId, stepOrder])
  @@map("playbook_steps")
}

model PlaybookRun {
  id                 String   @id @default(cuid())
  playbookId         String   @map("playbook_id")
  workOrderId        String?  @map("work_order_id")
  status             String   @default("running") // running|paused|failed|completed
  currentStepIndex   Int      @default(0) @map("current_step_index")
  stepReceiptIdsJson String   @default("[]") @map("step_receipt_ids_json")
  startedAt          DateTime @map("started_at")
  updatedAt          DateTime @updatedAt @map("updated_at")
  endedAt            DateTime? @map("ended_at")

  playbook Playbook @relation(fields: [playbookId], references: [id], onDelete: Cascade)

  @@map("playbook_runs")
}

model CommandTemplate {
  id               String   @id @default(cuid())
  name             String   @unique
  commandJson      String   @map("command_json")
  timeoutMs        Int      @map("timeout_ms")
  requiresApproval Boolean  @default(false) @map("requires_approval")
  riskLevel        String   // safe|caution|danger
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@map("command_templates")
}

model Counter {
  name  String @id
  value Int

  @@map("counters")
}
```

**client.ts** (Prisma singleton with pragmas):
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Apply SQLite pragmas
export async function initDatabase() {
  await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
  await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys=ON;')
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;')
  await prisma.$executeRawUnsafe('PRAGMA temp_store=MEMORY;')
  await prisma.$executeRawUnsafe('PRAGMA mmap_size=268435456;')
  await prisma.$executeRawUnsafe('PRAGMA cache_size=-200000;')

  // Initialize counters if not exists
  await prisma.counter.upsert({
    where: { name: 'work_order_seq' },
    update: {},
    create: { name: 'work_order_seq', value: 0 },
  })
}
```

**Acceptance Criteria**:
- [ ] `pnpm db:migrate` creates database
- [ ] All tables created with correct constraints
- [ ] Indexes created for hot query paths
- [ ] Pragmas applied on connection
- [ ] Counter initialized

---

### PR 1.2: FTS5 Setup + Sync

**Files to create**:

```
apps/mission-control/
├── prisma/
│   └── fts5-setup.sql          # Raw SQL for FTS5 tables
├── lib/
│   └── db/
│       ├── fts.ts              # FTS5 operations
│       └── search.ts           # Search queries
└── scripts/
    └── setup-fts.ts            # Script to create FTS tables
```

**fts5-setup.sql**:
```sql
-- Work Orders FTS
CREATE VIRTUAL TABLE IF NOT EXISTS wo_fts USING fts5(
  work_order_id UNINDEXED,
  code,
  title,
  goal_md
);

-- Messages FTS
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  work_order_id UNINDEXED,
  operation_id UNINDEXED,
  body_md
);

-- Artifacts FTS
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  artifact_id UNINDEXED,
  work_order_id UNINDEXED,
  title,
  path_or_url
);
```

**fts.ts** (write-through FTS operations):
```typescript
import { prisma } from './client'

export async function indexWorkOrder(wo: {
  id: string
  code: string
  title: string
  goalMd: string
}) {
  await prisma.$executeRaw`
    INSERT INTO wo_fts(work_order_id, code, title, goal_md)
    VALUES (${wo.id}, ${wo.code}, ${wo.title}, ${wo.goalMd})
    ON CONFLICT(work_order_id) DO UPDATE SET
      code=excluded.code,
      title=excluded.title,
      goal_md=excluded.goal_md
  `
}

export async function removeWorkOrderFromIndex(id: string) {
  await prisma.$executeRaw`DELETE FROM wo_fts WHERE work_order_id = ${id}`
}

export async function indexMessage(msg: {
  id: string
  workOrderId: string
  operationId: string | null
  bodyMd: string
}) {
  await prisma.$executeRaw`
    INSERT INTO messages_fts(message_id, work_order_id, operation_id, body_md)
    VALUES (${msg.id}, ${msg.workOrderId}, ${msg.operationId}, ${msg.bodyMd})
    ON CONFLICT(message_id) DO UPDATE SET
      work_order_id=excluded.work_order_id,
      operation_id=excluded.operation_id,
      body_md=excluded.body_md
  `
}

export async function indexArtifact(art: {
  id: string
  workOrderId: string
  title: string
  pathOrUrl: string
}) {
  await prisma.$executeRaw`
    INSERT INTO artifacts_fts(artifact_id, work_order_id, title, path_or_url)
    VALUES (${art.id}, ${art.workOrderId}, ${art.title}, ${art.pathOrUrl})
    ON CONFLICT(artifact_id) DO UPDATE SET
      work_order_id=excluded.work_order_id,
      title=excluded.title,
      path_or_url=excluded.path_or_url
  `
}
```

**search.ts**:
```typescript
import { prisma } from './client'

interface SearchResult {
  type: 'work_order' | 'message' | 'artifact'
  id: string
  workOrderId: string
  snippet: string
  title?: string
  code?: string
}

export async function globalSearch(query: string, limit = 20): Promise<{
  workOrders: SearchResult[]
  messages: SearchResult[]
  artifacts: SearchResult[]
}> {
  const sanitized = query.replace(/['"]/g, '')

  const [workOrders, messages, artifacts] = await Promise.all([
    prisma.$queryRaw<SearchResult[]>`
      SELECT
        'work_order' as type,
        work_order_id as id,
        work_order_id as workOrderId,
        code,
        title,
        snippet(wo_fts, 2, '<mark>', '</mark>', '…', 10) as snippet
      FROM wo_fts
      WHERE wo_fts MATCH ${sanitized}
      ORDER BY bm25(wo_fts)
      LIMIT ${limit}
    `,
    prisma.$queryRaw<SearchResult[]>`
      SELECT
        'message' as type,
        message_id as id,
        work_order_id as workOrderId,
        snippet(messages_fts, 3, '<mark>', '</mark>', '…', 12) as snippet
      FROM messages_fts
      WHERE messages_fts MATCH ${sanitized}
      ORDER BY bm25(messages_fts)
      LIMIT ${limit}
    `,
    prisma.$queryRaw<SearchResult[]>`
      SELECT
        'artifact' as type,
        artifact_id as id,
        work_order_id as workOrderId,
        title,
        snippet(artifacts_fts, 2, '<mark>', '</mark>', '…', 10) as snippet
      FROM artifacts_fts
      WHERE artifacts_fts MATCH ${sanitized}
      ORDER BY bm25(artifacts_fts)
      LIMIT ${limit}
    `,
  ])

  return { workOrders, messages, artifacts }
}
```

**Acceptance Criteria**:
- [ ] FTS5 virtual tables created
- [ ] Write-through indexing works for WO/Message/Artifact
- [ ] Global search returns results with snippets
- [ ] Empty/invalid queries handled gracefully

---

### PR 1.3: Repository Layer

**Files to create**:

```
apps/mission-control/lib/db/repos/
├── work-orders.ts
├── operations.ts
├── agents.ts
├── messages.ts
├── artifacts.ts
├── receipts.ts
├── approvals.ts
├── activities.ts
├── playbooks.ts
├── command-templates.ts
└── index.ts
```

Each repo follows the interface from spec. Example **work-orders.ts**:

```typescript
import { prisma } from '../client'
import { indexWorkOrder, removeWorkOrderFromIndex } from '../fts'
import type { WorkOrder, Prisma } from '@prisma/client'

export type WorkOrderState = 'planned' | 'active' | 'blocked' | 'review' | 'shipped' | 'cancelled'
export type Priority = 'P0' | 'P1' | 'P2' | 'P3'

interface CreateWorkOrderInput {
  title: string
  goalMd: string
  priority: Priority
  routingTemplate: string
}

interface ListParams {
  state?: WorkOrderState[]
  priority?: Priority[]
  limit: number
  cursor?: { updatedAt: string; id: string }
}

interface Page<T> {
  items: T[]
  nextCursor: { updatedAt: string; id: string } | null
}

export const workOrdersRepo = {
  async create(input: CreateWorkOrderInput): Promise<WorkOrder> {
    return prisma.$transaction(async (tx) => {
      // Get next code
      await tx.$executeRaw`UPDATE counters SET value = value + 1 WHERE name = 'work_order_seq'`
      const [counter] = await tx.$queryRaw<[{ value: number }]>`
        SELECT value FROM counters WHERE name = 'work_order_seq'
      `
      const code = `WO-${String(counter.value).padStart(4, '0')}`

      // Create work order
      const wo = await tx.workOrder.create({
        data: {
          code,
          title: input.title,
          goalMd: input.goalMd,
          priority: input.priority,
          routingTemplate: input.routingTemplate,
          state: 'planned',
          owner: 'user',
        },
      })

      // Index for FTS
      await indexWorkOrder(wo)

      // Create activity
      await tx.activity.create({
        data: {
          type: 'WORK_ORDER_CREATED',
          actor: 'user',
          entityType: 'work_order',
          entityId: wo.id,
          summary: `Created ${wo.code}: ${wo.title}`,
          payloadJson: JSON.stringify({ code: wo.code, title: wo.title }),
        },
      })

      return wo
    })
  },

  async getById(id: string): Promise<WorkOrder | null> {
    return prisma.workOrder.findUnique({ where: { id } })
  },

  async getByCode(code: string): Promise<WorkOrder | null> {
    return prisma.workOrder.findUnique({ where: { code } })
  },

  async list(params: ListParams): Promise<Page<WorkOrder>> {
    const { state, priority, limit, cursor } = params

    const where: Prisma.WorkOrderWhereInput = {}
    if (state?.length) where.state = { in: state }
    if (priority?.length) where.priority = { in: priority }

    if (cursor) {
      where.OR = [
        { updatedAt: { lt: new Date(cursor.updatedAt) } },
        {
          updatedAt: new Date(cursor.updatedAt),
          id: { lt: cursor.id }
        },
      ]
    }

    const items = await prisma.workOrder.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = items.length > limit
    if (hasMore) items.pop()

    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem
      ? { updatedAt: lastItem.updatedAt.toISOString(), id: lastItem.id }
      : null

    return { items, nextCursor }
  },

  async setState(
    id: string,
    next: WorkOrderState,
    meta?: { blockedReason?: string }
  ): Promise<void> {
    // State machine validation happens in service layer
    await prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.update({
        where: { id },
        data: {
          state: next,
          blockedReason: meta?.blockedReason ?? null,
          shippedAt: next === 'shipped' ? new Date() : undefined,
        },
      })

      // Update FTS
      await indexWorkOrder(wo)

      // Activity
      await tx.activity.create({
        data: {
          type: 'WORK_ORDER_STATE_CHANGED',
          actor: 'user',
          entityType: 'work_order',
          entityId: wo.id,
          summary: `${wo.code} → ${next}`,
          payloadJson: JSON.stringify({ from: wo.state, to: next }),
        },
      })
    })
  },
}
```

**Acceptance Criteria**:
- [ ] All repos implement interface from spec
- [ ] Transactions used for multi-table writes
- [ ] Activities emitted on all writes
- [ ] FTS updated on write
- [ ] Keyset pagination working

---

### PR 1.4: Seed Script + Test Fixtures

**Files to create**:

```
apps/mission-control/
├── scripts/
│   └── seed.ts
└── lib/
    └── db/
        └── fixtures.ts
```

**seed.ts** (deterministic seed with realistic data):
```typescript
import { prisma, initDatabase } from '../lib/db/client'
import { workOrdersRepo } from '../lib/db/repos/work-orders'
import { operationsRepo } from '../lib/db/repos/operations'
import { agentsRepo } from '../lib/db/repos/agents'
import { activitiesRepo } from '../lib/db/repos/activities'

const ROUTING_TEMPLATES = {
  software_feature: ['spec', 'build', 'qa', 'ship', 'compound'],
  bugfix: ['build', 'qa', 'ship', 'compound'],
  maintenance: ['ops', 'compound'],
}

const AGENTS = [
  { name: 'savorgBUILD', role: 'builder', station: 'build' },
  { name: 'savorgQA', role: 'reviewer', station: 'qa' },
  { name: 'savorgOPS', role: 'operator', station: 'ops' },
  { name: 'savorgSPEC', role: 'specifier', station: 'spec' },
  { name: 'savorgUPDATE', role: 'updater', station: 'update' },
]

async function seed() {
  console.log('Initializing database...')
  await initDatabase()

  console.log('Creating agents...')
  for (const agent of AGENTS) {
    await agentsRepo.create({
      name: agent.name,
      role: agent.role,
      station: agent.station,
      sessionKey: `agent:${agent.name}:main`,
      capabilities: {},
      wipLimit: 2,
    })
  }

  console.log('Creating work orders...')
  const workOrders = [
    { title: 'Implement Live View streaming', priority: 'P1', template: 'software_feature' },
    { title: 'Fix authentication timeout bug', priority: 'P0', template: 'bugfix' },
    { title: 'Update dependencies to latest', priority: 'P2', template: 'maintenance' },
    { title: 'Add playbook execution engine', priority: 'P1', template: 'software_feature' },
    { title: 'Implement approval workflows', priority: 'P1', template: 'software_feature' },
  ]

  for (const wo of workOrders) {
    const created = await workOrdersRepo.create({
      title: wo.title,
      goalMd: `## Goal\n\nImplement ${wo.title}\n\n## Acceptance Criteria\n\n- [ ] Feature works\n- [ ] Tests pass`,
      priority: wo.priority as any,
      routingTemplate: wo.template,
    })

    // Create operations from template
    const stations = ROUTING_TEMPLATES[wo.template as keyof typeof ROUTING_TEMPLATES]
    await operationsRepo.createMany(
      created.id,
      stations.map((station, i) => ({
        station,
        title: `${station.charAt(0).toUpperCase() + station.slice(1)} for ${wo.title}`,
        dependsOnOperationIds: i > 0 ? [] : [], // Would reference previous
      }))
    )
  }

  console.log('Creating sample activities...')
  // Create 1000 activities for perf testing
  for (let i = 0; i < 1000; i++) {
    await activitiesRepo.append({
      type: ['WORK_ORDER_CREATED', 'STATE_CHANGED', 'RECEIPT_CREATED'][i % 3],
      actor: ['user', 'savorgBUILD', 'savorgOPS'][i % 3],
      entityType: 'work_order',
      entityId: 'seed-entity',
      summary: `Sample activity ${i}`,
      payload: {},
    })
  }

  console.log('Seed complete!')
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

**Acceptance Criteria**:
- [ ] `pnpm db:seed` runs successfully
- [ ] 5+ WOs with operations created
- [ ] 5 agents created
- [ ] 1000 activities created
- [ ] Can query Now page data after seed

---

## Phase 2: Work Orders + Operations

**Goal**: Implement full WO + Operation CRUD with state machine enforcement and routing templates.

**PRs**: 3-4 PRs

---

### PR 2.1: State Machine Implementation

**Files to create**:

```
packages/core/src/state-machines/
├── work-order.ts
├── operation.ts
└── index.ts

apps/mission-control/lib/services/
├── state-machine.ts
└── index.ts
```

**work-order.ts** (state machine from spec):
```typescript
export type WorkOrderState =
  | 'planned'
  | 'active'
  | 'blocked'
  | 'review'
  | 'shipped'
  | 'cancelled'

const TRANSITIONS: Record<WorkOrderState, WorkOrderState[]> = {
  planned: ['active'],
  active: ['blocked', 'review', 'shipped', 'cancelled'],
  blocked: ['active', 'cancelled'],
  review: ['active', 'shipped'],
  shipped: [], // terminal
  cancelled: [], // terminal
}

export function canTransitionWorkOrder(
  from: WorkOrderState,
  to: WorkOrderState
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function getValidTransitions(from: WorkOrderState): WorkOrderState[] {
  return TRANSITIONS[from]
}

export function isTerminalState(state: WorkOrderState): boolean {
  return state === 'shipped' || state === 'cancelled'
}
```

**operation.ts** (state machine from spec):
```typescript
export type OperationStatus =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'rework'

const TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  todo: ['in_progress', 'blocked'],
  in_progress: ['review', 'done', 'blocked', 'rework'],
  review: ['done', 'rework'],
  blocked: ['todo', 'in_progress'],
  rework: ['todo', 'in_progress'],
  done: [], // terminal
}

export function canTransitionOperation(
  from: OperationStatus,
  to: OperationStatus
): boolean {
  return TRANSITIONS[from].includes(to)
}

export function getValidTransitions(from: OperationStatus): OperationStatus[] {
  return TRANSITIONS[from]
}
```

**Acceptance Criteria**:
- [ ] State machines validate all transitions
- [ ] Invalid transitions throw/reject
- [ ] Terminal states have no outgoing transitions
- [ ] Rework loop supported (review → rework → in_progress)

---

### PR 2.2: Routing Templates + Operation Creation

**Files to create**:

```
packages/core/src/
├── routing/
│   ├── templates.ts
│   └── index.ts
└── types/
    └── routing.ts

apps/mission-control/lib/services/
└── work-order-service.ts
```

**templates.ts**:
```typescript
export interface RoutingTemplate {
  id: string
  name: string
  description: string
  stations: StationConfig[]
}

export interface StationConfig {
  station: string
  title: string
  dependsOn?: string[] // station names
  parallel?: boolean
}

export const ROUTING_TEMPLATES: RoutingTemplate[] = [
  {
    id: 'software_feature',
    name: 'Software Feature',
    description: 'Spec → Build → QA → Ship → Compound',
    stations: [
      { station: 'spec', title: 'Specification' },
      { station: 'build', title: 'Implementation', dependsOn: ['spec'] },
      { station: 'qa', title: 'Quality Assurance', dependsOn: ['build'] },
      { station: 'ship', title: 'Ship', dependsOn: ['qa'] },
      { station: 'compound', title: 'Compound', dependsOn: ['ship'] },
    ],
  },
  {
    id: 'bugfix',
    name: 'Bugfix',
    description: 'Repro → Fix → QA → Ship → Compound',
    stations: [
      { station: 'build', title: 'Reproduce & Fix' },
      { station: 'qa', title: 'Verify Fix', dependsOn: ['build'] },
      { station: 'ship', title: 'Ship', dependsOn: ['qa'] },
      { station: 'compound', title: 'Compound', dependsOn: ['ship'] },
    ],
  },
  {
    id: 'maintenance',
    name: 'Maintenance/Incident',
    description: 'Triage → Repair → Verify → Compound',
    stations: [
      { station: 'ops', title: 'Triage' },
      { station: 'ops', title: 'Repair', dependsOn: ['ops'] },
      { station: 'qa', title: 'Verify', dependsOn: ['ops'] },
      { station: 'compound', title: 'Postmortem', dependsOn: ['qa'] },
    ],
  },
  {
    id: 'ops_change',
    name: 'Ops Change',
    description: 'Plan → Change → Verify → Monitor → Compound',
    stations: [
      { station: 'ops', title: 'Plan' },
      { station: 'ops', title: 'Execute Change', dependsOn: ['ops'] },
      { station: 'qa', title: 'Verify', dependsOn: ['ops'] },
      { station: 'ops', title: 'Monitor', dependsOn: ['qa'] },
      { station: 'compound', title: 'Compound', dependsOn: ['ops'] },
    ],
  },
]

export function getTemplate(id: string): RoutingTemplate | undefined {
  return ROUTING_TEMPLATES.find(t => t.id === id)
}
```

**work-order-service.ts**:
```typescript
import { workOrdersRepo } from '../db/repos/work-orders'
import { operationsRepo } from '../db/repos/operations'
import { getTemplate } from '@savorgos/core/routing'
import { canTransitionWorkOrder } from '@savorgos/core/state-machines'

export const workOrderService = {
  async create(input: {
    title: string
    goalMd: string
    priority: string
    routingTemplate: string
  }) {
    const template = getTemplate(input.routingTemplate)
    if (!template) {
      throw new Error(`Unknown routing template: ${input.routingTemplate}`)
    }

    // Create WO
    const wo = await workOrdersRepo.create({
      title: input.title,
      goalMd: input.goalMd,
      priority: input.priority as any,
      routingTemplate: input.routingTemplate,
    })

    // Create operations from template
    const operations = await operationsRepo.createMany(
      wo.id,
      template.stations.map((s, i) => ({
        station: s.station,
        title: s.title,
        dependsOnOperationIds: [], // Resolved after creation
      }))
    )

    // Resolve dependencies (map station names to operation IDs)
    // ... dependency resolution logic

    return { workOrder: wo, operations }
  },

  async transition(id: string, to: string, meta?: { blockedReason?: string }) {
    const wo = await workOrdersRepo.getById(id)
    if (!wo) throw new Error('Work order not found')

    if (!canTransitionWorkOrder(wo.state as any, to as any)) {
      throw new Error(`Invalid transition: ${wo.state} → ${to}`)
    }

    await workOrdersRepo.setState(id, to as any, meta)
  },
}
```

**Acceptance Criteria**:
- [ ] All 4 routing templates defined
- [ ] Creating WO creates operations from template
- [ ] Dependencies tracked between operations
- [ ] State transitions validated

---

### PR 2.3: Work Orders API Routes

**Files to create**:

```
apps/mission-control/app/api/
├── work-orders/
│   ├── route.ts              # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts          # GET (detail)
│       └── state/
│           └── route.ts      # POST (transition)
└── operations/
    └── [id]/
        └── status/
            └── route.ts      # POST (transition)
```

**work-orders/route.ts**:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { workOrderService } from '@/lib/services/work-order-service'
import { workOrdersRepo } from '@/lib/db/repos/work-orders'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const state = searchParams.get('state')?.split(',')
  const priority = searchParams.get('priority')?.split(',')
  const limit = parseInt(searchParams.get('limit') ?? '50')
  const cursor = searchParams.get('cursor')

  const page = await workOrdersRepo.list({
    state: state as any,
    priority: priority as any,
    limit,
    cursor: cursor ? JSON.parse(cursor) : undefined,
  })

  return NextResponse.json(page)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Validate input
  const { title, goalMd, priority, routingTemplate } = body
  if (!title || !goalMd || !priority || !routingTemplate) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } },
      { status: 400 }
    )
  }

  try {
    const result = await workOrderService.create({
      title,
      goalMd,
      priority,
      routingTemplate,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: err.message } },
      { status: 500 }
    )
  }
}
```

**Acceptance Criteria**:
- [ ] GET /api/work-orders returns paginated list
- [ ] POST /api/work-orders creates WO + operations
- [ ] GET /api/work-orders/:id returns full detail
- [ ] POST /api/work-orders/:id/state transitions state
- [ ] POST /api/operations/:id/status transitions status
- [ ] Error responses use canonical format

---

### PR 2.4: Work Orders UI (List + Detail)

**Files to update/create**:

```
apps/mission-control/app/(dashboard)/work-orders/
├── page.tsx                  # List view
└── [id]/
    └── page.tsx              # Detail view (Traveler Packet)

apps/mission-control/components/
├── work-orders/
│   ├── work-order-table.tsx
│   ├── work-order-detail.tsx
│   ├── routing-view.tsx
│   ├── operations-list.tsx
│   └── state-transition-menu.tsx
└── data-display/
    ├── status-pill.tsx
    └── canonical-table.tsx
```

Connect to real API, remove mock data.

**Acceptance Criteria**:
- [ ] Work Orders list fetches from API
- [ ] Pagination works (keyset)
- [ ] Filters work (state, priority)
- [ ] Clicking row opens detail
- [ ] Detail shows operations, routing view
- [ ] State transitions work from UI

---

## Phase 3: Activities + Live + Receipts

**Goal**: Implement activity stream with SSE, receipt creation/viewing, and live streaming.

**PRs**: 3 PRs

---

### PR 3.1: Activities API + SSE Stream

**Files to create**:

```
apps/mission-control/app/api/
├── activities/
│   └── route.ts              # GET (list)
└── stream/
    └── activities/
        └── route.ts          # GET (SSE stream)

apps/mission-control/lib/
└── sse/
    ├── activity-emitter.ts
    └── index.ts
```

**stream/activities/route.ts** (SSE endpoint):
```typescript
import { NextRequest } from 'next/server'
import { activityEmitter } from '@/lib/sse/activity-emitter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Send initial connection message
      send({ type: 'connected', ts: new Date().toISOString() })

      // Subscribe to activity events
      const unsubscribe = activityEmitter.subscribe(send)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        unsubscribe()
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

**activity-emitter.ts**:
```typescript
type Listener = (data: any) => void

class ActivityEmitter {
  private listeners: Set<Listener> = new Set()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(activity: any) {
    for (const listener of this.listeners) {
      listener(activity)
    }
  }
}

export const activityEmitter = new ActivityEmitter()

// Hook into activities repo to emit on write
// Called from activitiesRepo.append()
export function emitActivity(activity: any) {
  activityEmitter.emit(activity)
}
```

**Acceptance Criteria**:
- [ ] GET /api/activities returns paginated list
- [ ] GET /api/stream/activities returns SSE stream
- [ ] New activities broadcast to connected clients
- [ ] Stream handles disconnects gracefully

---

### PR 3.2: Receipts CRUD + Streaming

**Files to create**:

```
apps/mission-control/app/api/
├── receipts/
│   ├── route.ts              # GET (list)
│   └── [id]/
│       └── route.ts          # GET (detail)
└── stream/
    └── runs/
        └── [id]/
            └── route.ts      # GET (SSE for live run)

apps/mission-control/lib/
└── receipts/
    ├── stream-buffer.ts
    └── index.ts
```

**stream-buffer.ts** (ReceiptStreamBuffer from spec):
```typescript
interface BufferEntry {
  stdout: string
  stderr: string
  lastFlush: number
}

const FLUSH_INTERVAL_MS = 1000
const FLUSH_SIZE_CHARS = 4096

class ReceiptStreamBuffer {
  private buffers = new Map<string, BufferEntry>()
  private listeners = new Map<string, Set<(data: any) => void>>()

  append(receiptId: string, stream: 'stdout' | 'stderr', chunk: string) {
    let entry = this.buffers.get(receiptId)
    if (!entry) {
      entry = { stdout: '', stderr: '', lastFlush: Date.now() }
      this.buffers.set(receiptId, entry)
    }

    entry[stream] += chunk

    // Emit to live listeners
    const listeners = this.listeners.get(receiptId)
    if (listeners) {
      for (const listener of listeners) {
        listener({ type: stream, chunk })
      }
    }

    // Check if we should flush to DB
    if (
      entry.stdout.length + entry.stderr.length > FLUSH_SIZE_CHARS ||
      Date.now() - entry.lastFlush > FLUSH_INTERVAL_MS
    ) {
      this.flush(receiptId)
    }
  }

  subscribe(receiptId: string, listener: (data: any) => void): () => void {
    let set = this.listeners.get(receiptId)
    if (!set) {
      set = new Set()
      this.listeners.set(receiptId, set)
    }
    set.add(listener)
    return () => set!.delete(listener)
  }

  async flush(receiptId: string) {
    const entry = this.buffers.get(receiptId)
    if (!entry) return

    // Trim to excerpt size
    const stdoutExcerpt = entry.stdout.slice(-32768)
    const stderrExcerpt = entry.stderr.slice(-32768)

    await receiptsRepo.flushExcerpt(receiptId, {
      stdoutTail: stdoutExcerpt,
      stderrTail: stderrExcerpt,
    })

    entry.lastFlush = Date.now()
  }

  async finalize(receiptId: string, result: {
    exitCode: number
    durationMs: number
    parsedJson?: any
  }) {
    await this.flush(receiptId)
    await receiptsRepo.finish(receiptId, result)
    this.buffers.delete(receiptId)
    this.listeners.delete(receiptId)
  }
}

export const receiptStreamBuffer = new ReceiptStreamBuffer()
```

**Acceptance Criteria**:
- [ ] Receipts created with start/finish lifecycle
- [ ] Stream buffer collects output
- [ ] Live SSE stream for running receipts
- [ ] Excerpts trimmed to 32KB
- [ ] Finalized receipts have exit code, duration

---

### PR 3.3: Activity Feed + Receipt Viewer UI

**Files to create/update**:

```
apps/mission-control/components/
├── activities/
│   ├── activity-feed.tsx
│   ├── activity-row.tsx
│   └── use-activity-stream.ts    # SSE hook
├── receipts/
│   ├── receipt-viewer.tsx
│   ├── log-viewer.tsx
│   └── use-receipt-stream.ts     # SSE hook
└── ops/
    └── (move to next phase)

apps/mission-control/app/(dashboard)/
├── runs/
│   └── page.tsx
└── now/
    └── page.tsx                  # Wire activity feed
```

**use-activity-stream.ts**:
```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'

interface Activity {
  id: string
  ts: string
  type: string
  actor: string
  entityType: string
  entityId: string
  summary: string
}

export function useActivityStream(initialLimit = 200) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // Fetch initial activities
    fetch(`/api/activities?limit=${initialLimit}`)
      .then(res => res.json())
      .then(data => setActivities(data.items))

    // Connect to SSE
    const eventSource = new EventSource('/api/stream/activities')

    eventSource.onopen = () => setConnected(true)
    eventSource.onerror = () => setConnected(false)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type !== 'connected') {
        setActivities(prev => [data, ...prev].slice(0, initialLimit))
      }
    }

    return () => eventSource.close()
  }, [initialLimit])

  const loadMore = useCallback(async (cursor: string) => {
    const res = await fetch(`/api/activities?limit=50&cursor=${cursor}`)
    const data = await res.json()
    setActivities(prev => [...prev, ...data.items])
    return data.nextCursor
  }, [])

  return { activities, connected, loadMore }
}
```

**Acceptance Criteria**:
- [ ] Activity feed shows latest 200 activities
- [ ] Real-time updates via SSE
- [ ] "Load more" pagination works
- [ ] Receipt viewer shows stdout/stderr tabs
- [ ] Live receipt stream updates in real-time
- [ ] Connection status indicator

---

## Phase 4: Approvals + Typed Confirm

**Goal**: Implement approval queue, typed confirmations, and gating for dangerous actions.

**PRs**: 2 PRs

---

### PR 4.1: Approvals API + Service

**Files to create**:

```
apps/mission-control/app/api/approvals/
├── route.ts                  # GET (list pending), POST (create)
└── [id]/
    └── resolve/
        └── route.ts          # POST (approve/reject)

apps/mission-control/lib/services/
└── approval-service.ts
```

**approval-service.ts**:
```typescript
import { approvalsRepo } from '../db/repos/approvals'
import { activitiesRepo } from '../db/repos/activities'
import { emitActivity } from '../sse/activity-emitter'

export const approvalService = {
  async createApproval(input: {
    workOrderId: string
    operationId?: string
    type: string
    questionMd: string
  }) {
    const approval = await approvalsRepo.create(input)

    const activity = {
      type: 'APPROVAL_REQUESTED',
      actor: 'system',
      entityType: 'approval',
      entityId: approval.id,
      summary: `Approval required: ${input.type}`,
      payloadJson: JSON.stringify({ type: input.type }),
    }

    await activitiesRepo.append(activity)
    emitActivity(activity)

    return approval
  },

  async resolve(id: string, decision: 'approved' | 'rejected') {
    await approvalsRepo.resolve(id, decision, 'user')

    const activity = {
      type: decision === 'approved' ? 'APPROVAL_APPROVED' : 'APPROVAL_REJECTED',
      actor: 'user',
      entityType: 'approval',
      entityId: id,
      summary: `Approval ${decision}`,
      payloadJson: JSON.stringify({ decision }),
    }

    await activitiesRepo.append(activity)
    emitActivity(activity)
  },

  async requireApprovalForAction(
    workOrderId: string,
    actionType: string,
    questionMd: string
  ): Promise<string> {
    const approval = await this.createApproval({
      workOrderId,
      type: actionType,
      questionMd,
    })
    return approval.id
  },

  async checkApprovalStatus(id: string): Promise<'pending' | 'approved' | 'rejected'> {
    const approval = await approvalsRepo.getById(id)
    return approval?.status ?? 'pending'
  },
}
```

**Acceptance Criteria**:
- [ ] Approvals created for dangerous actions
- [ ] Pending approvals visible in Now page
- [ ] Resolve endpoint approves/rejects
- [ ] Activities emitted on approval events

---

### PR 4.2: Typed Confirm Dialog + Approval UI

**Files to create**:

```
apps/mission-control/components/interactions/
├── confirm-dialog.tsx
├── typed-confirm-dialog.tsx
└── approval-drawer.tsx

apps/mission-control/app/(dashboard)/now/
└── _components/
    └── pending-approvals.tsx
```

**typed-confirm-dialog.tsx**:
```typescript
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog'
import { Button } from './button'
import { Input } from '../forms/input'

interface TypedConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText: string // What user must type (e.g., "WO-0001" or "CONFIRM")
  confirmLabel?: string
  onConfirm: () => void
  danger?: boolean
}

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel = 'Confirm',
  onConfirm,
  danger = false,
}: TypedConfirmDialogProps) {
  const [input, setInput] = useState('')
  const isMatch = input === confirmText

  const handleConfirm = () => {
    if (isMatch) {
      onConfirm()
      onOpenChange(false)
      setInput('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-bg-2 border-bd-0">
        <DialogHeader>
          <DialogTitle className={danger ? 'text-status-danger' : ''}>
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-body text-fg-1">{description}</p>

          <div>
            <label className="text-caption text-fg-2 mb-1 block">
              Type <code className="font-mono text-fg-0">{confirmText}</code> to confirm
            </label>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={confirmText}
              className={danger ? 'border-status-danger/50' : ''}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={!isMatch}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Acceptance Criteria**:
- [ ] TypedConfirmDialog requires exact match
- [ ] Danger styling for dangerous actions
- [ ] Approval drawer shows pending approvals
- [ ] Approve/Reject buttons work
- [ ] Ship gates require approval before shipping

---

## Phase 5: Editors + Schema Validation

**Goal**: Implement Markdown and JSON/YAML editors with prettify and schema validation.

**PRs**: 2 PRs

---

### PR 5.1: Markdown Editor

**Files to create**:

```
apps/mission-control/components/editors/
├── markdown-editor.tsx
├── markdown-preview.tsx
├── markdown-toolbar.tsx
└── use-markdown-editor.ts

apps/mission-control/lib/
└── prettier/
    └── format.ts
```

Use CodeMirror 6 with `@uiw/react-codemirror` and markdown extensions.

**Acceptance Criteria**:
- [ ] Edit/Preview/Split modes work
- [ ] Toolbar with canonical buttons
- [ ] Prettify formats markdown
- [ ] Keyboard shortcuts work
- [ ] Diff preview for protected files

---

### PR 5.2: JSON/YAML Editor + Schema Validation

**Files to create**:

```
apps/mission-control/components/editors/
├── json-editor.tsx
├── yaml-editor.tsx
└── schema-validator.tsx

schemas/
├── command-template.schema.json
├── playbook.schema.json
├── branch-rules.schema.json
└── branch-target.schema.json

apps/mission-control/lib/
└── validation/
    ├── ajv.ts
    └── schemas.ts
```

Use AJV for validation, load schemas from files.

**Acceptance Criteria**:
- [ ] JSON/YAML syntax highlighting
- [ ] Prettify formats correctly
- [ ] Schema validation with error display
- [ ] Copy JSON / Copy minified buttons
- [ ] Schema errors show JSON pointer paths

---

## Phase 6: Skills Manager

**Goal**: Implement Skills UI for upload, edit, and scope management.

**PRs**: 2 PRs

---

### PR 6.1: Skills API + Storage

**Files to create**:

```
apps/mission-control/app/api/skills/
├── route.ts                  # GET (list), POST (upload)
└── [id]/
    ├── route.ts              # GET, PUT, DELETE
    └── validate/
        └── route.ts          # POST (validate)

apps/mission-control/lib/services/
└── skills-service.ts
```

Skills stored as files in workspace:
- Global: `skills/<skillName>/SKILL.md`
- Agent-specific: `agents/<agentName>/skills/<skillName>/SKILL.md`

**Acceptance Criteria**:
- [ ] List skills from filesystem
- [ ] Upload skill (paste or file)
- [ ] Validate SKILL.md format
- [ ] Scope: global vs agent-specific
- [ ] Approval required for global skills

---

### PR 6.2: Skills UI

**Files to create**:

```
apps/mission-control/app/(dashboard)/skills/
├── page.tsx
└── _components/
    ├── skills-table.tsx
    ├── skill-upload-dialog.tsx
    └── skill-detail-drawer.tsx
```

**Acceptance Criteria**:
- [ ] Skills table shows all skills
- [ ] Upload dialog with scope selection
- [ ] Detail drawer with editor
- [ ] Diff preview before save
- [ ] Approval workflow for protected skills

---

## Phase 7: Plugins Manager

**Goal**: Implement Plugins UI for OpenClaw plugin management.

**PRs**: 2 PRs

---

### PR 7.1: Plugins API (via OpenClaw Adapter)

**Files to create**:

```
apps/mission-control/app/api/plugins/
├── route.ts                  # GET (list)
└── [id]/
    ├── route.ts              # GET (info)
    ├── enable/
    │   └── route.ts          # POST
    ├── disable/
    │   └── route.ts          # POST
    └── config/
        └── route.ts          # GET, PUT

packages/adapters-openclaw/src/
├── plugins.ts
└── index.ts
```

**Acceptance Criteria**:
- [ ] List plugins via adapter
- [ ] Get plugin info with config schema
- [ ] Enable/disable with approval
- [ ] Config update with approval
- [ ] Triggers gateway restart playbook

---

### PR 7.2: Plugins UI

**Files to create**:

```
apps/mission-control/app/(dashboard)/plugins/
├── page.tsx
└── _components/
    ├── plugins-table.tsx
    ├── plugin-detail-drawer.tsx
    └── plugin-config-form.tsx
```

**Acceptance Criteria**:
- [ ] Plugins table with status
- [ ] Detail drawer with tabs
- [ ] Schema-driven config form
- [ ] Install plugin dialog
- [ ] Approval + typed confirm for dangerous ops

---

## Phase 8: OpenClaw Adapters + Gateway Console

**Goal**: Implement full OpenClaw adapter with all modes and Gateway Console UI.

**PRs**: 3 PRs

---

### PR 8.1: OpenClaw Adapter Interface + Mock + Local CLI

**Files to create**:

```
packages/adapters-openclaw/src/
├── index.ts                  # Main exports
├── types.ts                  # Interfaces
├── adapter.ts                # Adapter factory
├── mock.ts                   # Mock implementation (dev)
├── local-cli.ts              # Local CLI implementation (default)
├── http.ts                   # HTTP implementation (optional)
├── ws.ts                     # WebSocket implementation (optional)
└── ssh-cli.ts                # SSH CLI fallback (rare)
```

**types.ts**:
```typescript
export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down'
  message?: string
  details?: Record<string, any>
  timestamp: string
}

export interface GatewayStatus {
  running: boolean
  version?: string
  build?: string
  uptime?: number
  clients?: number
}

export interface OpenClawAdapter {
  // Health & Status
  healthCheck(): Promise<HealthCheckResult>
  gatewayStatus(options?: { deep?: boolean }): Promise<GatewayStatus>
  gatewayProbe(): Promise<{ ok: boolean; latencyMs: number }>

  // Logs
  tailLogs(options?: { limit?: number; follow?: boolean }): AsyncGenerator<string>

  // Channels
  channelsStatus(options?: { probe?: boolean }): Promise<any>

  // Models
  modelsStatus(options?: { check?: boolean }): Promise<any>

  // Agent Messaging
  sendToAgent(
    target: string,
    message: string,
    options?: { stream?: boolean }
  ): AsyncGenerator<string>

  // Commands
  runCommandTemplate(
    templateId: string,
    args: Record<string, any>
  ): AsyncGenerator<{ type: 'stdout' | 'stderr'; chunk: string } | { type: 'exit'; code: number }>

  // Events (optional)
  subscribeEvents?(callback: (event: any) => void): () => void

  // Plugins
  listPlugins(): Promise<any[]>
  pluginInfo(id: string): Promise<any>
  pluginDoctor(): Promise<any>
  installPlugin(spec: string): AsyncGenerator<string>
  enablePlugin(id: string): Promise<void>
  disablePlugin(id: string): Promise<void>
}

export type AdapterMode = 'mock' | 'local_cli' | 'remote_http' | 'remote_ws' | 'remote_cli_over_ssh'
```

**mock.ts** (for development):
```typescript
import type { OpenClawAdapter, HealthCheckResult, GatewayStatus } from './types'

export class MockOpenClawAdapter implements OpenClawAdapter {
  async healthCheck(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      message: 'Mock gateway healthy',
      timestamp: new Date().toISOString(),
    }
  }

  async gatewayStatus(): Promise<GatewayStatus> {
    return {
      running: true,
      version: '1.0.0-mock',
      build: 'mock-build',
      uptime: 3600,
      clients: 2,
    }
  }

  async gatewayProbe(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 5 }
  }

  async *tailLogs(options?: { limit?: number }): AsyncGenerator<string> {
    const logs = [
      '[INFO] Gateway started',
      '[INFO] Client connected',
      '[INFO] Agent savorgBUILD ready',
    ]
    for (const log of logs.slice(0, options?.limit ?? 10)) {
      yield log
    }
  }

  async channelsStatus(): Promise<any> {
    return { discord: { status: 'connected' }, telegram: { status: 'connected' } }
  }

  async modelsStatus(): Promise<any> {
    return { models: ['claude-3-opus', 'claude-3-sonnet'] }
  }

  async *sendToAgent(target: string, message: string): AsyncGenerator<string> {
    yield `[Mock] Received message for ${target}: ${message}`
    yield `[Mock] Processing...`
    yield `[Mock] Complete`
  }

  async *runCommandTemplate(templateId: string): AsyncGenerator<any> {
    yield { type: 'stdout', chunk: `Running template: ${templateId}\n` }
    yield { type: 'stdout', chunk: 'Complete.\n' }
    yield { type: 'exit', code: 0 }
  }

  async listPlugins(): Promise<any[]> {
    return [
      { id: 'plugin-a', name: 'Plugin A', enabled: true, status: 'ok' },
      { id: 'plugin-b', name: 'Plugin B', enabled: false, status: 'disabled' },
    ]
  }

  async pluginInfo(id: string): Promise<any> {
    return { id, name: `Plugin ${id}`, configSchema: {} }
  }

  async pluginDoctor(): Promise<any> {
    return { ok: true, issues: [] }
  }

  async *installPlugin(spec: string): AsyncGenerator<string> {
    yield `Installing ${spec}...`
    yield 'Done.'
  }

  async enablePlugin(id: string): Promise<void> {}
  async disablePlugin(id: string): Promise<void> {}
}
```

**Acceptance Criteria**:
- [ ] Adapter interface defined
- [ ] Mock adapter works for development
- [ ] Local CLI adapter works as default (uses `openclaw` commands)
- [ ] Factory selects adapter by mode
- [ ] All methods have correct signatures

---

### PR 8.2: Local CLI + HTTP Adapter Implementation

**Files to create/update**:

```
packages/adapters-openclaw/src/
├── local-cli.ts              # Local CLI implementation (default)
├── http.ts                   # HTTP implementation (optional)
└── config.ts                 # Connection config
```

**local-cli.ts** (default adapter - uses local `openclaw` CLI):
```typescript
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import type { OpenClawAdapter, HealthCheckResult, GatewayStatus } from './types'

const execAsync = promisify(exec)

export class LocalCliOpenClawAdapter implements OpenClawAdapter {
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const { stdout } = await execAsync('openclaw health --json')
      const data = JSON.parse(stdout)
      return {
        status: data.healthy ? 'ok' : 'degraded',
        details: data,
        timestamp: new Date().toISOString(),
      }
    } catch (err: any) {
      return {
        status: 'down',
        message: err.message,
        timestamp: new Date().toISOString(),
      }
    }
  }

  async gatewayStatus(options?: { deep?: boolean }): Promise<GatewayStatus> {
    const cmd = options?.deep
      ? 'openclaw gateway status --deep --json'
      : 'openclaw gateway status --json'
    const { stdout } = await execAsync(cmd)
    return JSON.parse(stdout)
  }

  async gatewayProbe(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    try {
      await execAsync('openclaw gateway probe')
      return { ok: true, latencyMs: Date.now() - start }
    } catch {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }

  async *tailLogs(options?: { limit?: number; follow?: boolean }): AsyncGenerator<string> {
    if (options?.follow) {
      const proc = spawn('openclaw', ['logs', '--follow', '--plain'])
      for await (const chunk of proc.stdout) {
        yield chunk.toString()
      }
    } else {
      const limit = options?.limit ?? 200
      const { stdout } = await execAsync(`openclaw logs --limit ${limit} --plain`)
      for (const line of stdout.split('\n')) {
        yield line
      }
    }
  }

  async *runCommandTemplate(
    templateId: string,
    args: Record<string, any>
  ): AsyncGenerator<any> {
    // Execute command template via CLI
    // Template execution logic here
    yield { type: 'stdout', chunk: `Executing ${templateId}...\n` }
    yield { type: 'exit', code: 0 }
  }

  // ... other methods using openclaw CLI
}
```

**http.ts** (optional - for remote Gateway):
```typescript
import type { OpenClawAdapter, HealthCheckResult, GatewayStatus } from './types'

interface HttpAdapterConfig {
  baseUrl: string // e.g., "http://192.168.1.100:8080"
  token?: string
  password?: string
}

export class HttpOpenClawAdapter implements OpenClawAdapter {
  constructor(private config: HttpAdapterConfig) {}

  private get headers(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`
    } else if (this.config.password) {
      headers['Authorization'] = `Bearer ${this.config.password}`
    }
    return headers
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const res = await fetch(`${this.config.baseUrl}/health`, {
        headers: this.headers,
      })

      if (!res.ok) {
        return {
          status: 'down',
          message: `HTTP ${res.status}`,
          timestamp: new Date().toISOString(),
        }
      }

      const data = await res.json()
      return {
        status: data.healthy ? 'ok' : 'degraded',
        details: data,
        timestamp: new Date().toISOString(),
      }
    } catch (err: any) {
      return {
        status: 'down',
        message: err.message,
        timestamp: new Date().toISOString(),
      }
    }
  }

  async gatewayStatus(options?: { deep?: boolean }): Promise<GatewayStatus> {
    const res = await fetch(
      `${this.config.baseUrl}/gateway/status${options?.deep ? '?deep=true' : ''}`,
      { headers: this.headers }
    )
    return res.json()
  }

  async *sendToAgent(
    target: string,
    message: string,
    options?: { stream?: boolean }
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.headers,
        'x-openclaw-agent-id': target,
      },
      body: JSON.stringify({
        model: `openclaw:${target}`,
        messages: [{ role: 'user', content: message }],
        stream: options?.stream ?? true,
      }),
    })

    if (!res.body) throw new Error('No response body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      // Parse SSE format
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            const content = parsed.choices?.[0]?.delta?.content
            if (content) yield content
          } catch {}
        }
      }
    }
  }

  // ... other methods
}
```

**Acceptance Criteria**:
- [ ] Local CLI adapter executes `openclaw` commands
- [ ] HTTP adapter connects to remote OpenClaw (optional mode)
- [ ] Health check works in both modes
- [ ] Agent messaging with streaming
- [ ] Error handling for CLI/network failures

---

### PR 8.3: Gateway Console UI + Maintenance Page

**Files to create/update**:

```
apps/mission-control/app/(dashboard)/maintenance/
├── page.tsx
└── _components/
    ├── gateway-health-card.tsx
    ├── command-buttons.tsx
    ├── playbook-runner.tsx
    └── recent-receipts.tsx

apps/mission-control/components/ops/
├── command-button.tsx
├── playbook-runner.tsx
└── receipt-viewer.tsx
```

Wire up command templates and playbooks from spec (gateway.status.json, doctor.fix.json, etc.).

**Acceptance Criteria**:
- [ ] Gateway health card with live status
- [ ] Maintenance buttons execute templates
- [ ] Playbook runner shows step progress
- [ ] Receipts stream live output
- [ ] Dangerous actions require approval

---

## Phase 9: Create Agent Workflow

**Goal**: Implement agent provisioning wizard and savorgCEO guided hiring.

**PRs**: 2 PRs

---

### PR 9.1: Agent Provisioning API + Files

**Files to create**:

```
apps/mission-control/app/api/agents/
├── route.ts                  # GET (list), POST (create)
├── [id]/
│   └── route.ts              # GET, PUT, DELETE
└── provision/
    └── route.ts              # POST (wizard)

apps/mission-control/lib/services/
└── agent-provisioning.ts
```

**agent-provisioning.ts**:
```typescript
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { agentsRepo } from '../db/repos/agents'

const WORKSPACE_ROOT = process.cwd()

interface ProvisionAgentInput {
  name: string // Must match savorg[A-Z0-9]+ pattern
  role: string
  station: string
  autonomyLevel: 'intern' | 'specialist' | 'lead'
  capabilities: string[]
  wipLimit: number
}

export const agentProvisioning = {
  validateName(name: string): boolean {
    return /^savorg[A-Z0-9]{2,16}$/.test(name)
  },

  async generateFiles(input: ProvisionAgentInput): Promise<{
    overlayPath: string
    soulPath?: string
    heartbeatPath: string
  }> {
    const agentDir = join(WORKSPACE_ROOT, 'agents', input.name)
    await mkdir(agentDir, { recursive: true })

    // Generate overlay
    const overlayContent = `# ${input.name}

**Role**: ${input.role}
**Station**: ${input.station}
**Autonomy**: ${input.autonomyLevel}

## Capabilities

${input.capabilities.map(c => `- ${c}`).join('\n')}

## Operating Guidelines

1. Follow AGENTS.md invariants
2. Report progress via Mission Control
3. Request approval for side effects
`

    const overlayPath = join(agentDir, `${input.name}.md`)
    await writeFile(overlayPath, overlayContent)

    // Generate HEARTBEAT.md
    const heartbeatContent = `# Heartbeat: ${input.name}

## Health Checks

- [ ] Can connect to Mission Control
- [ ] Can read assigned operations
- [ ] Can write receipts

## Schedule

Every 5 minutes.
`

    const heartbeatPath = join(agentDir, 'HEARTBEAT.md')
    await writeFile(heartbeatPath, heartbeatContent)

    return {
      overlayPath,
      heartbeatPath,
    }
  },

  async provision(input: ProvisionAgentInput) {
    // Validate name
    if (!this.validateName(input.name)) {
      throw new Error(`Invalid agent name: ${input.name}. Must match savorg[A-Z0-9]{2,16}`)
    }

    // Check for collision
    const existing = await agentsRepo.getByName(input.name)
    if (existing) {
      throw new Error(`Agent ${input.name} already exists`)
    }

    // Generate files
    const files = await this.generateFiles(input)

    // Create DB record
    const agent = await agentsRepo.create({
      name: input.name,
      role: input.role,
      station: input.station,
      sessionKey: `agent:${input.name}:main`,
      capabilities: input.capabilities.reduce((acc, c) => ({ ...acc, [c]: true }), {}),
      wipLimit: input.wipLimit,
    })

    return { agent, files }
  },
}
```

**Acceptance Criteria**:
- [ ] Agent name validation (savorg prefix)
- [ ] File generation (overlay, SOUL, heartbeat)
- [ ] DB record created
- [ ] Session key generated
- [ ] Collision detection

---

### PR 9.2: Agent Provisioning UI

**Files to create**:

```
apps/mission-control/app/(dashboard)/agents/
├── page.tsx
├── new/
│   └── page.tsx              # Wizard
└── _components/
    ├── agents-by-station.tsx
    ├── agent-card.tsx
    ├── provision-wizard.tsx
    └── agent-detail-drawer.tsx
```

**provision-wizard.tsx** (multi-step wizard):
```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Step = 'template' | 'parameters' | 'preview' | 'confirm'

const TEMPLATES = [
  { id: 'build', name: 'Builder', station: 'build', capabilities: ['fs_read', 'fs_write', 'shell'] },
  { id: 'qa', name: 'Reviewer', station: 'qa', capabilities: ['fs_read'] },
  { id: 'ops', name: 'Operator', station: 'ops', capabilities: ['fs_read', 'shell', 'cron_edit'] },
  { id: 'spec', name: 'Specifier', station: 'spec', capabilities: ['fs_read', 'web'] },
  { id: 'custom', name: 'Custom', station: '', capabilities: [] },
]

export function ProvisionWizard() {
  const [step, setStep] = useState<Step>('template')
  const [template, setTemplate] = useState<string>('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [station, setStation] = useState('')
  const [autonomy, setAutonomy] = useState<'intern' | 'specialist' | 'lead'>('specialist')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [wipLimit, setWipLimit] = useState(1)
  const [preview, setPreview] = useState<{ overlay: string; heartbeat: string } | null>(null)

  const router = useRouter()

  // Step handlers...

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {(['template', 'parameters', 'preview', 'confirm'] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`flex-1 h-1 rounded ${step === s ? 'bg-status-info' : 'bg-bg-3'}`}
          />
        ))}
      </div>

      {step === 'template' && (
        <TemplateStep
          templates={TEMPLATES}
          selected={template}
          onSelect={(t) => {
            setTemplate(t)
            const tpl = TEMPLATES.find(x => x.id === t)
            if (tpl && t !== 'custom') {
              setStation(tpl.station)
              setCapabilities(tpl.capabilities)
            }
            setStep('parameters')
          }}
        />
      )}

      {step === 'parameters' && (
        <ParametersStep
          name={name}
          setName={setName}
          role={role}
          setRole={setRole}
          station={station}
          setStation={setStation}
          autonomy={autonomy}
          setAutonomy={setAutonomy}
          capabilities={capabilities}
          setCapabilities={setCapabilities}
          wipLimit={wipLimit}
          setWipLimit={setWipLimit}
          onBack={() => setStep('template')}
          onNext={async () => {
            // Generate preview
            const res = await fetch('/api/agents/provision/preview', {
              method: 'POST',
              body: JSON.stringify({ name, role, station, autonomy, capabilities, wipLimit }),
            })
            const data = await res.json()
            setPreview(data)
            setStep('preview')
          }}
        />
      )}

      {step === 'preview' && preview && (
        <PreviewStep
          overlay={preview.overlay}
          heartbeat={preview.heartbeat}
          onBack={() => setStep('parameters')}
          onNext={() => setStep('confirm')}
        />
      )}

      {step === 'confirm' && (
        <ConfirmStep
          name={name}
          onBack={() => setStep('preview')}
          onConfirm={async () => {
            await fetch('/api/agents/provision', {
              method: 'POST',
              body: JSON.stringify({ name, role, station, autonomy, capabilities, wipLimit }),
            })
            router.push('/agents')
          }}
        />
      )}
    </div>
  )
}
```

**Acceptance Criteria**:
- [ ] Multi-step wizard works
- [ ] Template selection auto-fills fields
- [ ] Name auto-generated with validation
- [ ] File preview with diff
- [ ] Confirmation creates agent
- [ ] Redirect to agents list

---

## Definition of Done Checklists

### Per-PR Checklist

- [ ] Code compiles without errors
- [ ] Tests pass (unit + integration where applicable)
- [ ] No console errors in browser
- [ ] Responsive on target breakpoints
- [ ] Accessibility: keyboard navigation works
- [ ] Dark theme renders correctly
- [ ] No TypeScript `any` without justification

### Per-Phase Checklist

- [ ] All PRs merged
- [ ] Feature works end-to-end
- [ ] Manual testing completed
- [ ] No regressions in existing features
- [ ] Documentation updated if needed

---

## Testing Strategy

### Unit Tests

- State machines
- Routing template parsing
- Validation functions
- Utility functions

### Integration Tests

- API routes (mock DB)
- Repo methods (test DB)
- OpenClaw adapter (mock mode)

### E2E Smoke Tests

- Create WO → operations created
- Transition WO through states
- Run maintenance button → receipt created
- Search returns results

### Performance Tests

- Now page loads < 200ms with seeded data
- Activity feed handles 10k records
- FTS search < 50ms

---

## Appendix: Command Templates (from spec)

Seed these on first run:

1. `gateway.status.json` - Gateway status (safe)
2. `logs.follow.json` - Tail logs (caution)
3. `health.json` - Health snapshot (safe)
4. `doctor.check.json` - Doctor check (safe)
5. `doctor.fix.json` - Doctor fix (danger, approval required)
6. `gateway.restart.json` - Gateway restart (caution, approval required)
7. `troubleshooting.first60.probe.json` - Gateway probe (safe)
8. `plugins.list.json` - List plugins (safe)
9. `plugins.info.json` - Plugin info (safe)
10. `plugins.doctor.json` - Plugins doctor (safe)
11. `plugins.install.json` - Install plugin (danger, approval required)
12. `plugins.enable.json` - Enable plugin (danger, approval required)
13. `plugins.disable.json` - Disable plugin (danger, approval required)

---

## Appendix: Default Playbooks (from spec)

1. `gateway-recover.json` - Full recovery sequence
2. `plugin-change-safe.json` - Plugin change with restart

---

*End of Build Plan*
