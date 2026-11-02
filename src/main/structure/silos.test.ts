import { describe, expect, test } from 'vitest'
import { buildSilos, effectiveMarkets, parentOf, siloTracksAll } from './silos'

const page = (
  id: string,
  path: string,
  working = false
): { id: string; url: string; working: boolean } => ({
  id,
  url: `https://textbolt.com${path}`,
  working
})

describe('silos from URL folders (FR-19.6)', () => {
  test('builds root, top folders, and nested folders with enough pages', () => {
    const tree = buildSilos(
      [
        page('a', '/blog/'),
        page('b', '/blog/one/', true),
        page('c', '/blog/two/'),
        page('d', '/use-cases/healthcare/x/'),
        page('e', '/use-cases/healthcare/y/'),
        page('f', '/use-cases/healthcare/z/'),
        page('g', '/use-cases/retail/q/'),
        page('h', '/pricing/')
      ],
      new Map(),
      ['mkt-us']
    )
    expect(tree.silos.map((silo) => [silo.path, silo.pageCount, silo.trackedCount])).toEqual([
      ['/', 8, 1],
      ['/blog/', 3, 1],
      ['/use-cases/', 4, 0],
      ['/use-cases/healthcare/', 3, 0]
    ])
    expect(tree.pathOf.get('a')).toBe('/blog/')
    expect(tree.pathOf.get('g')).toBe('/use-cases/')
    expect(tree.pathOf.get('h')).toBe('/')
    expect(tree.silos[3]?.effectiveMarketIds).toEqual(['mkt-us'])
  })

  test('markets and track-all inherit from the nearest folder that sets them', () => {
    const settings = new Map([
      ['/use-cases/', { path: '/use-cases/', trackAll: true, marketIds: ['mkt-uk'] }],
      [
        '/use-cases/healthcare/',
        { path: '/use-cases/healthcare/', trackAll: false, marketIds: null }
      ]
    ])
    expect(effectiveMarkets('/use-cases/healthcare/', settings, ['mkt-us'])).toEqual(['mkt-uk'])
    expect(effectiveMarkets('/blog/', settings, ['mkt-us'])).toEqual(['mkt-us'])
    expect(siloTracksAll('/use-cases/healthcare/', settings)).toBe(true)
    expect(siloTracksAll('/blog/', settings)).toBe(false)
    expect(parentOf('/a/b/')).toBe('/a/')
    expect(parentOf('/a/')).toBe('/')
    expect(parentOf('/')).toBeNull()
  })
})
