# Marketplace (ClawHub) Integration And Security Model

ClawControl includes a first-class **ClawHub Marketplace** browser and installer under:

`Skills -> Find Skills -> Skill detail -> Install`

This integration is designed to be local-only and governed, because marketplace installs and updates are supply-chain risk.

## Data Sources (ClawHub Public HTTP API)

Metadata is fetched from ClawHub's public HTTP API (base: `https://clawhub.ai/api/v1`) via server-side adapter code.

Endpoints used:
- `GET /skills?limit=&cursor=&sort=` (list, with sorts like `downloads`, `stars`, `updated`)
- `GET /search?q=&limit=&highlightedOnly=` (search)
- `GET /skills/{slug}` (skill detail: owner/moderation/stats)
- `GET /skills/{slug}/versions?limit=&cursor=` (version list)
- `GET /skills/{slug}/versions/{version}` (version detail + file manifest)
- `GET /skills/{slug}/file?path=&version=` (file content, used for SKILL.md viewer and lightweight inspection)
- `GET /download?slug=&version=` (zip download for installation)

Important limitation:
- VirusTotal/OpenClaw scan verdicts shown on clawhub.ai are not exposed via the public HTTP API. The UI shows these as "Not available" and emphasizes local checks.

## Local-Only Admin Console

ClawControl remains bound to loopback only (127.0.0.1). The marketplace UI calls local API routes under `/api/clawhub/*`, and those server routes talk to ClawHub over HTTPS.

No LAN/WAN exposure patterns are introduced by this feature.

## Governance: Approval Gate + Typed Confirm + Receipts

Install and uninstall are treated as high-risk operations.

Every install/uninstall:
1. Requires operator auth + CSRF (same as other protected actions).
2. Requires an **approval gate** (`skill.install` / `skill.uninstall`).
3. Requires **typed confirm** per Governor policy.
4. Creates a **receipt** (workOrderId: `system`) recording:
   - slug, version, scope (global or agent list)
   - registry source URL
   - destination path(s)
   - files written/removed
   - local scan warnings
   - final status (success/failure) and error summary

Receipts can be reviewed under the System work order: `/work-orders/system` (Receipts tab).

## Installer Constraints (No Runtime `npx`)

ClawControl does **not** execute `npx clawhub@latest ...` or any marketplace-provided code at runtime.

Installation is implemented as:
- Download a version-pinned zip from ClawHub
- Perform local safety checks (below)
- Extract into the configured workspace under:
  - Global: `/skills/<slug>/`
  - Per-agent: `/agents/<agentSlug>/skills/<slug>/`

## Local Scan Heuristics (Best-Effort)

Marketplace content is untrusted data. Before writing files, ClawControl performs lightweight checks using the ClawHub version file manifest and selective file reads:

- Block install if ClawHub moderation marks `isMalwareBlocked=true`.
- Warn if `isSuspicious=true`.
- Warn on risky paths/types (examples):
  - `hooks/`
  - `*.sh`, `*.ps1`, `*.bat`, `*.cmd`, `*.exe`, `*.dylib`, `*.so`
  - sensitive dotfiles (`.git/`, `.ssh/`, `.env`)
- Warn on large bundles (file count and total bytes thresholds).
- If `package.json` exists, inspect `scripts` and warn if install-related scripts exist:
  - `preinstall`, `install`, `postinstall`, `prepare`

These checks are intentionally conservative and do not attempt deep malware detection.

## Zip Extraction Safety

Extraction enforces:
- Hard zip size limit (20MB) and file read limits for `/file` reads (256KB).
- Strict zip path normalization:
  - reject absolute paths
  - reject `..` traversal
  - reject null bytes / backslashes
- Ignore common OS junk (`__MACOSX/`, `.DS_Store`).
- Require `SKILL.md` or `skill.md` at the bundle root; it is normalized to `skill.md` on disk.
- Writes are only allowed under workspace-validated paths via `validateWorkspacePath()`.
- Staged extraction under `/tools/.clawhub-staging/<uuid>` then rename into place; optional overwrite for updates.

## Per-Agent Scoping Semantics

Per-agent installs are implemented as filesystem scoping:
- Installing "for agent(s)" writes a copy into each agent's own skills directory:
  - `/agents/<agentSlug>/skills/<slug>/`

This avoids assuming the runtime automatically enforces per-agent skill loading. In practice:
- A global install affects all agents.
- An agent install affects only the selected agent(s), because the files live in those agent-specific directories.

