/**
 * Routing templates for Work Order creation
 */

import type { Station } from '../types'

export interface StationConfig {
  station: Station
  title: string
  dependsOn?: Station[]
  parallel?: boolean
}

export interface RoutingTemplate {
  id: string
  name: string
  description: string
  stations: StationConfig[]
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
  return ROUTING_TEMPLATES.find((t) => t.id === id)
}

export function getTemplateNames(): { id: string; name: string }[] {
  return ROUTING_TEMPLATES.map((t) => ({ id: t.id, name: t.name }))
}
