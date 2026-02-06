import {
  getAgentHierarchyData,
  type AgentHierarchyData,
} from '@/lib/services/agent-hierarchy'

export async function buildAgentHierarchyApiPayload(
  loader: () => Promise<AgentHierarchyData> = getAgentHierarchyData
): Promise<{ data: AgentHierarchyData }> {
  const data = await loader()
  return { data }
}
