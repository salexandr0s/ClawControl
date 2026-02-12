import { create } from 'zustand'
import { agentsApi, operationsApi } from '@/lib/http'
import type { AgentDTO, OperationDTO } from '@/lib/repo'

export const AGENTS_TAB_STALE_TIME_MS = 45_000

interface AgentsTabSnapshot {
  agents: AgentDTO[]
  operations: OperationDTO[]
  fetchedAt: number | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
}

type AgentsTabStore = AgentsTabSnapshot

const INITIAL_STATE: AgentsTabSnapshot = {
  agents: [],
  operations: [],
  fetchedAt: null,
  isLoading: true,
  isRefreshing: false,
  error: null,
}

let inFlight: Promise<{ agents: AgentDTO[]; operations: OperationDTO[] }> | null = null

export const useAgentsTabStore = create<AgentsTabStore>(() => ({
  ...INITIAL_STATE,
}))

async function fetchAgentsTabData(): Promise<{ agents: AgentDTO[]; operations: OperationDTO[] }> {
  const [agentsResult, opsResult] = await Promise.all([
    agentsApi.list({
      mode: 'light',
      includeSessionOverlay: false,
      includeModelOverlay: true,
      syncSessions: false,
      cacheTtlMs: 5000,
    }),
    operationsApi.list(),
  ])

  return {
    agents: agentsResult.data,
    operations: opsResult.data,
  }
}

function hasFreshData(state: AgentsTabSnapshot): boolean {
  if (state.fetchedAt === null) return false
  return (Date.now() - state.fetchedAt) < AGENTS_TAB_STALE_TIME_MS
}

export async function revalidateAgentsTabCache(
  options: { force?: boolean; blocking?: boolean } = {}
): Promise<{ agents: AgentDTO[]; operations: OperationDTO[] }> {
  const force = options.force === true
  const state = useAgentsTabStore.getState()

  if (!force && hasFreshData(state)) {
    return {
      agents: state.agents,
      operations: state.operations,
    }
  }

  if (inFlight) return inFlight

  const blocking = options.blocking ?? state.fetchedAt === null
  useAgentsTabStore.setState({
    isLoading: blocking,
    isRefreshing: !blocking,
    error: null,
  })

  inFlight = fetchAgentsTabData()
    .then((data) => {
      useAgentsTabStore.setState({
        agents: data.agents,
        operations: data.operations,
        fetchedAt: Date.now(),
        error: null,
      })
      return data
    })
    .catch((err) => {
      useAgentsTabStore.setState({
        error: err instanceof Error ? err.message : 'Failed to load agents',
      })
      throw err
    })
    .finally(() => {
      inFlight = null
      useAgentsTabStore.setState({
        isLoading: false,
        isRefreshing: false,
      })
    })

  return inFlight
}

export function resetAgentsTabCacheForTests(): void {
  inFlight = null
  useAgentsTabStore.setState({ ...INITIAL_STATE })
}
