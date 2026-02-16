/**
 * Governor - Central Policy Engine for Protected Actions
 *
 * Defines risk levels, confirmation requirements, and approval policies
 * for all actions in the CLAWCONTROL system. This is the single source of truth
 * for "what is dangerous".
 */

import type { ApprovalType, RiskLevel } from '../types'

// Re-export for convenience
export type { ApprovalType, RiskLevel }

// ============================================================================
// TYPES
// ============================================================================

/** Confirmation mode required for an action */
export type ConfirmMode = 'NONE' | 'CONFIRM' | 'WO_CODE'

/** Action kind identifier */
export type ActionKind =
  // Work Order actions
  | 'work_order.ship'
  | 'work_order.cancel'
  | 'work_order.delete'
  // Operation actions
  | 'operation.complete'
  | 'operation.rework'
  // Plugin actions
  | 'plugin.install'
  | 'plugin.enable'
  | 'plugin.disable'
  | 'plugin.uninstall'
  | 'plugin.doctor'
  | 'plugin.edit_config'
  | 'plugin.restart'
  // Skill actions
  | 'skill.install'
  | 'skill.uninstall'
  | 'skill.enable'
  | 'skill.disable'
  | 'skill.edit'
  | 'skill.duplicate_to_agent'
  | 'skill.duplicate_to_global'
  | 'skill.enable_invalid'
  // Gateway actions
  | 'gateway.restart'
  | 'gateway.shutdown'
  | 'gateway.discover'
  // Security actions
  | 'security.audit'
  | 'security.audit.fix'
  // Cron actions
  | 'cron.enable'
  | 'cron.disable'
  | 'cron.run_now'
  // Config actions
  | 'config.agents_md.edit'
  | 'config.soul_overlay.edit'
  | 'config.routing_template.edit'
  // Doctor actions
  | 'doctor.run'
  | 'doctor.fix'
  // Maintenance actions
  | 'maintenance.health_check'
  | 'maintenance.cache_clear'
  | 'maintenance.sessions_reset'
  | 'maintenance.recover_gateway'
  | 'maintenance.greenfield_reset'
  // Agent actions
  | 'agent.create'
  | 'agent.create_from_template'
  | 'agent.provision'
  | 'agent.test'
  | 'agent.restart'
  | 'agent.stop'
  | 'agent.edit'
  | 'agent.delete'
  // Station actions
  | 'station.create'
  | 'station.update'
  | 'station.delete'
  // Template actions
  | 'template.create'
  | 'template.edit'
  | 'template.delete'
  | 'template.import'
  | 'template.export'
  | 'template.use'
  | 'template.use_invalid'
  // Workflow actions
  | 'workflow.create'
  | 'workflow.edit'
  | 'workflow.delete'
  | 'workflow.import'
  | 'workflow.export'
  | 'workflow.clone'
  | 'workflow.selection_update'
  // Agent Team actions
  | 'team.create'
  | 'team.edit'
  | 'team.delete'
  | 'team.import'
  | 'team.export'
  | 'team.deploy'
  | 'team.instantiate_agents'
  // Package actions
  | 'package.import'
  | 'package.deploy'
  | 'package.deploy.override_scan_block'
  | 'package.export'
  // Data actions
  | 'data.export'
  | 'data.import'
  | 'data.reset'
  // Console actions (operator → agent/session messaging)
  | 'console.agent.chat'       // Agent-scoped (routes by agentId)
  | 'console.agent.turn'
  | 'console.session.chat'     // Session-scoped (routes by sessionKey, TRUE injection)
  // Generic actions (fallbacks)
  | 'action.safe'
  | 'action.caution'
  | 'action.danger'

/** Policy for a single action */
export interface ActionPolicy {
  riskLevel: RiskLevel
  confirmMode: ConfirmMode
  /**
   * For CONFIRM mode, override the required typed confirmation string.
   * Defaults to "CONFIRM" when omitted.
   */
  confirmText?: string
  requiresApproval: boolean
  approvalType?: ApprovalType
  description: string
}

// ============================================================================
// POLICY DEFINITIONS
// ============================================================================

/**
 * Central policy mapping for all protected actions.
 * This is the single source of truth for risk classification.
 */
