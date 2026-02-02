import { getSkills, getAgents } from '@/lib/data'
import { SkillsClient } from './skills-client'

export default async function SkillsPage() {
  const [skills, agents] = await Promise.all([
    getSkills(),
    getAgents(),
  ])

  return <SkillsClient skills={skills} agents={agents} />
}
