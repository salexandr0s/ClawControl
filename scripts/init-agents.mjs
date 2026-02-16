#!/usr/bin/env node

 

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';

let yaml;
try {
  // js-yaml is already present in this workspace dependency graph.
  const jsYaml = await import('js-yaml');
  yaml = jsYaml.default;
} catch {
  console.error('[init-agents] Missing dependency: js-yaml');
  console.error('[init-agents] Run npm install, then retry.');
  process.exit(1);
}

const ROLES = [
  'build',
  'buildreview',
  'ceo',
  'guard',
  'manager',
  'ops',
  'plan',
  'planreview',
  'research',
  'security',
  'ui',
  'uireview',
];

const ROLE_DISPLAY = {
  build: 'Build',
  buildreview: 'BuildReview',
  ceo: 'CEO',
  guard: 'Guard',
  manager: 'Manager',
  ops: 'Ops',
  plan: 'Plan',
  planreview: 'PlanReview',
  research: 'Research',
  security: 'Security',
  ui: 'UI',
  uireview: 'UIReview',
};

const ROLE_EMOJI_DEFAULTS = {
  build: '🛠️',
  buildreview: '✅',
  ceo: '👔',
  guard: '🛡️',
  manager: '📋',
  ops: '⚙️',
  plan: '🧭',
  planreview: '🔎',
  research: '🔬',
  security: '🔒',
  ui: '🎨',
  uireview: '👀',
};

const ROLE_MODEL_TIER_DEFAULTS = {
  ceo: 'tier_1_reasoning',
  research: 'tier_1_reasoning',
  security: 'tier_1_reasoning',
  guard: 'tier_3_locked',
  plan: 'tier_2_workhorse',
  planreview: 'tier_2_workhorse',
  build: 'tier_2_workhorse',
  buildreview: 'tier_2_workhorse',
  ui: 'tier_2_workhorse',
  uireview: 'tier_3_fast',
  manager: 'tier_2_workhorse',
  ops: 'tier_2_workhorse',
};

const ROLE_PERMISSION_DEFAULTS = {
  guard: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_access_network: false,
    can_quarantine: true,
    can_read_external_input: true,
    can_delegate: false,
  },
  ceo: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: true,
    can_delegate: true,
  },
  manager: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: true,
  },
  research: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
    can_web_search: true,
    can_read_files: true,
  },
  plan: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
  },
  planreview: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
  },
  build: {
    can_execute_code: true,
    can_modify_files: true,
    can_send_messages: false,
    can_delegate: false,
  },
  buildreview: {
    can_execute_code: true,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
  },
  ui: {
    can_execute_code: true,
    can_modify_files: true,
    can_send_messages: false,
    can_delegate: false,
  },
  uireview: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
  },
  ops: {
    can_execute_code: true,
    can_modify_files: true,
    can_send_messages: false,
    can_delegate: false,
  },
  security: {
    can_execute_code: false,
    can_modify_files: false,
    can_send_messages: false,
    can_delegate: false,
    can_veto: true,
  },
};

