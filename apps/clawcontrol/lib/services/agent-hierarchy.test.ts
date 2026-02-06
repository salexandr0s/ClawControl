import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentHierarchyGraph,
  extractFallbackToolOverlay,
  extractRuntimeToolOverlay,
  extractYamlHierarchy,
  type AgentHierarchySourceStatus,
} from './agent-hierarchy'
import { buildAgentHierarchyApiPayload } from './agent-hierarchy-api'

function makeSourceStatus(): AgentHierarchySourceStatus {
  return {
    yaml: {
      available: true,
      path: '/workspace/clawcontrol.config.yaml',
    },
    runtime: {
      available: true,
      command: 'config.agents.list.json',
    },
    fallback: {
      available: true,
      used: false,
      path: '/workspace/openclaw/openclaw.json5',
    },
    db: {
      available: true,
      count: 0,
    },
  }
}

test('extractYamlHierarchy extracts reports/delegates/receives and permission hints', () => {
  const parsed = extractYamlHierarchy({
    agents: {
      workerA: {
        name: 'Worker A',
        role: 'builder',
        reports_to: 'managerA',
        delegates_to: ['reviewA'],
        receives_from: ['ceoA'],
        permissions: {
          can_delegate: true,
          can_send_messages: false,
          can_execute_code: true,
          can_modify_files: false,
        },
      },
    },
  })

  assert.equal(parsed.agents.length, 1)
  const worker = parsed.agents[0]

  assert.equal(worker.id, 'workerA')
  assert.equal(worker.reportsTo, 'managerA')
  assert.deepEqual(worker.delegatesTo, ['reviewA'])
  assert.deepEqual(worker.receivesFrom, ['ceoA'])
  assert.equal(worker.capabilities.delegate, true)
  assert.equal(worker.capabilities.message, false)
  assert.equal(worker.capabilities.exec, true)
  assert.equal(worker.capabilities.write, false)
})

test('buildAgentHierarchyGraph normalizes IDs, dedupes edges, keeps external references, and drops self-loops', () => {
  const yaml = extractYamlHierarchy({
    agents: {
      AGENT_A: {
        reports_to: 'AGENT_A',
        delegates_to: ['agent_b', 'AGENT_B'],
        receives_from: ['External_Actor', 'agent_a'],
      },
      agent_b: {},
    },
  })

  const graph = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml,
    runtime: null,
    fallback: null,
    sourceStatus: makeSourceStatus(),
  })

  const delegatesEdges = graph.edges.filter((edge) => edge.type === 'delegates_to')
  assert.equal(delegatesEdges.length, 1)
  assert.equal(delegatesEdges[0].from, 'AGENT_A')
  assert.equal(delegatesEdges[0].to.toLowerCase(), 'agent_b')

  const externalNode = graph.nodes.find((node) => node.normalizedId === 'external_actor')
  assert.ok(externalNode)
  assert.equal(externalNode?.kind, 'external')

  assert.ok(graph.edges.every((edge) => edge.from !== edge.to))
  assert.ok(graph.meta.warnings.some((warning) => warning.code === 'self_loop_dropped'))
})

test('buildAgentHierarchyGraph uses fallback overlay when runtime is missing and prioritizes runtime when available', () => {
  const yaml = extractYamlHierarchy({
    agents: {
      manager: {
        delegates_to: ['worker'],
      },
      worker: {},
    },
  })

  const fallback = extractFallbackToolOverlay({
    tools: {
      agentToAgent: {
        enabled: true,
        allow: ['manager'],
      },
    },
    agents: {
      list: [
        {
          id: 'manager',
          tools: {
            allow: ['exec'],
            deny: [],
          },
        },
      ],
    },
  })

  const runtime = extractRuntimeToolOverlay([
    {
      id: 'manager',
      tools: {
        allow: [],
        deny: ['exec', 'message'],
      },
    },
  ])

  const fallbackGraph = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml,
    runtime: null,
    fallback,
    sourceStatus: {
      ...makeSourceStatus(),
      runtime: { available: false, command: 'config.agents.list.json' },
      fallback: { available: true, used: true, path: '/workspace/openclaw/openclaw.json5' },
    },
  })

  const fallbackManager = fallbackGraph.nodes.find((node) => node.normalizedId === 'manager')
  assert.equal(fallbackManager?.capabilities.exec, true)
  assert.equal(fallbackManager?.capabilities.message, true)

  const runtimeGraph = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml,
    runtime,
    fallback,
    sourceStatus: makeSourceStatus(),
  })

  const runtimeManager = runtimeGraph.nodes.find((node) => node.normalizedId === 'manager')
  assert.equal(runtimeManager?.capabilities.exec, false)
  assert.equal(runtimeManager?.capabilities.message, false)
})

test('can_message edges are inferred from messaging capability and structural targets, with ambiguity warnings when targets are unknown', () => {
  const yamlWithTargets = extractYamlHierarchy({
    agents: {
      manager: {
        delegates_to: ['worker'],
      },
      worker: {},
    },
  })

  const runtimeWithMessage = extractRuntimeToolOverlay([
    {
      id: 'manager',
      tools: {
        allow: ['message'],
        deny: [],
      },
    },
  ])

  const graphWithTargets = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml: yamlWithTargets,
    runtime: runtimeWithMessage,
    fallback: null,
    sourceStatus: makeSourceStatus(),
  })

  assert.ok(
    graphWithTargets.edges.some(
      (edge) => edge.type === 'can_message' && edge.from === 'manager' && edge.to === 'worker'
    )
  )

  const yamlWithoutTargets = extractYamlHierarchy({
    agents: {
      manager: {},
    },
  })

  const ambiguousGraph = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml: yamlWithoutTargets,
    runtime: runtimeWithMessage,
    fallback: null,
    sourceStatus: makeSourceStatus(),
  })

  assert.ok(
    ambiguousGraph.meta.warnings.some(
      (warning) => warning.code === 'messaging_targets_ambiguous' && warning.relatedNodeId === 'manager'
    )
  )
  assert.ok(ambiguousGraph.edges.every((edge) => edge.type !== 'can_message'))
})

test('API payload wrapper returns stable shape', async () => {
  const yaml = extractYamlHierarchy({
    agents: {
      manager: {
        delegates_to: ['worker'],
      },
      worker: {},
    },
  })

  const graphA = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml,
    runtime: null,
    fallback: null,
    sourceStatus: makeSourceStatus(),
  })

  const graphB = buildAgentHierarchyGraph({
    dbAgents: [],
    yaml,
    runtime: null,
    fallback: null,
    sourceStatus: makeSourceStatus(),
  })

  assert.deepEqual(graphA, graphB)

  const payload = await buildAgentHierarchyApiPayload(async () => graphA)

  assert.ok(payload.data)
  assert.ok(Array.isArray(payload.data.nodes))
  assert.ok(Array.isArray(payload.data.edges))
  assert.ok(Array.isArray(payload.data.meta.warnings))
  assert.ok(payload.data.meta.sources.runtime.command === 'config.agents.list.json')
})
