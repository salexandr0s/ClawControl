# Implementation Prompt: OpenClaw Auto-Discovery

## Goal
Add auto-discovery of local OpenClaw configuration so ClawControl automatically detects the gateway URL, auth token, and available agents without manual configuration.

## Context
- ClawControl runs on the same machine as OpenClaw
- OpenClaw config lives at `~/.openclaw/openclaw.json`
- Agent definitions are in that config under `agents.definitions[]`
- Agent workspace files are at `~/.openclaw/agents/{agentId}/agent/`

## Tasks

### 1. Create discovery module in adapter package

**File:** `packages/adapters-openclaw/src/discovery.ts`

```typescript
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface DiscoveredConfig {
  gatewayUrl: string
  token: string | null
  agents: DiscoveredAgent[]
  configPath: string
}

export interface DiscoveredAgent {
  id: string
  identity?: string
  model?: string
  agentDir?: string
}

/**
 * Discover OpenClaw configuration from local filesystem.
 * Reads ~/.openclaw/openclaw.json and extracts connection + agent info.
 */
export async function discoverLocalConfig(): Promise<DiscoveredConfig | null> {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  
  try {
    const raw = await fs.readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)
    
    return {
      configPath,
      gatewayUrl: config.remote?.url ?? 'http://127.0.0.1:3001',
      token: config.auth?.token ?? null,
      agents: (config.agents?.definitions ?? []).map((a: any) => ({
        id: a.id,
        identity: a.identity,
        model: a.model,
        agentDir: a.agentDir
      }))
    }
  } catch (err) {
    // Config not found or invalid
    return null
  }
}

/**
 * Check if OpenClaw gateway is reachable.
 */
export async function checkGatewayHealth(url: string, token?: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    
    const res = await fetch(`${url}/health`, { headers, signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Read agent SOUL.md if available.
 */
export async function readAgentSoul(agentId: string, agentDir?: string): Promise<string | null> {
  const dir = agentDir ?? path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent')
  const soulPath = path.join(dir, 'SOUL.md')
  
  try {
    return await fs.readFile(soulPath, 'utf-8')
  } catch {
    return null
  }
}
```

### 2. Export from adapter package

**File:** `packages/adapters-openclaw/src/index.ts`

Add export:
```typescript
export * from './discovery'
```

### 3. Create OpenClaw client singleton in app

**File:** `apps/clawcontrol/lib/openclaw-client.ts`

```typescript
import { discoverLocalConfig, checkGatewayHealth, DiscoveredConfig } from '@clawcontrol/adapters-openclaw'

let cachedConfig: DiscoveredConfig | null = null
let lastCheck = 0
const CACHE_TTL = 60_000 // 1 minute

export async function getOpenClawConfig(forceRefresh = false): Promise<DiscoveredConfig | null> {
  const now = Date.now()
  
  if (!forceRefresh && cachedConfig && (now - lastCheck) < CACHE_TTL) {
    return cachedConfig
  }
  
  cachedConfig = await discoverLocalConfig()
  lastCheck = now
  return cachedConfig
}

export async function isGatewayOnline(): Promise<boolean> {
  const config = await getOpenClawConfig()
  if (!config) return false
  return checkGatewayHealth(config.gatewayUrl, config.token ?? undefined)
}
```

### 4. Add API route for discovery

**File:** `apps/clawcontrol/app/api/openclaw/discover/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { getOpenClawConfig, isGatewayOnline } from '@/lib/openclaw-client'

export async function GET() {
  const config = await getOpenClawConfig(true) // force refresh
  
  if (!config) {
    return NextResponse.json({
      status: 'not_found',
      message: 'OpenClaw config not found at ~/.openclaw/openclaw.json'
    }, { status: 404 })
  }
  
  const online = await isGatewayOnline()
  
  return NextResponse.json({
    status: online ? 'connected' : 'offline',
    gatewayUrl: config.gatewayUrl,
    hasToken: !!config.token,
    agentCount: config.agents.length,
    agents: config.agents.map(a => ({
      id: a.id,
      identity: a.identity ?? a.id
    }))
  })
}
```

### 5. Sync discovered agents to database on startup

**File:** `apps/clawcontrol/lib/sync-agents.ts`

```typescript
import { prisma } from './prisma'
import { getOpenClawConfig } from './openclaw-client'

export async function syncAgentsFromOpenClaw(): Promise<{ added: number; updated: number }> {
  const config = await getOpenClawConfig()
  if (!config) return { added: 0, updated: 0 }
  
  let added = 0, updated = 0
  
  for (const agent of config.agents) {
    const existing = await prisma.agent.findUnique({
      where: { external_id: agent.id }
    })
    
    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          name: agent.identity ?? agent.id,
          model: agent.model,
          status: 'idle',
          last_seen: new Date()
        }
      })
      updated++
    } else {
      await prisma.agent.create({
        data: {
          external_id: agent.id,
          name: agent.identity ?? agent.id,
          type: inferAgentType(agent.id),
          model: agent.model,
          status: 'idle',
          config: {}
        }
      })
      added++
    }
  }
  
  return { added, updated }
}

function inferAgentType(agentId: string): string {
  if (agentId.includes('plan')) return 'planner'
  if (agentId.includes('build')) return 'builder'
  if (agentId.includes('review')) return 'reviewer'
  if (agentId.includes('security')) return 'security'
  if (agentId.includes('manager')) return 'manager'
  return 'worker'
}
```

### 6. Call sync on app startup

**File:** `apps/clawcontrol/app/layout.tsx` or create `apps/clawcontrol/lib/boot.ts`

Add initialization that runs once on server startup:
```typescript
// In a server component or API route that runs early
import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'

// Run once on cold start
let booted = false
export async function ensureBoot() {
  if (booted) return
  booted = true
  
  const result = await syncAgentsFromOpenClaw()
  console.log(`[boot] Synced agents from OpenClaw: ${result.added} added, ${result.updated} updated`)
}
```

### 7. Update Settings UI to show connection status

**File:** `apps/clawcontrol/app/(dashboard)/settings/page.tsx`

Add a section that shows:
- Gateway URL (auto-detected)
- Connection status (green/red indicator)
- Agent count discovered
- "Refresh" button to re-scan

Use the `/api/openclaw/discover` endpoint to fetch status.

## Schema Note

The `agents` table needs an `external_id` column if not present:

```prisma
model Agent {
  id           String   @id @default(cuid())
  external_id  String?  @unique  // OpenClaw agent ID
  name         String
  type         String
  // ... rest of fields
}
```

Check if migration is needed.

## Acceptance Criteria

1. `discoverLocalConfig()` reads `~/.openclaw/openclaw.json` and returns gateway URL, token, and agents
2. `GET /api/openclaw/discover` returns connection status and agent list
3. On app startup, agents from OpenClaw are synced to the database
4. Settings page shows auto-detected connection status
5. No manual configuration required if OpenClaw is installed locally

## Test

```bash
# After implementation, start the app
cd ~/clawd/projects/savORG/apps/clawcontrol
npm run dev

# Check discovery endpoint
curl http://localhost:3000/api/openclaw/discover | jq

# Should return:
# {
#   "status": "connected",
#   "gatewayUrl": "http://127.0.0.1:3001",
#   "hasToken": true,
#   "agentCount": 8,
#   "agents": [...]
# }
```
