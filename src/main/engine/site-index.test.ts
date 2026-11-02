import { describe, expect, test } from 'vitest'
import type { EngineHost } from './host'
import { llmsAnchors, siteIndexLinks, sitemapLocs } from './site-index'
import { siteLinks } from './site-outline'

/** A host whose reader answers from a map (tests and e2e read pages this way). */
function hostWith(files: Record<string, string>): EngineHost {
  return {
    readWebsitePage: async (url: string) =>
      files[url] === undefined ? null : { title: '', text: files[url] ?? '' }
  } as unknown as EngineHost
}

describe('the site page list when the home page gives no links', () => {
  test('llms.txt: its markdown links and bare URLs, same site only', () => {
    const text = `# Acme
- [Acme Desk](https://www.acme.com/desk/): Help desk.
- [Pricing](https://www.acme.com/desk/pricing/)
- Docs at https://docs.acme.com/start and https://www.acme.com/crm/sales/
- [Partner](https://other.com/acme)`
    expect(llmsAnchors(text).map((anchor) => anchor.url)).toHaveLength(5)
    expect(siteLinks('acme.com', { anchors: llmsAnchors(text) })).toEqual([
      { text: 'Acme Desk', path: '/desk/' },
      { text: 'Pricing', path: '/desk/pricing/' },
      { text: '', path: '/crm/sales/' }
    ])
  })

  test('sitemap: <loc> URLs, CDATA and &amp; included', () => {
    expect(
      sitemapLocs(
        '<urlset><url><loc>https://acme.com/a</loc></url><url><loc><![CDATA[https://acme.com/b?x=1&amp;y=2]]></loc></url></urlset>'
      )
    ).toEqual(['https://acme.com/a', 'https://acme.com/b?x=1&y=2'])
  })

  test('llms.txt first; else the sitemap, through a sitemap index', async () => {
    const llms = hostWith({ 'https://acme.com/llms.txt': '[Desk](https://acme.com/desk/)' })
    expect(await siteIndexLinks(llms, 'acme.com')).toEqual({
      links: [{ text: 'Desk', path: '/desk/' }],
      source: 'llms'
    })
    const sitemap = hostWith({
      'https://acme.com/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://acme.com/blog-sitemap.xml</loc></sitemap><sitemap><loc>https://acme.com/page-sitemap.xml</loc></sitemap></sitemapindex>',
      'https://acme.com/page-sitemap.xml':
        '<urlset><url><loc>https://acme.com/products/desk</loc></url></urlset>'
    })
    expect(await siteIndexLinks(sitemap, 'acme.com')).toEqual({
      links: [{ text: '', path: '/products/desk' }],
      source: 'sitemap'
    })
    expect(await siteIndexLinks(hostWith({}), 'acme.com')).toEqual({ links: [], source: null })
  })

  test('a link that only carries a click tag counts; one with a real query does not', () => {
    expect(
      siteLinks('zoho.com', {
        links: [
          'https://www.zoho.com/crm/?src=zindex',
          'https://www.zoho.com/mail/?utm_source=home',
          'https://www.zoho.com/books/?plan=pro'
        ]
      })
    ).toEqual([
      { text: '', path: '/crm/' },
      { text: '', path: '/mail/' }
    ])
  })
})
