import { describe, expect, test } from 'vitest'
import { sitemapsFromRobots } from './robots'

const ROBOTS = 'https://textbolt.com/robots.txt'

describe('sitemapsFromRobots', () => {
  test('reads Sitemap lines in any case and any group', () => {
    const text = [
      'User-agent: *',
      'Disallow: /wp-admin/',
      'Sitemap: https://textbolt.com/sitemap_index.xml',
      '',
      'User-agent: Googlebot',
      'SITEMAP:https://cdn.textbolt.com/extra.xml # extra one',
      'sitemap :  https://textbolt.com/sitemap_index.xml'
    ].join('\r\n')
    expect(sitemapsFromRobots(text, ROBOTS)).toEqual([
      'https://textbolt.com/sitemap_index.xml',
      'https://cdn.textbolt.com/extra.xml'
    ])
  })

  test('resolves relative values and drops other schemes and credentials', () => {
    const text = [
      'Sitemap: /post-sitemap.xml',
      'Sitemap: ftp://textbolt.com/x.xml',
      'Sitemap: javascript:alert(1)',
      'Sitemap: https://user:pass@textbolt.com/s.xml',
      '# Sitemap: https://textbolt.com/commented.xml',
      'Sitemap:',
      'Sitemap: https://textbolt.com/page-sitemap.xml#frag'
    ].join('\n')
    expect(sitemapsFromRobots(text, ROBOTS)).toEqual([
      'https://textbolt.com/post-sitemap.xml',
      'https://textbolt.com/page-sitemap.xml'
    ])
  })

  test('caps the number of sitemaps and the file size', () => {
    const many = Array.from(
      { length: 80 },
      (_, index) => `Sitemap: https://textbolt.com/s${index}.xml`
    ).join('\n')
    expect(sitemapsFromRobots(many, ROBOTS)).toHaveLength(50)
    expect(sitemapsFromRobots(many, ROBOTS, 3)).toHaveLength(3)
    const huge = `${'#'.repeat(600 * 1024)}\nSitemap: https://textbolt.com/late.xml`
    expect(sitemapsFromRobots(huge, ROBOTS)).toEqual([])
  })

  test('returns nothing for a file without sitemaps', () => {
    expect(sitemapsFromRobots('User-agent: *\nDisallow:', ROBOTS)).toEqual([])
    expect(sitemapsFromRobots('', ROBOTS)).toEqual([])
  })
})