const ROLE_SOUL = {
  build: {
    role: 'Code implementation based on approved plans.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Modify code and configuration files.',
      'Run tests, linters, and build commands.',
      'Install dependencies when required by the plan.',
    ],
    cannot: [
      'Self-review or approve its own work.',
      'Deploy to production.',
      'Delegate tasks.',
    ],
    output: '`build_output` YAML as defined in `agents/build.md`.',
  },
  buildreview: {
    role: 'QA and code review for builds.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Review code against the approved plan.',
      'Run allowlisted tests and static analysis (`npm test`, `npm run typecheck`, `npm run lint`).',
    ],
    cannot: [
      'Modify source code.',
      'Execute non-allowlisted commands.',
      'Deploy or approve beyond review scope.',
      'Delegate tasks.',
    ],
    output: '`build_review` YAML as defined in `agents/buildreview.md`.',
  },
  ceo: {
    role: 'Strategic interface and final synthesizer.',
    reportsTo: '{{PREFIX_CAPITALIZED}}CEO (main). Final delivery/approval by {{OWNER}}.',
    can: [
      'Interpret intent and clarify goals.',
      'Delegate tasks to {{PREFIX_CAPITALIZED}}Manager only.',
      'Communicate with {{OWNER}}.',
      'Synthesize final outputs and decisions.',
    ],
    cannot: [
      'Write or modify code.',
      'Run commands or access files.',
      'Delegate directly to worker agents.',
    ],
    output: 'Use the response formats defined in `agents/ceo.md`.',
  },
  guard: {
    role: 'Input security screener for all external messages.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Read and analyze external messages.',
      'Classify messages as clean, suspicious, or malicious.',
      'Quarantine and request escalation for ambiguous cases.',
      'Report findings to {{PREFIX_CAPITALIZED}}Manager.',
    ],
    cannot: [
      'Execute code or shell commands.',
      'Modify or create files.',
      'Send messages to external parties.',
      'Access the network.',
      'Delegate tasks to other agents.',
    ],
    output: '`guard_report` YAML as defined in `agents/guard.md`.',
  },
  manager: {
    role: 'Workflow orchestration and state tracking.',
    reportsTo: '{{PREFIX_CAPITALIZED}}CEO (main).',
    can: [
      'Route tasks to the correct workflow.',
      'Dispatch tasks to worker agents in order.',
      'Track state, iterations, and blockers.',
      'Enforce workflow gates and veto rules.',
    ],
    cannot: [
      'Write code or modify files.',
      'Execute commands.',
      'Communicate with {{OWNER}} directly.',
    ],
    output: '`dispatch` and `workflow_result` YAML as defined in `agents/manager.md`.',
  },
  ops: {
    role: 'Infrastructure operations and deployments.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Deploy services and manage infrastructure changes.',
      'Configure monitoring, cron, and system services.',
    ],
    cannot: [
      'Modify application source code.',
      'Skip Security approval.',
      'Delegate tasks.',
    ],
    output: '`ops_output` YAML as defined in `agents/ops.md`.',
  },
  plan: {
    role: 'Implementation planning and sequencing.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Produce structured implementation plans.',
      'Define steps, acceptance criteria, and risks.',
    ],
    cannot: [
      'Write or modify code.',
      'Execute commands.',
      'Delegate tasks.',
    ],
    output: 'Implementation plan format defined in `agents/plan.md`.',
  },
  planreview: {
    role: 'Critical review of implementation plans.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Approve, reject, or request research on plans.',
      'Identify gaps, risks, and ambiguities.',
    ],
    cannot: [
      'Write plans or code.',
      'Execute commands.',
      'Delegate tasks.',
    ],
    output: '`plan_review` YAML as defined in `agents/planreview.md`.',
  },
  research: {
    role: 'Deep research and source-backed findings.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Perform web and doc research.',
      'Read and analyze files and specs.',
      'Compare options and summarize trade-offs.',
    ],
    cannot: [
      'Modify files or run commands.',
      'Present opinions as facts.',
      'Delegate tasks.',
    ],
    output: 'Research report format defined in `agents/research.md`.',
  },
  security: {
    role: 'Security auditor with veto power.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Audit code, configs, and dependencies for vulnerabilities.',
      'Assess security scanner/test artifacts and provide remediation findings.',
    ],
    cannot: [
      'Modify source code.',
      'Deploy changes.',
      'Delegate tasks.',
    ],
    output: '`security_audit` YAML as defined in `agents/security.md`.',
  },
  ui: {
    role: 'Frontend implementation under ui-skills constraints.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Build frontend components and pages.',
      'Implement responsive layouts and motion/react animations.',
    ],
    cannot: [
      'Modify backend code.',
      'Self-review or approve its own work.',
      'Delegate tasks.',
    ],
    output: '`ui_output` YAML as defined in `agents/ui.md`.',
  },
  uireview: {
    role: 'UI QA against ui-skills and accessibility.',
    reportsTo: '{{PREFIX_CAPITALIZED}}Manager.',
    can: [
      'Review UI code for compliance and accessibility.',
      'Run a11y and responsive checks.',
    ],
    cannot: [
      'Modify source code.',
      'Delegate tasks.',
    ],
    output: '`ui_review` YAML as defined in `agents/uireview.md`.',
  },
};

const ROLE_HEARTBEAT_CHECKS = {
  build: [
    'Build tasks blocked by missing approvals or dependencies.',
    'Failing tests on the latest build.',
  ],
  buildreview: [
    'Pending reviews waiting longer than 12 hours.',
    'Critical test failures that block approval.',
  ],
  ceo: [
    'Pending approvals: Guard quarantines, Security vetoes, or escalation requests.',
    'Draft outbound messages awaiting confirmation.',
    'Workflows blocked by iteration caps or timeouts.',
  ],
  guard: [
    'New quarantined items awaiting CEO decision.',
    'Repeated suspicious senders or unusual volume spikes.',
  ],
  manager: [
    'Workflows stalled or blocked.',
    'Review loops at iteration cap.',
    'Missing approvals or veto overrides attempted.',
    'Review outcomes awaiting manager decision (approve/reject/rework/escalate).',
    'Multi-stage coordination integrity (stage order, loop targets, veto handling).',
  ],
  ops: [
    'Failed deploys or rollbacks required.',
    'Monitoring alerts indicating degraded services.',
  ],
  plan: [
    'Plans rejected by PlanReview awaiting revision.',
    'Plans missing required sections or risk analysis.',
  ],
  planreview: [
    'Pending plan reviews waiting longer than 12 hours.',
    'Plans missing security or rollback details.',
  ],
  research: [
    'Assigned research tasks older than 24 hours.',
    'Sources that may be stale for fast-changing topics.',
  ],
  security: [
    'Outstanding security audits awaiting review.',
    'Critical or high findings pending remediation.',
  ],
  ui: [
    'UI tasks blocked by missing plan approval.',
    'Known ui-skills violations that require rework.',
  ],
  uireview: [
    'Pending UI reviews waiting longer than 12 hours.',
    'Critical accessibility issues discovered in recent reviews.',
  ],
};

const GENERATED_AGENT_DOCS = [
  'SOUL.md',
  'HEARTBEAT.md',
  'ONBOARDING.md',
  'CAPABILITIES.md',
  'MEMORY.md',
  'WORKING.md',
  'ANNOUNCEMENT.md',
  '.learnings/LEARNINGS.md',
];

