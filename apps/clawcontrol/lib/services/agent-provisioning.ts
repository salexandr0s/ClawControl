import 'server-only'

import type { StationId } from '@clawcontrol/core'

export const BUILD_REVIEW_EXEC_ALLOWLIST = [
  'npm test',
  'npm run',
  'pnpm test',
  'pnpm run',
  'yarn test',
  'yarn run',
  'pytest',
  'go test',
  'cargo test',
] as const

export function buildCapabilitiesForTemplate(input: {
  templateId: string
  stationId: StationId
}): Record<string, unknown> {
  const templateId = input.templateId
  const stationId = input.stationId

  const capabilities: Record<string, unknown> = {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
    can_web_search: false,
  }

  // Stage routing hints
  capabilities[stationId] = true
  capabilities[templateId] = true

  switch (templateId) {
    case 'manager': {
      capabilities.can_delegate = true
      capabilities.can_send_messages = true
      break
    }
    case 'research': {
      capabilities.can_web_search = true
      break
    }
    case 'build': {
      capabilities.can_execute_code = true
      capabilities.can_modify_files = true
      break
    }
    case 'ui': {
      capabilities.can_execute_code = true
      capabilities.can_modify_files = true
      break
    }
    case 'ops': {
      capabilities.can_execute_code = true
      capabilities.can_modify_files = true
      break
    }
    case 'build_review': {
      capabilities.can_execute_code = true
      capabilities.exec_allowlist = [...BUILD_REVIEW_EXEC_ALLOWLIST]
      break
    }
    case 'security': {
      // Security stages must resolve to a dedicated security specialist.
      capabilities.security = true
      break
    }
    default: {
      break
    }
  }

  return capabilities
}

