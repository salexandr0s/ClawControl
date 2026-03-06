# ClawControl vs Paperclip: Full Competitive Analysis

> Generated: 2026-03-06

## Executive Summary

Both **ClawControl** and **Paperclip** are AI agent orchestration platforms, but they target different operational models. ClawControl is a **local-first mission control dashboard** tightly coupled to the OpenClaw runtime, while Paperclip positions itself as **"open-source orchestration for zero-human companies"** — a multi-tenant, multi-agent-runtime platform with broader organizational primitives. Paperclip has strong community traction (4.4k stars, 489 forks) and several features ClawControl should evaluate for adoption.

---

## 1. Feature-by-Feature Comparison

| Feature Area | ClawControl | Paperclip | Winner |
|---|---|---|---|
| **Agent Runtime Support** | OpenClaw only | OpenClaw, Claude Code, Codex, Cursor, OpenCode, HTTP, Bash | **Paperclip** |
| **Work Tracking** | Work Orders (custom lifecycle) | Issues + Projects + Goals hierarchy | **Tie** |
| **Governance** | Governor Policy Engine (80+ actions, 3 risk tiers) | Board-level approvals, rollback | **ClawControl** |
| **Multi-Tenancy** | Single workspace | Multi-company isolation | **Paperclip** |
| **Cost Management** | Token usage analytics, cost tracking | Per-agent monthly budgets with auto-throttling | **Paperclip** |
| **Authentication** | Session-based (local-first) | Better Auth + JWT agent auth | **Paperclip** |
| **Secrets Management** | Environment variables only | Encrypted local + external provider registry | **Paperclip** |
| **Database** | SQLite (local-first) | PostgreSQL (production-grade) | **Context-dependent** |
| **Org Structure** | Teams with hierarchy JSON | Full org charts with visual rendering | **Paperclip** |
| **Goal Alignment** | Work Order priorities (P0-P3) | Goals → Projects → Issues traceability chain | **Paperclip** |
| **Desktop App** | Electron wrapper | None (web-only) | **ClawControl** |
| **Workflow Engine** | YAML-defined multi-stage workflows | N/A (simpler task routing) | **ClawControl** |
| **Plugin/Skill Marketplace** | ClawHub integration, plugin system | None | **ClawControl** |
| **Real-time Monitoring** | WebSocket + SSE (activities, receipts, OpenClaw events) | WebSocket live events | **ClawControl** |
| **Security Scanning** | Artifact scanning, path safety, allowlists | None apparent | **ClawControl** |
| **CLI Tool** | None (web/desktop UI only) | Dedicated CLI (`npx paperclipai onboard`) | **Paperclip** |
| **Heartbeat/Scheduling** | Cron jobs with UI management | Heartbeats with scheduled + event-triggered wakeups | **Paperclip** |
| **Deployment** | Local-first, Docker, Electron | Docker Compose, PostgreSQL, cloud-ready | **Paperclip** |
| **Inbox/Notifications** | Activity stream | Dedicated Inbox page | **Paperclip** |
| **Issue Labels/Tags** | None (priority only) | Labels system with issue tagging | **Paperclip** |
| **Attachments** | Artifacts (PR links, docs, screenshots) | Issue attachments | **Tie** |
| **Comments/Discussion** | Activity audit trail | Issue comments, approval comments | **Paperclip** |
| **RBAC/Permissions** | Agent roles (Worker/Manager/CEO/Guard) | Instance user roles, principal permission grants, agent permissions | **Paperclip** |
| **Invitation System** | None | Invites, join requests, landing page | **Paperclip** |
| **Agent Config Versioning** | Template system | Agent config revisions with history | **Paperclip** |

---

## 2. Features ClawControl Should Adopt

### Priority 1: High Impact, Clear Gaps

#### 2.1 Multi-Runtime Agent Support
**What Paperclip does:** Supports 5+ agent runtimes out of the box — OpenClaw, Claude Code (local), Codex (local), Cursor (local), OpenCode (local), plus HTTP and process-based adapters. Each adapter is a separate package in `packages/adapters/`.

**Why it matters:** ClawControl is locked to OpenClaw via `packages/adapters-openclaw`. Users running Claude Code, Codex, or Cursor agents cannot use ClawControl. This is the single biggest competitive disadvantage.

**Recommendation:** Refactor `adapters-openclaw` into a generic adapter interface. Create a `packages/adapters/` directory with individual adapter packages (e.g., `adapter-claude-code`, `adapter-codex`, `adapter-cursor`). Define a common `AgentAdapter` interface with methods like `spawn()`, `sendMessage()`, `getStatus()`, `stop()`.

---

#### 2.2 Per-Agent Budget Controls with Auto-Throttling
**What Paperclip does:** Each agent has a monthly cost budget. When the budget is exhausted, the agent is automatically throttled — no human intervention needed. Cost events are tracked per-agent in a `cost_events` table.

**Why it matters:** ClawControl tracks token usage and costs in aggregate (daily/hourly) but has no per-agent budgets or automatic throttling. For production deployments, runaway agent costs are a real risk.

