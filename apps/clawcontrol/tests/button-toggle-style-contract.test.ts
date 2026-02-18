import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { buttonVariants, SegmentedToggle } from '@clawcontrol/ui'

const appRoot = resolve(process.cwd())

const migratedFiles = [
  'app/(dashboard)/agents/agents-client.tsx',
  'app/(dashboard)/skills/skills-client.tsx',
  'app/(dashboard)/cron/cron-client.tsx',
  'app/(dashboard)/memory/memory-client.tsx',
  'app/(dashboard)/workspace/workspace-client.tsx',
  'app/(dashboard)/models/models-client.tsx',
  'app/(dashboard)/models/components/add-model-modal.tsx',
  'app/(dashboard)/work-orders/work-orders-client.tsx',
  'app/(dashboard)/work-orders/[id]/work-order-detail.tsx',
  'app/(dashboard)/settings/page.tsx',
  'app/(dashboard)/plugins/plugins-client.tsx',
  'app/(dashboard)/workflows/workflows-client.tsx',
  'app/(dashboard)/security/security-client.tsx',
  'app/(dashboard)/agent-templates/agent-templates-client.tsx',
  'app/(dashboard)/agents/teams-tab.tsx',
  'app/(dashboard)/agents/stations-tab.tsx',
  'app/(dashboard)/maintenance/maintenance-client.tsx',
  'app/(dashboard)/gateway-live/gateway-live-client.tsx',
  'app/(dashboard)/live/live-client.tsx',
  'components/workflows/workflow-editor-modal.tsx',
  'components/packages/import-package-modal.tsx',
  'components/editors/markdown-editor.tsx',
  'components/editors/json-editor.tsx',
  'components/editors/yaml-editor.tsx',
  'components/file-editor-modal.tsx',
  'components/skill-selector.tsx',
  'app/setup/page.tsx',
]

const toggleFiles = [
  'app/(dashboard)/agents/agents-client.tsx',
  'components/ui/view-toggle.tsx',
  'app/(dashboard)/skills/skills-client.tsx',
  'app/(dashboard)/live/live-client.tsx',
  'app/(dashboard)/cron/cron-client.tsx',
  'app/(dashboard)/memory/memory-client.tsx',
  'app/(dashboard)/settings/page.tsx',
  'components/workflows/workflow-editor-modal.tsx',
]

function fileContent(relativePath: string): string {
  return readFileSync(resolve(appRoot, relativePath), 'utf8')
}

describe('button and toggle style contract', () => {
  it('disallows legacy btn classes in migrated files', () => {
    for (const relativePath of migratedFiles) {
      const content = fileContent(relativePath)
      expect(content, `${relativePath} still uses legacy btn classes`).not.toMatch(/\bbtn-(primary|secondary)\b/)
    }
  })

  it('disallows ad-hoc non-danger primary button colors in migrated files', () => {
    const nonCanonicalPatterns = [
      /bg-status-info\s+text-(?:bg-0|white)/,
      /bg-status-success\s+text-(?:bg-0|white|black)/,
      /bg-status-warning\s+text-(?:bg-0|white|black)/,
    ]

    for (const relativePath of migratedFiles) {
      const content = fileContent(relativePath)
      for (const pattern of nonCanonicalPatterns) {
        expect(content, `${relativePath} matches non-canonical pattern ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('uses shared segmented toggle in designated toggle files', () => {
    for (const relativePath of toggleFiles) {
      const content = fileContent(relativePath)
      expect(content, `${relativePath} must use SegmentedToggle`).toMatch(/\bSegmentedToggle\b/)
    }
  })

  it('keeps the Agents List/Hierarchy selector on canonical segmented toggle labels', () => {
    const content = fileContent('app/(dashboard)/agents/agents-client.tsx')
    expect(content).toContain('ariaLabel="Agent view"')
    expect(content).toContain("{ value: 'list', label: 'List' }")
    expect(content).toContain("{ value: 'hierarchy', label: 'Hierarchy' }")
  })
})

describe('ui primitive contracts', () => {
  it('buttonVariants exposes canonical classes per variant and size', () => {
    expect(buttonVariants({ variant: 'primary', size: 'sm' })).toContain('bg-status-progress')
    expect(buttonVariants({ variant: 'secondary', size: 'sm' })).toContain('bg-bg-2')
    expect(buttonVariants({ variant: 'danger', size: 'xs' })).toContain('text-status-danger')
    expect(buttonVariants({ variant: 'ghost', size: 'md' })).toContain('bg-transparent')
    expect(buttonVariants({ variant: 'primary', size: 'icon' })).toContain('h-7')
    expect(buttonVariants()).toContain('disabled:opacity-50')
  })

  it('segmented toggle markup includes accessibility attributes', () => {
    const html = renderToStaticMarkup(
      SegmentedToggle({
        value: 'left',
        onChange: () => {},
        items: [
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      })
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('role="radio"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-checked="true"')
  })
})