function parseArgs(argv) {
  const args = {
    prefix: undefined,
    owner: undefined,
    manifestPath: undefined,
    force: false,
    dryRun: false,
    help: false,
    positionalPrefix: undefined,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--force') {
      args.force = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg.startsWith('--prefix=')) {
      args.prefix = arg.slice('--prefix='.length);
      continue;
    }
    if (arg === '--prefix') {
      args.prefix = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--owner=')) {
      args.owner = arg.slice('--owner='.length);
      continue;
    }
    if (arg === '--owner') {
      args.owner = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      args.manifestPath = arg.slice('--manifest='.length);
      continue;
    }
    if (arg === '--manifest') {
      args.manifestPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith('-') && args.positionalPrefix === undefined) {
      args.positionalPrefix = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Initialize ClawControl agents from templates.

Usage:
  ./scripts/init-agents.sh [prefix] [--owner NAME] [--force] [--dry-run]
  ./scripts/init-agents.sh --manifest agents-manifest.yaml [--force] [--dry-run]
  node scripts/init-agents.mjs --prefix acme

Options:
  --manifest <path>   YAML manifest with overrides
  --prefix <value>    Lowercase prefix (use empty string for no prefix)
  --owner <name>      Owner name for generated config
  --force             Overwrite existing generated files
  --dry-run           Print planned writes without writing
  --help              Show this help

Notes:
  - Prefix is optional. Empty prefix yields role-only IDs (e.g. build, manager).
  - Default is no prefix unless one is provided.
  - Generates full Phase 1 markdown contracts (\`ACCESS.md\`, \`CONTEXT.md\`, and per-agent onboarding/capabilities/memory docs).
`);
}

function normalizePrefix(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (!/^[a-z0-9]+$/.test(raw)) {
    throw new Error(`Invalid prefix "${input}". Use lowercase letters and numbers only.`);
  }
  return raw;
}

function prefixCapitalized(prefix) {
  if (!prefix) return '';
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function buildAgentId(prefix, role) {
  return prefix ? `${prefix}${role}` : role;
}

function buildAgentName(prefixCap, role) {
  const roleDisplay = ROLE_DISPLAY[role] || role;
  return prefixCap ? `${prefixCap}${roleDisplay}` : roleDisplay;
}

function toTitleCaseFromSnakeCase(value) {
  return String(value)
    .replace(/^can_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPermissionList(permissions) {
  const entries = Object.entries(permissions || {});
  if (entries.length === 0) return '- No explicit permissions defined.';
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, allowed]) => `- ${toTitleCaseFromSnakeCase(key)}: ${allowed ? 'Allowed' : 'Not allowed'}`)
    .join('\n');
}

function resolveRoleFlow(role, prefixCap, owner) {
  const ceoName = buildAgentName(prefixCap, 'ceo');
  const managerName = buildAgentName(prefixCap, 'manager');
  const guardName = buildAgentName(prefixCap, 'guard');

  switch (role) {
    case 'ceo':
      return {
        receivesFrom: [owner, managerName],
        delegatesTo: [managerName],
        handoffTo: [owner],
        escalationTarget: owner,
      };
    case 'manager':
      return {
        receivesFrom: [ceoName, guardName],
        delegatesTo: ROLES
          .filter((item) => !['ceo', 'manager', 'guard'].includes(item))
          .map((item) => buildAgentName(prefixCap, item)),
        handoffTo: [ceoName],
        escalationTarget: ceoName,
      };
    case 'guard':
      return {
        receivesFrom: ['External input pipeline'],
        delegatesTo: [],
        handoffTo: [managerName],
        escalationTarget: managerName,
      };
    case 'build':
      return {
        receivesFrom: [managerName],
        delegatesTo: [],
        handoffTo: [buildAgentName(prefixCap, 'buildreview')],
        escalationTarget: managerName,
      };
    case 'buildreview':
      return {
        receivesFrom: [managerName, buildAgentName(prefixCap, 'build')],
        delegatesTo: [],
        handoffTo: [managerName],
        escalationTarget: managerName,
      };
    case 'plan':
      return {
        receivesFrom: [managerName],
        delegatesTo: [],
        handoffTo: [buildAgentName(prefixCap, 'planreview')],
        escalationTarget: managerName,
      };
    case 'planreview':
      return {
        receivesFrom: [managerName, buildAgentName(prefixCap, 'plan')],
        delegatesTo: [],
        handoffTo: [managerName],
        escalationTarget: managerName,
      };
    case 'ui':
      return {
        receivesFrom: [managerName],
        delegatesTo: [],
        handoffTo: [buildAgentName(prefixCap, 'uireview')],
        escalationTarget: managerName,
      };
    case 'uireview':
      return {
        receivesFrom: [managerName, buildAgentName(prefixCap, 'ui')],
        delegatesTo: [],
        handoffTo: [managerName],
        escalationTarget: managerName,
      };
    default:
      return {
        receivesFrom: [managerName],
        delegatesTo: [],
        handoffTo: [managerName],
        escalationTarget: managerName,
      };
  }
}

function isoDateNow() {
  return new Date().toISOString().slice(0, 10);
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (full, key) => {
    if (!(key in vars)) return full;
    return String(vars[key] ?? '');
  });
}

function hasUnresolvedPlaceholders(content) {
  return /\{\{\s*[A-Z0-9_]+\s*\}\}/.test(content);
}

