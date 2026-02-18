import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DropdownMenu,
  dropdownMenuClasses,
  SelectDropdown,
  selectDropdownClasses,
} from '@clawcontrol/ui'

const appRoot = resolve(process.cwd())

const migratedFiles = [
  'app/(dashboard)/runs/runs-client.tsx',
  'app/(dashboard)/live/live-client.tsx',
  'app/(dashboard)/approvals/approvals-client.tsx',
  'app/(dashboard)/gateway-live/components/graph-header.tsx',
  'app/(dashboard)/agents/hierarchy-view.tsx',
  'app/(dashboard)/memory/memory-client.tsx',
  'app/(dashboard)/workspace/workspace-client.tsx',
  'components/workflows/workflow-editor-modal.tsx',
  'components/kanban/kanban-card.tsx',
  'app/(dashboard)/skills/skills-client.tsx',
  'app/(dashboard)/work-orders/work-orders-client.tsx',
  'app/(dashboard)/agents/agents-client.tsx',
  'app/(dashboard)/agents/teams-tab.tsx',
]

const selectDropdownFiles = [
  'app/(dashboard)/runs/runs-client.tsx',
  'app/(dashboard)/live/live-client.tsx',
  'app/(dashboard)/approvals/approvals-client.tsx',
  'app/(dashboard)/gateway-live/components/graph-header.tsx',
  'app/(dashboard)/agents/hierarchy-view.tsx',
  'app/(dashboard)/memory/memory-client.tsx',
  'app/(dashboard)/workspace/workspace-client.tsx',
  'components/workflows/workflow-editor-modal.tsx',
  'components/kanban/kanban-card.tsx',
  'app/(dashboard)/skills/skills-client.tsx',
  'app/(dashboard)/work-orders/work-orders-client.tsx',
  'app/(dashboard)/agents/agents-client.tsx',
  'app/(dashboard)/agents/teams-tab.tsx',
]

const dropdownMenuFiles = [
  'app/(dashboard)/workspace/workspace-client.tsx',
]

function fileContent(relativePath: string): string {
  return readFileSync(resolve(appRoot, relativePath), 'utf8')
}

describe('dropdown style contract', () => {
  it('disallows native select usage in migrated files', () => {
    for (const relativePath of migratedFiles) {
      const content = fileContent(relativePath)
      expect(content, `${relativePath} still uses native select`).not.toMatch(/<select\b/)
    }
  })

  it('disallows legacy ad-hoc dropdown state flags in migrated files', () => {
    const legacyPatterns = [
      /\bshowCreateMenu\b/,
      /\bshowModelSelector\b/,
      /\bshowFallbackSelector\b/,
      /\bshowStationSelector\b/,
    ]
    for (const relativePath of migratedFiles) {
      const content = fileContent(relativePath)
      for (const pattern of legacyPatterns) {
        expect(content, `${relativePath} still uses legacy pattern ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it('uses SelectDropdown and DropdownMenu primitives in designated files', () => {
    for (const relativePath of selectDropdownFiles) {
      const content = fileContent(relativePath)
      expect(content, `${relativePath} must use SelectDropdown`).toMatch(/\bSelectDropdown\b/)
    }
    for (const relativePath of dropdownMenuFiles) {
      const content = fileContent(relativePath)
      expect(content, `${relativePath} must use DropdownMenu`).toMatch(/\bDropdownMenu\b/)
    }
  })
})

describe('dropdown primitive contracts', () => {
  it('selectDropdownClasses exposes canonical toolbar and field styles', () => {
    const toolbar = selectDropdownClasses({ tone: 'toolbar', size: 'sm' })
    const field = selectDropdownClasses({ tone: 'field', size: 'md' })
    expect(toolbar.trigger).toContain('bg-bg-3')
    expect(toolbar.trigger).toContain('text-xs')
    expect(field.trigger).toContain('bg-bg-2')
    expect(field.menu).toContain('bg-bg-2')
    expect(field.optionSelected).toContain('bg-bg-3')
    expect(field.searchInput).toContain('focus:ring-status-info/40')
  })

  it('dropdownMenuClasses exposes canonical menu styles', () => {
    const classes = dropdownMenuClasses({ size: 'sm' })
    expect(classes.trigger).toContain('bg-bg-2')
    expect(classes.menu).toContain('bg-bg-2')
    expect(classes.itemNormal).toContain('hover:bg-bg-3')
    expect(classes.itemDanger).toContain('text-status-danger')
  })

  it('select and menu markup include accessibility roles and attributes', () => {
    const selectMarkup = renderToStaticMarkup(
      createElement(SelectDropdown, {
        value: 'one',
        onChange: () => {},
        open: true,
        search: false,
        ariaLabel: 'Select example',
        options: [
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ],
      })
    )

    const menuMarkup = renderToStaticMarkup(
      createElement(DropdownMenu, {
        trigger: 'Actions',
        open: true,
        ariaLabel: 'Menu example',
        onSelect: () => {},
        items: [
          { id: 'new', label: 'New File' },
          { id: 'delete', label: 'Delete', danger: true },
        ],
      })
    )

    expect(selectMarkup).toContain('aria-haspopup="listbox"')
    expect(selectMarkup).toContain('role="listbox"')
    expect(selectMarkup).toContain('role="option"')
    expect(selectMarkup).toContain('aria-selected="true"')

    expect(menuMarkup).toContain('aria-haspopup="menu"')
    expect(menuMarkup).toContain('role="menu"')
    expect(menuMarkup).toContain('role="menuitem"')
  })
})
