import { getTemplates } from '@/lib/templates'
import { AgentTemplatesClient } from './agent-templates-client'

export default async function AgentTemplatesPage() {
  const templates = getTemplates()

  return <AgentTemplatesClient templates={templates} />
}