**Recommendation:** Add `monthly_budget` and `budget_alert_threshold` fields to the Agent model. Create a `CostGuard` middleware that checks remaining budget before dispatching operations. Add a budget management UI to the agent detail page.

---

#### 2.3 Goal → Project → Task Hierarchy
**What Paperclip does:** Three-tier goal alignment: Company Goals → Projects → Issues. Every task traces back to a business objective. Projects can have multiple goals (`project_goals` join table) and workspaces (`project_workspaces`).

**Why it matters:** ClawControl's work orders are flat — they have priorities (P0-P3) but no connection to higher-level business goals. This makes it hard to answer "what percentage of work is aligned to our Q1 objectives?"

**Recommendation:** Add a `Goal` model (title, description, status, target_date). Add a `Project` model that groups work orders and links to goals. Add a goals dashboard page showing alignment and progress.

---

#### 2.4 Secrets Management
**What Paperclip does:** Provider-based secrets management with local encrypted storage and external provider stubs. Secrets are versioned (`company_secret_versions`), scoped to companies, and managed through a dedicated API.

**Why it matters:** ClawControl relies on environment variables for secrets, which is insecure for multi-agent environments where different agents need different API keys. There's no encryption, no rotation, no audit trail for secret access.

**Recommendation:** Implement a secrets provider system. Start with a local encrypted provider (AES-256-GCM). Add a secrets management page in settings. Support per-agent secret scoping. Log secret access in the activity trail.

---

#### 2.5 CLI Tool
**What Paperclip does:** Offers `npx paperclipai onboard` for quick setup and a full CLI package for server management.

**Why it matters:** ClawControl requires cloning the repo and running npm commands manually. A CLI would dramatically improve onboarding and enable headless/CI operations.

**Recommendation:** Create a `packages/cli` package with commands: `clawcontrol init`, `clawcontrol start`, `clawcontrol agents list`, `clawcontrol work-orders create`, etc. Publish to npm as `@clawcontrol/cli`.

---

### Priority 2: Medium Impact, Worthwhile Additions

#### 2.6 Multi-Company / Multi-Tenant Support
**What Paperclip does:** Single deployment runs multiple isolated companies. Each company has its own agents, projects, goals, secrets, and cost tracking. Companies have memberships and settings.

**Why it matters:** ClawControl is single-workspace. For agencies or teams managing multiple projects, they need separate ClawControl instances. Multi-tenancy would enable a single deployment to serve multiple teams or clients.

**Recommendation:** Add a `Company` model as a top-level scope. Scope all existing models (work orders, agents, operations) to a company. Add company switching UI. This is a significant refactor — consider it for v1.0.

---

#### 2.7 Inbox / Notification Center
**What Paperclip does:** Dedicated `Inbox.tsx` page for notifications, likely aggregating approvals, mentions, and status changes.

**Why it matters:** ClawControl has an activity stream but no personalized notification center. Users must watch the live console or check the approvals page to know when action is needed.

**Recommendation:** Add a notification system. Aggregate pending approvals, blocked work orders, agent errors, and completed operations into a single inbox view. Add badge counts in the sidebar.

---

#### 2.8 Agent Config Revision History
**What Paperclip does:** Tracks `agent_config_revisions` — every change to an agent's configuration is versioned, enabling rollback and audit.

**Why it matters:** ClawControl's agent templates are static. If someone changes an agent's model or capabilities, the previous config is lost. No rollback capability exists.

**Recommendation:** Add an `AgentConfigRevision` model that snapshots agent configuration on every change. Show revision history on the agent detail page with diff view and rollback button.

---

#### 2.9 User Authentication & RBAC
**What Paperclip does:** Full auth system via Better Auth, instance-level user roles, principal permission grants, invite system with landing pages, and join requests.

**Why it matters:** ClawControl has no user authentication — it relies on local-only networking for security. This limits deployment scenarios (no shared team access, no cloud deployment, no audit of who did what among human users).

**Recommendation:** Add optional authentication (off by default for local-first). Use a lightweight auth library. Add user roles (admin, operator, viewer). Track which human user performed actions in the activity trail.

---

#### 2.10 Issue Labels/Tags System
**What Paperclip does:** Flexible labeling system with `labels` and `issue_labels` tables. Issues can have multiple labels for categorization and filtering.

**Why it matters:** ClawControl work orders only have priority levels. No way to tag work orders by component, team, epic, or custom categories.

**Recommendation:** Add a `Label` model (name, color). Add a `WorkOrderLabel` join table. Add label filtering to work order list views. Allow custom label creation.

---

#### 2.11 Comments & Discussion Threads
**What Paperclip does:** Issue comments (`issue_comments`) and approval comments (`approval_comments`) enable discussion on work items and decisions.

**Why it matters:** ClawControl logs activities but has no way for humans (or agents) to have threaded discussions on work orders or approvals. Context and decisions are scattered across activity logs.

**Recommendation:** Add a `Comment` model linked to work orders and approvals. Add a comment thread UI on work order and approval detail pages.