async function fileExists(absPath) {
  try {
    await fsp.access(absPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureRequiredTemplates(rootDir) {
  const required = [
    ...ROLES.map((role) => `templates/roles/${role}.template.md`),
    'templates/agent/SOUL.template.md',
    'templates/agent/HEARTBEAT.template.md',
    'templates/agent/ONBOARDING.template.md',
    'templates/agent/CAPABILITIES.template.md',
    'templates/agent/MEMORY.template.md',
    'templates/agent/WORKING.template.md',
    'templates/agent/ANNOUNCEMENT.template.md',
    'templates/agent/LEARNINGS.template.md',
    'templates/config/clawcontrol.config.template.yaml',
    'templates/config/agent-entry.template.yaml',
    'templates/global/AGENTS.template.md',
    'templates/global/SOUL.template.md',
    'templates/global/HEARTBEAT.template.md',
    'templates/global/ACCESS.template.md',
    'templates/global/CONTEXT.template.md',
    'templates/global/agents.SOUL.template.md',
    'templates/global/agents.HEARTBEAT.template.md',
  ];

  const missing = [];
  for (const rel of required) {
    const abs = path.join(rootDir, rel);
    if (!(await fileExists(abs))) {
      missing.push(rel);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required templates:\n- ${missing.join('\n- ')}`);
  }
}

async function readManifest(manifestPath, rootDir) {
  if (!manifestPath) return {};

  const abs = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(rootDir, manifestPath);

  if (!(await fileExists(abs))) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const raw = await fsp.readFile(abs, 'utf8');
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Invalid manifest YAML (${manifestPath}): ${err.message}`);
  }

  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Manifest must be a YAML object at the root');
  }

  return parsed;
}

function formatBulletList(items) {
  if (!Array.isArray(items) || items.length === 0) return '- None.';
  return items.map((line) => `- ${String(line)}`).join('\n');
}

function _formatOptionalBulletList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `${items.map((line) => `- ${String(line)}`).join('\n')}\n`;
}

function applyConfigOverrides(config, context) {
  const {
    prefix,
    manifestRoles: _manifestRoles,
    enabledRoles,
    roleModelTierOverrides,
    rolePermissionOverrides,
  } = context;

  const ceoId = buildAgentId(prefix, 'ceo');
  const managerId = buildAgentId(prefix, 'manager');
  const guardId = buildAgentId(prefix, 'guard');

  if (!config || typeof config !== 'object') {
    throw new Error('Rendered config is not a valid YAML object');
  }

  if (!config.agents || typeof config.agents !== 'object') {
    config.agents = {};
  }

  const externalRefs = new Set(['external_input', 'alexandros']);

  for (const role of ROLES) {
    const agentId = buildAgentId(prefix, role);
    const enabled = enabledRoles.get(role) !== false;

    if (!enabled) {
      delete config.agents[agentId];
      continue;
    }

    if (!config.agents[agentId]) {
      config.agents[agentId] = {
        name: ROLE_DISPLAY[role],
        role,
        model_tier: ROLE_MODEL_TIER_DEFAULTS[role],
        permissions: { ...(ROLE_PERMISSION_DEFAULTS[role] || {}) },
      };
    }

    const agent = config.agents[agentId];
    if (roleModelTierOverrides.has(role)) {
      agent.model_tier = roleModelTierOverrides.get(role);
    }

    if (rolePermissionOverrides.has(role)) {
      const mergedPermissions = {
        ...(ROLE_PERMISSION_DEFAULTS[role] || {}),
        ...(agent.permissions || {}),
        ...(rolePermissionOverrides.get(role) || {}),
      };
      agent.permissions = mergedPermissions;
    }
  }

  const enabledAgentIds = new Set(
    ROLES
      .filter((role) => enabledRoles.get(role) !== false)
      .map((role) => buildAgentId(prefix, role))
  );

  function isKnownRef(ref) {
    return enabledAgentIds.has(ref) || externalRefs.has(ref);
  }

  for (const [agentId, agent] of Object.entries(config.agents)) {
    if (Array.isArray(agent.receives_from)) {
      agent.receives_from = agent.receives_from.filter((ref) => isKnownRef(ref));
    }

    if (Array.isArray(agent.delegates_to)) {
      agent.delegates_to = agent.delegates_to.filter((ref) => enabledAgentIds.has(ref));
    }

    if (typeof agent.reports_to === 'string' && !isKnownRef(agent.reports_to)) {
      if (agentId === ceoId) {
        agent.reports_to = 'alexandros';
      } else if (enabledAgentIds.has(managerId) && agentId !== managerId) {
        agent.reports_to = managerId;
      } else if (enabledAgentIds.has(ceoId)) {
        agent.reports_to = ceoId;
      } else {
        agent.reports_to = 'alexandros';
      }
    }

    if (agent.quarantine && typeof agent.quarantine === 'object') {
      if (typeof agent.quarantine.alert_target === 'string' && !enabledAgentIds.has(agent.quarantine.alert_target)) {
        agent.quarantine.alert_target = enabledAgentIds.has(ceoId) ? ceoId : 'alexandros';
      }
    }
  }

  if (config.defaults && typeof config.defaults === 'object') {
    config.defaults.escalation_target = enabledAgentIds.has(ceoId) ? ceoId : 'alexandros';
  }

  if (config.system && typeof config.system === 'object' && !prefix) {
    config.system.name = config.system.name || 'agent-system';
  }

  if (config.agents[ceoId]) {
    config.agents[ceoId].receives_from = [
      'alexandros',
      ...(enabledAgentIds.has(managerId) ? [managerId] : []),
    ];
    config.agents[ceoId].delegates_to = enabledAgentIds.has(managerId) ? [managerId] : [];
    config.agents[ceoId].reports_to = 'alexandros';
  }

  if (config.agents[managerId]) {
    config.agents[managerId].receives_from = [
      ...(enabledAgentIds.has(ceoId) ? [ceoId] : []),
      ...(enabledAgentIds.has(guardId) ? [guardId] : []),
    ];

    config.agents[managerId].delegates_to = ROLES
      .filter((role) => !['ceo', 'manager', 'guard'].includes(role))
      .filter((role) => enabledRoles.get(role) !== false)
      .map((role) => buildAgentId(prefix, role));

    config.agents[managerId].reports_to = enabledAgentIds.has(ceoId) ? ceoId : 'alexandros';
  }

  if (config.agents[guardId]) {
    config.agents[guardId].reports_to = enabledAgentIds.has(managerId)
      ? managerId
      : (enabledAgentIds.has(ceoId) ? ceoId : 'alexandros');
  }

  for (const role of ROLES) {
    if (['ceo', 'manager', 'guard'].includes(role)) continue;
    const agentId = buildAgentId(prefix, role);
    if (!config.agents[agentId]) continue;

    config.agents[agentId].receives_from = enabledAgentIds.has(managerId) ? [managerId] : [];
    config.agents[agentId].reports_to = enabledAgentIds.has(managerId)
      ? managerId
      : (enabledAgentIds.has(ceoId) ? ceoId : 'alexandros');
  }

  if (config.workflows && typeof config.workflows === 'object') {
    for (const workflow of Object.values(config.workflows)) {
      if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.stages)) continue;

      workflow.stages = workflow.stages
        .filter((stage) => typeof stage?.agent === 'string' && enabledAgentIds.has(stage.agent))
        .map((stage) => {
          const next = { ...stage };
          if (typeof next.loop_target === 'string' && !enabledAgentIds.has(next.loop_target)) {
            delete next.loop_target;
          }
          return next;
        });
    }
  }

  if (config.input_pipeline && typeof config.input_pipeline === 'object') {
    if (config.input_pipeline.external && Array.isArray(config.input_pipeline.external.flow)) {
      config.input_pipeline.external.flow = config.input_pipeline.external.flow.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const next = { ...entry };
        if (Object.prototype.hasOwnProperty.call(next, 'on_clean')) {
          next.on_clean = enabledAgentIds.has(managerId)
            ? managerId
            : (enabledAgentIds.has(ceoId) ? ceoId : 'alexandros');
        }
        if (typeof next.on_suspicious === 'string' && !enabledAgentIds.has(ceoId)) {
          next.on_suspicious = next.on_suspicious.replace(ceoId, 'alexandros');
        }
        if (typeof next.on_malicious === 'string' && !enabledAgentIds.has(ceoId)) {
          next.on_malicious = next.on_malicious.replace(ceoId, 'alexandros');
        }
        return next;
      });
    }

    if (config.input_pipeline.internal && Array.isArray(config.input_pipeline.internal.flow)) {
      config.input_pipeline.internal.flow = [
        { agent: enabledAgentIds.has(ceoId) ? ceoId : (enabledAgentIds.has(managerId) ? managerId : 'alexandros') },
      ];
    }
  }
}

