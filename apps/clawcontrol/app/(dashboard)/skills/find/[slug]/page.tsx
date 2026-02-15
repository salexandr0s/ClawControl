import { getAgents } from '@/lib/data'
import { SkillDetailClient } from './skill-detail-client'

export default async function FindSkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const agents = await getAgents()
  return <SkillDetailClient slug={slug} agents={agents} />
}