---

### Priority 3: Nice-to-Have, Consider Later

#### 2.12 Event-Triggered Agent Wakeups
**What Paperclip does:** Beyond scheduled cron heartbeats, agents can be woken by events (`agent_wakeup_requests`). This enables reactive agent behavior — e.g., "wake the QA agent when a PR is opened."

**Recommendation:** Add webhook-triggered agent activation alongside existing cron support.

#### 2.13 Org Chart Visualization
**What Paperclip does:** Visual org chart page (`OrgChart.tsx`) showing reporting structure.

**Recommendation:** ClawControl already has team hierarchies. Add an interactive visualization using a tree/graph library.

#### 2.14 "My Issues" Personal Dashboard
**What Paperclip does:** `MyIssues.tsx` page showing work assigned to the current user.

**Recommendation:** Add a "My Work" view filtering work orders and operations by the current user's assignments.

#### 2.15 Company Portability (Import/Export)
**What Paperclip does:** `company-portability.ts` service for importing/exporting entire company configurations.

**Recommendation:** ClawControl already has package import/export. Extend it to include full workspace snapshots.

---

## 3. What ClawControl Does Better

ClawControl has significant advantages that should be preserved:

| Strength | Details |
|---|---|
| **Governor Policy Engine** | 80+ typed action policies with 3-tier risk classification. Paperclip's approvals are simpler with no action-level granularity. |
| **YAML Workflow Engine** | Multi-stage workflow definitions with stage routing. Paperclip has no equivalent workflow orchestration. |
| **Plugin & Skill Marketplace** | ClawHub integration with versioned skills, security scanning, and marketplace discovery. Paperclip has no plugin ecosystem. |
| **Security Scanning** | Artifact scanning, path safety allowlists, security alerts. Paperclip has no equivalent. |
| **Real-time Observability** | Triple-stream SSE (activities, receipts, OpenClaw events), error signature aggregation, tool usage analytics. More sophisticated than Paperclip's single WebSocket. |
| **Desktop App** | Electron wrapper for native experience. Paperclip is web-only. |
| **Code Editor Integration** | CodeMirror 6 with JSON/YAML/Markdown support for in-app editing. |
| **Local-First Architecture** | SQLite + loopback networking = zero external dependencies. Better for individual developers and air-gapped environments. |
| **Operation Loop Execution** | Story-based multi-iteration operations with per-iteration acceptance criteria. Unique feature. |
| **Typed Confirmations** | NONE/CONFIRM/WO_CODE confirmation modes for governance. More granular than Paperclip's approval system. |

---

## 4. Architecture & Technical Recommendations

### 4.1 Adapter Abstraction Layer
```
Current:  packages/adapters-openclaw/
Proposed: packages/adapters/
            ├── adapter-interface/     # Common AgentAdapter interface
            ├── adapter-openclaw/      # Existing, refactored
            ├── adapter-claude-code/   # New
            ├── adapter-codex/         # New
            ├── adapter-cursor/        # New
            └── adapter-utils/         # Shared utilities
```

### 4.2 Database Considerations
Paperclip uses PostgreSQL, which enables multi-tenancy, concurrent writes, and cloud deployment. Consider offering PostgreSQL as an alternative to SQLite for production deployments while keeping SQLite as the local-first default.

### 4.3 Auth Architecture
Add optional auth behind a feature flag:
- `AUTH_ENABLED=false` (default): Current local-first behavior
- `AUTH_ENABLED=true`: Better Auth or similar lightweight auth, user roles, invite system

---

## 5. Prioritized Roadmap Recommendation

| Phase | Features | Effort |
|---|---|---|
| **v0.21** | Per-agent budget controls, labels/tags, comments | Small |
| **v0.22** | Multi-runtime adapter interface, Claude Code adapter | Medium |
| **v0.23** | Secrets management, agent config versioning | Medium |
| **v0.24** | CLI tool, inbox/notifications | Medium |
| **v0.25** | Goal hierarchy (Goals → Projects → Work Orders) | Medium |
| **v0.26** | Optional authentication & RBAC | Large |
| **v1.0** | Multi-tenancy, event-triggered wakeups, org chart viz | Large |

---

## 6. Conclusion

Paperclip's primary advantages over ClawControl are:

1. **Multi-runtime support** — the most critical gap
2. **Cost budgeting** — operational necessity for production
3. **Goal alignment hierarchy** — strategic planning capability
4. **Secrets management** — security requirement
5. **CLI onboarding** — developer experience

ClawControl's primary advantages to preserve:

1. **Governor Policy Engine** — best-in-class governance granularity
2. **YAML Workflow Engine** — sophisticated orchestration
3. **Plugin/Skill Marketplace** — extensibility ecosystem
4. **Security Scanning** — defense-in-depth
5. **Local-First Architecture** — zero-dependency deployment

The recommended strategy is to adopt Paperclip's organizational primitives (goals, budgets, secrets, multi-runtime) while preserving ClawControl's governance and workflow strengths. This combination would create a platform that is both more capable operationally and more secure than either tool alone.
