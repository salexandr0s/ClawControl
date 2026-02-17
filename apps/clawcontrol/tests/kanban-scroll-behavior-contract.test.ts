import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('kanban scroll behavior contract', () => {
  it('keeps column-first vertical scrolling before horizontal remap', async () => {
    const boardFile = join(
      process.cwd(),
      'components',
      'kanban',
      'kanban-board.tsx'
    )
    const source = await readFile(boardFile, 'utf8')

    expect(source).toContain('[data-kanban-scroll-column="true"]')
    expect(source).toContain('scrollColumn.scrollTop + scrollColumn.clientHeight < scrollColumn.scrollHeight')
    expect(source).toContain('board.scrollLeft += event.deltaY')
  })

  it('marks kanban column body as scroll target and does not hide scrollbars', async () => {
    const columnFile = join(
      process.cwd(),
      'components',
      'kanban',
      'kanban-column.tsx'
    )
    const source = await readFile(columnFile, 'utf8')

    expect(source).toContain('data-kanban-scroll-column="true"')
    expect(source).not.toContain('scrollbar-hide')
  })
})
