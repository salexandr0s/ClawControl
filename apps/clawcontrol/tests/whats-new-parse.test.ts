import { describe, expect, it } from 'vitest'
import { extractReleaseHighlights, extractReleaseSections } from '../../clawcontrol-desktop/electron/whats-new'

describe('whats-new highlight extraction', () => {
  it('prefers the Highlights section when present', () => {
    const body = `
# v0.11.0

## Highlights
- New package scanner during import
- Trust badges across the UI

## Installation
- irrelevant
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual([
      'New package scanner during import',
      'Trust badges across the UI',
    ])
  })

  it('falls back to first bullet lines when no Highlights section', () => {
    const body = `
Changelog
- One
- Two
- Three
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual(['One', 'Two', 'Three'])
  })

  it('falls back to first non-empty non-heading lines when no bullets', () => {
    const body = `
## Title

First line.

Second line.

Third line.
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual(['First line.', 'Second line.', 'Third line.'])
  })
})

describe('whats-new section extraction', () => {
  it('prefers changelog-like sections and excludes installation sections', () => {
    const body = `
# v0.14.0

## Installation
- npm install -g clawcontrol
- openclaw login

## Changelog
- Added adaptive usage timeline
- Improved kanban archive filtering

## Improvements
- Better model badges in agents table
    `.trim()

    expect(extractReleaseSections(body)).toEqual([
      {
        title: 'Changelog',
        items: [
          'Added adaptive usage timeline',
          'Improved kanban archive filtering',
        ],
      },
      {
        title: 'Improvements',
        items: ['Better model badges in agents table'],
      },
    ])
  })

  it('filters installation/setup bullets from fallback extraction', () => {
    const body = `
- Setup: run npm install
- Configure env vars
- Fixed dashboard usage chart
- Added archive toggle
    `.trim()

    expect(extractReleaseSections(body)).toEqual([
      {
        title: 'Highlights',
        items: [
          'Fixed dashboard usage chart',
          'Added archive toggle',
        ],
      },
    ])
  })
})