function validateWorkflowGateInvariants(config, prefix) {
  if (!config || typeof config !== 'object') {
    throw new Error('Cannot validate workflow gates: config is not an object');
  }

  if (!config.workflows || typeof config.workflows !== 'object') {
    return;
  }

  const planId = buildAgentId(prefix, 'plan');
  const planReviewId = buildAgentId(prefix, 'planreview');
  const buildId = buildAgentId(prefix, 'build');
  const uiId = buildAgentId(prefix, 'ui');
  const opsId = buildAgentId(prefix, 'ops');
  const securityId = buildAgentId(prefix, 'security');
  const errors = [];

  for (const [workflowName, workflow] of Object.entries(config.workflows)) {
    if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.stages)) {
      continue;
    }

    const stages = workflow.stages.filter((stage) => stage && typeof stage.agent === 'string');
    const indexOfAgent = (agentId) => stages.findIndex((stage) => stage.agent === agentId);

    const planReviewIndex = indexOfAgent(planReviewId);
    for (const gatedAgent of [buildId, uiId, opsId]) {
      const gatedIndex = indexOfAgent(gatedAgent);
      if (gatedIndex !== -1 && (planReviewIndex === -1 || planReviewIndex > gatedIndex)) {
        errors.push(`workflow "${workflowName}" must run ${planReviewId} before ${gatedAgent}`);
      }
    }

    const securityIndex = indexOfAgent(securityId);
    const opsIndices = stages
      .map((stage, index) => (stage.agent === opsId ? index : -1))
      .filter((index) => index !== -1);
    if (securityIndex !== -1 && opsIndices.length > 0) {
      const hasOpsAfterSecurity = opsIndices.some((index) => index > securityIndex);
      if (!hasOpsAfterSecurity) {
        errors.push(`workflow "${workflowName}" must include at least one ${opsId} stage after ${securityId}`);
      }
    }

    if (workflowName === 'bug_fix' || workflowName === 'hotfix') {
      const buildIndex = indexOfAgent(buildId);
      const planIndex = indexOfAgent(planId);
      if (buildIndex !== -1 && (planIndex === -1 || planIndex > buildIndex)) {
        errors.push(`workflow "${workflowName}" must run ${planId} before ${buildId}`);
      }
      if (buildIndex !== -1 && (planReviewIndex === -1 || planReviewIndex > buildIndex)) {
        errors.push(`workflow "${workflowName}" must run ${planReviewId} before ${buildId}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Workflow gate invariant violations:\n- ${errors.join('\n- ')}`);
  }
}