export const ACTION_POLICIES: Record<ActionKind, ActionPolicy> = {
  // Work Order actions
  'work_order.ship': {
    riskLevel: 'caution',
    confirmMode: 'WO_CODE',
    requiresApproval: true,
    approvalType: 'ship_gate',
    description: 'Mark work order as shipped',
  },
  'work_order.cancel': {
    riskLevel: 'caution',
    confirmMode: 'WO_CODE',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Cancel work order',
  },
  'work_order.delete': {
    riskLevel: 'danger',
    confirmMode: 'WO_CODE',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Permanently delete work order',
  },

  // Operation actions
  'operation.complete': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Mark operation as complete',
  },
  'operation.rework': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Send operation back to rework',
  },

  // Plugin actions
  'plugin.install': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'external_side_effect',
    description: 'Install a new plugin',
  },
  'plugin.enable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Enable a disabled plugin',
  },
  'plugin.disable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Disable an active plugin',
  },
  'plugin.uninstall': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Uninstall a plugin',
  },
  'plugin.doctor': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Run plugin diagnostics',
  },
  'plugin.edit_config': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Edit plugin configuration',
  },
  'plugin.restart': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Restart plugins to apply configuration changes',
  },

  // Skill actions
  'skill.install': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'external_side_effect',
    description: 'Install a new skill',
  },
  'skill.uninstall': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Uninstall a skill',
  },
  'skill.enable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Enable a disabled skill',
  },
  'skill.disable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Disable an active skill',
  },
  'skill.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Edit skill configuration',
  },
  'skill.duplicate_to_agent': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Copy skill to agent scope',
  },
  'skill.duplicate_to_global': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Copy skill to global scope (affects all agents)',
  },
  'skill.enable_invalid': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Enable a skill with validation errors',
  },

  // Gateway actions
  'gateway.restart': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Restart the gateway service',
  },
  'gateway.shutdown': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Shutdown the gateway service',
  },
  'gateway.discover': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Discover gateways on the network',
  },

  // Security actions
  'security.audit': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Run security audit',
  },
  'security.audit.fix': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Run security audit and apply safe guardrails',
  },

  // Cron actions
  'cron.enable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'cron_change',
    description: 'Enable a cron job',
  },
  'cron.disable': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'cron_change',
    description: 'Disable a cron job',
  },
  'cron.run_now': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Run a cron job immediately',
  },

  // Config actions
  'config.agents_md.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Edit global AGENTS.md configuration',
  },
  'config.soul_overlay.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Edit agent soul overlay',
  },
  'config.routing_template.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Edit routing template',
  },

  // Doctor actions
  'doctor.run': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Run system diagnostics',
  },
  'doctor.fix': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Apply automatic fixes',
  },

  // Maintenance actions
  'maintenance.health_check': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Run health check',
  },
  'maintenance.cache_clear': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Clear all caches',
  },
  'maintenance.sessions_reset': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Reset all agent sessions',
  },
  'maintenance.recover_gateway': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Run gateway recovery playbook',
  },
  'maintenance.greenfield_reset': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    confirmText: 'RESET_GREENFIELD',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Destructively reset workspace to greenfield state',
  },

  // Agent actions
  'agent.create': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create a new agent',
  },
  'agent.create_from_template': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create an agent from a template',
  },
  'agent.provision': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Provision agent in OpenClaw',
  },
  'agent.test': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Send test message to agent',
  },
  'agent.restart': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Restart an agent',
  },
  'agent.stop': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Stop an agent',
  },
  'agent.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Edit agent configuration',
  },
  'agent.delete': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Delete an agent',
  },

  // Station actions
  'station.create': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create a station',
  },
  'station.update': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Update a station',
  },
  'station.delete': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Delete a station',
  },

  // Template actions
  'template.create': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create a new agent template',
  },
  'template.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Edit an agent template',
  },
  'template.delete': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Delete an agent template',
  },
  'template.import': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'external_side_effect',
    description: 'Import an agent template from zip',
  },
  'template.export': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Export an agent template as zip',
  },
  'template.use': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Use a template to create an agent',
  },
  'template.use_invalid': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Use an invalid template (override validation)',
  },

  // Workflow actions
  'workflow.create': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create a custom workflow',
  },
  'workflow.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Edit a custom workflow',
  },
  'workflow.delete': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Delete a custom workflow',
  },
  'workflow.import': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'external_side_effect',
    description: 'Import workflow definitions',
  },
  'workflow.export': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Export workflow definition',
  },
  'workflow.clone': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Clone workflow into custom workspace',
  },
  'workflow.selection_update': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Update workflow selection overlay rules',
  },

  // Agent team actions
  'team.create': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Create agent team',
  },
  'team.edit': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Edit agent team',
  },
  'team.delete': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Delete agent team',
  },
  'team.import': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'external_side_effect',
    description: 'Import agent team package',
  },
  'team.export': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Export agent team package',
  },
  'team.deploy': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'scope_change',
    description: 'Deploy team package contents',
  },
  'team.instantiate_agents': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Instantiate team agents from templates',
  },

  // Package actions
  'package.import': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Import claw package archive',
  },
  'package.deploy': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Deploy imported claw package',
  },
  'package.deploy.override_scan_block': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    confirmText: 'OVERRIDE_SCAN_BLOCK',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Override blocked security scan and deploy package',
  },
  'package.export': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Export claw package archive',
  },

  // Data actions
  'data.export': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Export data',
  },
  'data.import': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Import data',
  },
  'data.reset': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Reset all data',
  },

  // Console actions (operator → agent/session messaging)
  'console.agent.chat': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Message agent (routes by agentId, not session-scoped)',
  },
  'console.agent.turn': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Spawn agent turn with task',
  },
  'console.session.chat': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: false,
    description: 'Message session (routes by sessionKey, TRUE session injection)',
  },

  // Generic fallbacks
  'action.safe': {
    riskLevel: 'safe',
    confirmMode: 'NONE',
    requiresApproval: false,
    description: 'Safe action',
  },
  'action.caution': {
    riskLevel: 'caution',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Action requiring caution',
  },
  'action.danger': {
    riskLevel: 'danger',
    confirmMode: 'CONFIRM',
    requiresApproval: true,
    approvalType: 'risky_action',
    description: 'Dangerous action',
  },
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the policy for an action kind.
 */
