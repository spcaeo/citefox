// The shared page shell for site/: <head> with search and share tags, the top
// bar, breadcrumbs and the footer. Pages are plain HTML, no framework.
import {
  AFFILIATE_DISCLOSURE,
  CONTACT_EMAIL,
  LICENSE_URL,
  OG_IMAGE,
  PUBLISHER,
  REPO,
  REPO_URL,
  SITE_URL
} from './config.mjs'
import { escapeHtml as e } from './markdown.mjs'

/** The absolute address of a site path such as `docs/summary/`. */
export const absolute = (path = '') => `${SITE_URL}${path}`

/** JSON for a <script type="application/ld+json"> block, safe inside HTML. */
export function jsonLd(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c')
  return `<script type="application/ld+json">\n${json}\n</script>`
}

export function breadcrumbData(trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absolute(crumb.path)
    }))
  }
}

export function faqData(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer }
    }))
  }
}

/**
 * One full page. `path` is the page's site path ('' for home, 'docs/summary/').
 * `root` is how links reach the site root from this page ('../../'), or an
 * absolute address for the 404 page, which GitHub Pages serves at any depth.
 */
export function page({
  path,
  root,
  title,
  description,
  body,
  data = [],
  script = 'enhance.js',
  type = 'website',
  noindex = false,
  current = '',
  footerRelease = false
}) {
  const r = root
  const link = (target, label, key) =>
    `<a href="${r}${target}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${e(title)}</title>
    <meta name="description" content="${e(description)}" />
${noindex ? '    <meta name="robots" content="noindex" />\n' : `    <link rel="canonical" href="${absolute(path)}" />\n`}    <meta name="citefox-repo" content="${REPO}" />
    <meta name="theme-color" content="#2a221b" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="CiteFox" />
    <meta property="og:title" content="${e(title)}" />
    <meta property="og:description" content="${e(description)}" />
    <meta property="og:url" content="${absolute(path)}" />
    <meta property="og:image" content="${absolute(OG_IMAGE.path)}" />
    <meta property="og:image:width" content="${OG_IMAGE.width}" />
    <meta property="og:image:height" content="${OG_IMAGE.height}" />
    <meta property="og:image:alt" content="${e(OG_IMAGE.alt)}" />
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${e(title)}" />
    <meta name="twitter:description" content="${e(description)}" />
    <meta name="twitter:image" content="${absolute(OG_IMAGE.path)}" />
    <meta name="twitter:image:alt" content="${e(OG_IMAGE.alt)}" />
    <link rel="icon" href="${r}icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${r}styles.css" />
    <link rel="stylesheet" href="${r}download.css" />
    <script type="module" src="${r}${script}"></script>
${data.map((d) => indent(jsonLd(d), 4)).join('\n')}
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="topbar">
      <div class="wrap topbar-row">
        <a class="brand" href="${r}">
          <img src="${r}icon.svg" alt="" width="32" height="32" />
          <span>CiteFox</span>
        </a>
        <nav aria-label="Main">
          ${link('#features', 'Features', 'features')}
          ${link('demo/', 'Live demo', 'demo')}
          ${link('samples/', 'Samples', 'samples')}
          ${link('docs/', 'Docs', 'docs')}
          ${link('glossary/', 'Glossary', 'glossary')}
          ${link('compare/', 'Compare', 'compare')}
          ${link('download/', 'Download', 'download')}
          <a id="nav-source" href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
        </nav>
      </div>
    </header>

${body}

    <footer class="footer">
      <div class="wrap footer-grid small">
        <div>
          <p class="footer-brand"><strong>CiteFox</strong>, the free AI visibility tracker for Google AI Overviews, ChatGPT, Perplexity, Gemini, Copilot and AI Mode.</p>
          <p class="muted">Contact: <a href="mailto:${CONTACT_EMAIL}" data-copy="${CONTACT_EMAIL}" data-what="email">${CONTACT_EMAIL}</a></p>
        </div>
        <nav aria-label="Footer" class="footer-cols">
          <div>
            <p class="footer-head">Product</p>
            <a href="${r}download/">Download</a>
            <a href="${r}demo/">Live demo</a>
            <a href="${r}samples/">Sample reports</a>
            <a href="${r}compare/">CiteFox vs other tools</a>
            <a href="${r}glossary/">GEO and AEO glossary</a>
          </div>
          <div>
            <p class="footer-head">Help</p>
            <a href="${r}docs/getting-started/">Getting started</a>
            <a href="${r}docs/">Docs</a>
            <a href="${REPO_URL}/blob/main/Docs/HELP.md" target="_blank" rel="noopener">Help docs on GitHub</a>
            <a href="${REPO_URL}/discussions" target="_blank" rel="noopener">Ask a question</a>
            <a href="${REPO_URL}/issues/new/choose" target="_blank" rel="noopener">Report a problem</a>
          </div>
          <div>
            <p class="footer-head">Project</p>
            <a href="${REPO_URL}" target="_blank" rel="noopener">Source code</a>
            <a href="${REPO_URL}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">What's new</a>
            <a href="${REPO_URL}/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener">Contributing</a>
            <a href="${REPO_URL}/blob/main/Docs/PRIVACY.md" target="_blank" rel="noopener">Privacy</a>
            <a href="${r}#about">About us</a>
          </div>
        </nav>
      </div>
      <div class="wrap footer-row small">
        <span>
          <a id="license" href="${LICENSE_URL}" target="_blank" rel="noopener">Source-available</a>
          · © 2026 <a href="${PUBLISHER.url}" target="_blank" rel="noopener">${PUBLISHER.name}</a>
        </span>
        ${footerRelease ? '<span id="footer-release" class="muted"></span>' : ''}
      </div>
      <p class="wrap small muted disclosure">${e(AFFILIATE_DISCLOSURE)}</p>
    </footer>
  </body>
</html>
`
}

/** Home › Docs › Topic, as links (the last one is the current page). */
export function breadcrumbs(trail, root) {
  const items = trail.map((crumb, i) =>
    i === trail.length - 1
      ? `<li aria-current="page">${e(crumb.name)}</li>`
      : `<li><a href="${root}${crumb.path}">${e(crumb.name)}</a></li>`
  )
  return `<nav class="crumbs small" aria-label="Breadcrumb"><ol>${items.join('')}</ol></nav>`
}

export function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n')
}