async function maybePromptMissingInputs(args, manifest) {
  const shouldPrompt = process.stdin.isTTY && !args.manifestPath;
  if (!shouldPrompt) return {};

  const needsPrefix = args.prefix === undefined && args.positionalPrefix === undefined && manifest.prefix === undefined;
  const needsOwner = args.owner === undefined && manifest.owner === undefined;

  if (!needsPrefix && !needsOwner) return {};

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answers = {};

  try {
    if (needsPrefix) {
      const prefixAnswer = await rl.question('Prefix [none] (type "none" for no prefix): ');
      const normalized = prefixAnswer.trim().toLowerCase();
      if (normalized === 'none' || normalized === '-') {
        answers.prefix = '';
      } else if (normalized) {
        answers.prefix = normalized;
      }
    }

    if (needsOwner) {
      const ownerAnswer = await rl.question('Owner [Workspace Owner]: ');
      if (ownerAnswer.trim()) {
        answers.owner = ownerAnswer.trim();
      }
    }
  } finally {
    rl.close();
  }

  return answers;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = sortObjectKeys(value[key]);
    }
    return out;
  }
  return value;
}

async function main() {
  const rootDir = process.cwd();
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  await ensureRequiredTemplates(rootDir);

  const manifest = await readManifest(args.manifestPath, rootDir);
  const prompts = await maybePromptMissingInputs(args, manifest);

  const prefixInput =
    args.prefix
    ?? args.positionalPrefix
    ?? manifest.prefix
    ?? prompts.prefix
    ?? '';

  const owner = String(
    args.owner
    ?? manifest.owner
    ?? prompts.owner
    ?? 'Workspace Owner'
  ).trim();

  const prefix = normalizePrefix(prefixInput);
  const prefixCap = prefixCapitalized(prefix);

  const manifestRoles = (manifest.roles && typeof manifest.roles === 'object' && !Array.isArray(manifest.roles))
    ? manifest.roles
    : {};

  const heartbeatGlobal =
    manifest.heartbeat
    && typeof manifest.heartbeat === 'object'
    && Array.isArray(manifest.heartbeat.global)
      ? manifest.heartbeat.global
      : [];

  const enabledRoles = new Map();
  const roleEmojis = new Map();
  const roleModelTierOverrides = new Map();
  const rolePermissionOverrides = new Map();

  for (const role of ROLES) {
    const roleOverride = manifestRoles[role] || {};
    const enabled = roleOverride.enabled !== false;
    const emoji = roleOverride.emoji || ROLE_EMOJI_DEFAULTS[role];

    enabledRoles.set(role, enabled);
    roleEmojis.set(role, emoji);
    if (typeof roleOverride.model_tier === 'string' && roleOverride.model_tier.trim()) {
      roleModelTierOverrides.set(role, roleOverride.model_tier.trim());
    }
    if (roleOverride.permissions && typeof roleOverride.permissions === 'object' && !Array.isArray(roleOverride.permissions)) {
      rolePermissionOverrides.set(role, roleOverride.permissions);
    }
  }

  const writes = [];
  const deletes = [];

  function scheduleWrite(relPath, content) {
    writes.push({
      relPath,
      absPath: path.join(rootDir, relPath),
      content,
    });
  }

  function scheduleDelete(relPath) {
    deletes.push({
      relPath,
      absPath: path.join(rootDir, relPath),
    });
  }

  const globalVars = {
    PREFIX: prefix,
    PREFIX_CAPITALIZED: prefixCap,
    OWNER: owner,
    TODAY: isoDateNow(),
    GLOBAL_HEARTBEAT_CHECKS: formatBulletList(heartbeatGlobal),
  };

  const templateAgents = {
    AGENTS: await fsp.readFile(path.join(rootDir, 'templates/global/AGENTS.template.md'), 'utf8'),
    SOUL: await fsp.readFile(path.join(rootDir, 'templates/global/SOUL.template.md'), 'utf8'),
    HEARTBEAT: await fsp.readFile(path.join(rootDir, 'templates/global/HEARTBEAT.template.md'), 'utf8'),
    ACCESS: await fsp.readFile(path.join(rootDir, 'templates/global/ACCESS.template.md'), 'utf8'),
    CONTEXT: await fsp.readFile(path.join(rootDir, 'templates/global/CONTEXT.template.md'), 'utf8'),
    AGENTS_SOUL: await fsp.readFile(path.join(rootDir, 'templates/global/agents.SOUL.template.md'), 'utf8'),
    AGENTS_HEARTBEAT: await fsp.readFile(path.join(rootDir, 'templates/global/agents.HEARTBEAT.template.md'), 'utf8'),
  };

  scheduleWrite('AGENTS.md', renderTemplate(templateAgents.AGENTS, globalVars));
  scheduleWrite('SOUL.md', renderTemplate(templateAgents.SOUL, globalVars));
  scheduleWrite('HEARTBEAT.md', renderTemplate(templateAgents.HEARTBEAT, globalVars));
  scheduleWrite('ACCESS.md', renderTemplate(templateAgents.ACCESS, globalVars));
  scheduleWrite('CONTEXT.md', renderTemplate(templateAgents.CONTEXT, globalVars));
  scheduleWrite('agents/SOUL.md', renderTemplate(templateAgents.AGENTS_SOUL, globalVars));
  scheduleWrite('agents/HEARTBEAT.md', renderTemplate(templateAgents.AGENTS_HEARTBEAT, globalVars));

  const roleTemplateCache = {};
  const soulTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/SOUL.template.md'), 'utf8');
  const heartbeatTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/HEARTBEAT.template.md'), 'utf8');
  const onboardingTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/ONBOARDING.template.md'), 'utf8');
  const capabilitiesTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/CAPABILITIES.template.md'), 'utf8');
  const memoryTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/MEMORY.template.md'), 'utf8');
  const workingTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/WORKING.template.md'), 'utf8');
  const announcementTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/ANNOUNCEMENT.template.md'), 'utf8');
  const learningsTemplate = await fsp.readFile(path.join(rootDir, 'templates/agent/LEARNINGS.template.md'), 'utf8');

  for (const role of ROLES) {
    if (enabledRoles.get(role) === false) {
      scheduleDelete(`agents/${role}.md`);
      for (const rel of GENERATED_AGENT_DOCS) {
        scheduleDelete(`agents/${role}/${rel}`);
      }
      continue;
    }

    const roleDisplay = ROLE_DISPLAY[role];
    const agentId = buildAgentId(prefix, role);
    const agentName = buildAgentName(prefixCap, role);
    const emoji = roleEmojis.get(role);
    const soulData = ROLE_SOUL[role];
    const rolePermissions = {
      ...(ROLE_PERMISSION_DEFAULTS[role] || {}),
      ...(rolePermissionOverrides.get(role) || {}),
    };
    const roleFlow = resolveRoleFlow(role, prefixCap, owner);

    if (!roleTemplateCache[role]) {
      roleTemplateCache[role] = await fsp.readFile(path.join(rootDir, `templates/roles/${role}.template.md`), 'utf8');
    }

    const vars = {
      PREFIX: prefix,
      PREFIX_CAPITALIZED: prefixCap,
      ROLE: role,
      ROLE_CAPITALIZED: roleDisplay,
      AGENT_ID: agentId,
      AGENT_NAME: agentName,
      EMOJI: emoji,
      TODAY: isoDateNow(),
    };

    scheduleWrite(`agents/${role}.md`, renderTemplate(roleTemplateCache[role], vars));

    const soulVars = {
      ...vars,
      SOUL_ROLE: renderTemplate(soulData.role, vars),
      SOUL_REPORTS_TO: renderTemplate(soulData.reportsTo, vars),
      SOUL_CAN: formatBulletList(soulData.can.map((line) => renderTemplate(line, vars))),
      SOUL_CANNOT: formatBulletList(soulData.cannot.map((line) => renderTemplate(line, vars))),
      SOUL_OUTPUT: renderTemplate(soulData.output, vars),
    };

    scheduleWrite(`agents/${role}/SOUL.md`, renderTemplate(soulTemplate, soulVars));

    const roleChecks = ROLE_HEARTBEAT_CHECKS[role] || [];
    const roleHeartbeatVars = {
      ...vars,
      HEARTBEAT_CHECKS: formatBulletList(roleChecks.map((line) => renderTemplate(line, vars))),
      HEARTBEAT_ADDITIONAL_CHECKS: '',
    };
    scheduleWrite(`agents/${role}/HEARTBEAT.md`, renderTemplate(heartbeatTemplate, roleHeartbeatVars));

    const roleCapabilitiesVars = {
      ...vars,
      SOUL_ROLE: renderTemplate(soulData.role, vars),
      CAPABILITIES_CAN: formatBulletList(soulData.can.map((line) => renderTemplate(line, vars))),
      CAPABILITIES_CANNOT: formatBulletList(soulData.cannot.map((line) => renderTemplate(line, vars))),
      CAPABILITIES_OUTPUT: renderTemplate(soulData.output, vars),
      CAPABILITIES_PERMISSIONS: formatPermissionList(rolePermissions),
      CAPABILITIES_RECEIVES_FROM: formatBulletList(roleFlow.receivesFrom),
      CAPABILITIES_DELEGATES_TO: formatBulletList(roleFlow.delegatesTo),
      CAPABILITIES_HANDOFF_TO: formatBulletList(roleFlow.handoffTo),
      CAPABILITIES_ESCALATION_TARGET: roleFlow.escalationTarget,
    };
    scheduleWrite(`agents/${role}/CAPABILITIES.md`, renderTemplate(capabilitiesTemplate, roleCapabilitiesVars));

    const roleOnboardingVars = {
      ...vars,
      ONBOARDING_REQUIRED_DOCS: formatBulletList([
        'AGENTS.md',
        'SOUL.md',
        'HEARTBEAT.md',
        'ACCESS.md',
        'CONTEXT.md',
        `agents/${role}.md`,
        `agents/${role}/SOUL.md`,
        `agents/${role}/HEARTBEAT.md`,
        `agents/${role}/CAPABILITIES.md`,
      ]),
      ONBOARDING_HANDOFF_TO: formatBulletList(roleFlow.handoffTo),
      ONBOARDING_ESCALATION_TARGET: roleFlow.escalationTarget,
    };
    scheduleWrite(`agents/${role}/ONBOARDING.md`, renderTemplate(onboardingTemplate, roleOnboardingVars));

    scheduleWrite(`agents/${role}/MEMORY.md`, renderTemplate(memoryTemplate, roleCapabilitiesVars));
    scheduleWrite(`agents/${role}/WORKING.md`, renderTemplate(workingTemplate, roleCapabilitiesVars));
    scheduleWrite(`agents/${role}/ANNOUNCEMENT.md`, renderTemplate(announcementTemplate, roleCapabilitiesVars));
    scheduleWrite(`agents/${role}/.learnings/LEARNINGS.md`, renderTemplate(learningsTemplate, roleCapabilitiesVars));
  }

  const configTemplatePath = path.join(rootDir, 'templates/config/clawcontrol.config.template.yaml');
  const configTemplateRaw = await fsp.readFile(configTemplatePath, 'utf8');
  const renderedConfigTemplate = renderTemplate(configTemplateRaw, {
    PREFIX: prefix,
    PREFIX_CAPITALIZED: prefixCap,
    PREFIX_UPPER: prefix.toUpperCase(),
    SYSTEM_SLUG: prefix || 'agent-system',
    OWNER: owner,
  });

  const hasRoleOverride = ROLES.some((role) => {
    const cfg = manifestRoles[role];
    if (!cfg || typeof cfg !== 'object') return false;
    return (
      cfg.enabled === false
      || (typeof cfg.model_tier === 'string' && cfg.model_tier.trim().length > 0)
      || (cfg.permissions && typeof cfg.permissions === 'object' && !Array.isArray(cfg.permissions))
    );
  });

  const needsConfigMutation = hasRoleOverride || prefix.length === 0;

  if (!needsConfigMutation) {
    let config;
    try {
      config = yaml.load(renderedConfigTemplate);
    } catch (err) {
      throw new Error(`Config template rendered invalid YAML: ${err.message}`);
    }

    validateWorkflowGateInvariants(config, prefix);
    scheduleWrite('clawcontrol.config.yaml', renderedConfigTemplate);
  } else {
    let config;
    try {
      config = yaml.load(renderedConfigTemplate);
    } catch (err) {
      throw new Error(`Config template rendered invalid YAML: ${err.message}`);
    }

    applyConfigOverrides(config, {
      prefix,
      manifestRoles,
      enabledRoles,
      roleModelTierOverrides,
      rolePermissionOverrides,
    });

    validateWorkflowGateInvariants(config, prefix);

    const dumpedConfig = yaml.dump(sortObjectKeys(config), {
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
      noCompatMode: true,
    });

    const configHeader = [
      '# ============================================================================',
      '# Generated by scripts/init-agents.mjs',
      `# Prefix: ${prefix || '(none)'}`,
      `# Owner: ${owner}`,
      '# ============================================================================',
      '',
    ].join('\n');

    scheduleWrite('clawcontrol.config.yaml', `${configHeader}${dumpedConfig}`);
  }

  const conflicts = [];
  for (const item of writes) {
    if (await fileExists(item.absPath)) {
      conflicts.push(item.relPath);
    }
  }
  for (const item of deletes) {
    if (await fileExists(item.absPath)) {
      conflicts.push(`${item.relPath} (delete)`);
    }
  }

  if (conflicts.length > 0 && !args.force) {
    console.error('[init-agents] Existing files detected. Re-run with --force to overwrite:');
    for (const rel of conflicts) {
      console.error(`  - ${rel}`);
    }
    process.exit(1);
  }

  for (const item of writes) {
    if (hasUnresolvedPlaceholders(item.content)) {
      throw new Error(`Unresolved placeholders in ${item.relPath}`);
    }
  }

  if (args.dryRun) {
    console.log('[init-agents] Dry run complete. Files to write:');
    for (const item of writes) {
      console.log(`  - ${item.relPath}`);
    }
    if (deletes.length > 0) {
      console.log('[init-agents] Files to delete:');
      for (const item of deletes) {
        console.log(`  - ${item.relPath}`);
      }
    }
    return;
  }

  for (const item of deletes) {
    if (!(await fileExists(item.absPath))) continue;
    await fsp.rm(item.absPath, { force: true });
  }

  for (const item of writes) {
    await fsp.mkdir(path.dirname(item.absPath), { recursive: true });
    await fsp.writeFile(item.absPath, item.content.endsWith('\n') ? item.content : `${item.content}\n`, 'utf8');
  }

  console.log('[init-agents] Generated agent system successfully.');
  console.log(`[init-agents] Prefix: ${prefix || '(none)'}`);
  console.log(`[init-agents] Owner: ${owner}`);
  console.log(`[init-agents] Roles enabled: ${ROLES.filter((r) => enabledRoles.get(r) !== false).join(', ')}`);
}

main().catch((err) => {
  console.error(`[init-agents] ${err.message}`);
  process.exit(1);
});
