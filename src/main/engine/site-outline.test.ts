import { describe, expect, test } from 'vitest'
import { pageAnchors } from '../pipeline/page-anchors'
import { chooseSitePages, menuBlock, siteKey, siteLinks, siteMenu, MENU_MAX } from './site-outline'
import { TEXTBOLT_HOME_HTML } from './site-outline.test-helper'

const FIXED = ['/', '/pricing', '/about', '/compare']

function textboltLinks(): ReturnType<typeof siteLinks> {
  return siteLinks('textbolt.com', {
    anchors: pageAnchors(TEXTBOLT_HOME_HTML, 'https://textbolt.com/')
  })
}

describe('site outline: pages to read and the menu', () => {
  test('a textbolt.com-like home page: offering hubs, solutions, then a migration page', () => {
    expect(chooseSitePages(textboltLinks(), FIXED)).toEqual([
      '/industries/',
      '/integration/',
      '/use-case/',
      '/migration/',
      '/solutions/email-to-text-service/',
      '/solutions/gmail-text-integration/',
      '/solutions/text-alert-service/',
      '/migration/att/'
    ])
  })

  test('same site only; no blog, legal, login, contact, asset, query or anchor links', () => {
    const paths = textboltLinks().map((link) => link.path)
    expect(paths).not.toContain('/')
    expect(paths.some((path) => /blog|legal|login|signup|contact|\.png/u.test(path))).toBe(false)
    expect(paths.filter((path) => path === '/pricing/')).toHaveLength(1)
    expect(new Set(paths).size).toBe(paths.length)
  })

  test('paths already read are skipped, case and trailing slash folded', () => {
    const links = [
      { text: 'Pricing', path: '/Pricing/' },
      { text: 'Use cases', path: '/use-cases/' },
      { text: 'Alerts', path: '/use-cases/alerts/' }
    ]
    expect(chooseSitePages(links, ['/pricing', '/use-cases'])).toEqual(['/use-cases/alerts/'])
  })

  test('at most 8 more pages (12 with the fixed four), a few per section', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      text: `Integration ${index}`,
      path: `/integrations/tool-${index}/`
    }))
    const products = Array.from({ length: 10 }, (_, index) => ({
      text: `Product ${index}`,
      path: `/products/p-${index}/`
    }))
    const chosen = chooseSitePages([...many, ...products], FIXED)
    expect(chosen).toHaveLength(6)
    expect(chosen.filter((path) => path.startsWith('/products/'))).toHaveLength(4)
    expect(chosen.filter((path) => path.startsWith('/integrations/'))).toHaveLength(2)
    const pages = Array.from({ length: 20 }, (_, index) => ({ text: '', path: `/page-${index}/` }))
    expect(chooseSitePages([...products, ...pages], FIXED).length).toBe(8)
    expect(FIXED.length + chooseSitePages([...products, ...pages], FIXED).length).toBe(12)
  })

  test('links from another host, or the bare links a reader gives, are handled', () => {
    expect(
      siteLinks('www.textbolt.com', {
        links: [
          'https://textbolt.com/use-case/',
          'https://other.example/products/',
          'https://my.textbolt.com/login'
        ]
      })
    ).toEqual([{ text: '', path: '/use-case/' }])
    expect(siteKey('https://WWW.TextBolt.com/pricing')).toBe('textbolt.com')
  })

  test('the menu block lists a few links per section, with their words and paths', () => {
    const menu = siteMenu(textboltLinks())
    expect(menu.length).toBeLessThanOrEqual(MENU_MAX)
    const block = menuBlock(menu)
    expect(block[0]).toBe('Site menu (link text and path):')
    expect(block).toContain('- Text Alert Service: /solutions/text-alert-service/')
    expect(block).toContain('- Server Monitoring Alerts: /use-case/server-monitoring-text-alerts/')
    expect(menuBlock([])).toEqual([])
    const long = Array.from({ length: 20 }, (_, index) => ({
      text: `Tool ${index}`,
      path: `/integration/tool-${index}/`
    }))
    expect(siteMenu(long)).toHaveLength(6)
  })
})