export function getActionPolicy(actionKind: ActionKind): ActionPolicy {
  return ACTION_POLICIES[actionKind]
}

/**
 * Check if an action requires approval.
 */
export function actionRequiresApproval(actionKind: ActionKind): boolean {
  return ACTION_POLICIES[actionKind].requiresApproval
}

/**
 * Check if an action requires typed confirmation.
 */
export function requiresTypedConfirm(actionKind: ActionKind): boolean {
  return ACTION_POLICIES[actionKind].confirmMode !== 'NONE'
}

/**
 * Get the approval type for an action.
 */
export function getApprovalType(actionKind: ActionKind): ApprovalType | undefined {
  return ACTION_POLICIES[actionKind].approvalType
}

/**
 * Validate a typed confirmation value.
 */
export function validateTypedConfirm(
  confirmMode: ConfirmMode,
  inputValue: string,
  workOrderCode?: string,
  expectedConfirmText?: string
): { valid: boolean; error?: string } {
  switch (confirmMode) {
    case 'NONE':
      return { valid: true }

    case 'CONFIRM':
      {
        const expected = (expectedConfirmText ?? 'CONFIRM').trim()
        const normalizedExpected = expected.toUpperCase()
        if (inputValue.trim().toUpperCase() !== normalizedExpected) {
          return { valid: false, error: `Please type "${expected}" to proceed` }
        }
        return { valid: true }
      }

    case 'WO_CODE':
      if (!workOrderCode) {
        return { valid: false, error: 'Work order code is required' }
      }
      if (inputValue.toUpperCase() !== workOrderCode.toUpperCase()) {
        return { valid: false, error: `Please type "${workOrderCode}" to proceed` }
      }
      return { valid: true }

    default:
      return { valid: false, error: 'Unknown confirmation mode' }
  }
}

/**
 * Check if an action is safe (no approval or confirmation needed).
 */
export function isSafeAction(actionKind: ActionKind): boolean {
  const policy = ACTION_POLICIES[actionKind]
  return policy.riskLevel === 'safe' && !policy.requiresApproval && policy.confirmMode === 'NONE'
}
