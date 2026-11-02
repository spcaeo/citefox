import { SAMPLES, type SampleInfo } from '../../scripts/site/samples.mjs'

export { SAMPLES, type SampleInfo }

/**
 * The sample reports on the site (site/samples, Docs/DEMO.md): the app's own
 * offline HTML download, plus search metadata and a small "made with CiteFox"
 * pill. The pill is fixed in a corner, so the report's own layout is unchanged,
 * and it says the data is made up. The made-up page links have no "open" button
 * (copy stays), so nobody lands on a page that does not exist. The pill
 * and it is styled by an inline <style> the report's CSP already allows
 * (`style-src 'unsafe-inline'`). It hides when printing.
 */

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BAR_CSS = `
.cf-sample-bar{position:fixed;left:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;
padding:8px 14px;border-radius:999px;background:#1f2a24;color:#fff;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;
box-shadow:0 4px 18px rgba(0,0,0,.18)}
.cf-sample-bar a{color:#fff;text-decoration:underline;text-underline-offset:2px}
.cf-sample-bar a.cf-sample-dl{background:#c2410c;border-radius:999px;padding:4px 12px;text-decoration:none}
@media print{.cf-sample-bar{display:none}}
@media (max-width:640px){.cf-sample-bar{left:8px;right:8px;bottom:8px;justify-content:center}}`

/** The report with its search metadata and the pill. `siteUrl` ends with a slash. */
export function samplePage(html: string, info: SampleInfo, siteUrl: string): string {
  const url = `${siteUrl}samples/${info.slug}/`
  const title = `Sample ${info.title} — AI visibility report made with CiteFox`
  const description = `Sample CiteFox ${info.title.toLowerCase()} (${info.goal.toLowerCase()}): ${info.description}`
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="robots" content="index, follow">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="CiteFox">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(siteUrl)}og.png">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<style>${BAR_CSS}</style>`
  ].join('\n')
  const bar = `<div class="cf-sample-bar" role="note" aria-label="About this sample">Sample report made with CiteFox, example data · <a href="../">More samples</a> <a class="cf-sample-dl" href="../../#download">Download</a></div>`
  const titled = html.replace(/<title>[\s\S]*?<\/title>/, () => head)
  if (titled === html) throw new Error('The report has no <title> to replace')
  const offline = titled.replace(/<a class="cp-btn cp-open"[^>]*>[\s\S]*?<\/a>/g, '')
  const out = offline.replace(/<body>/, () => `<body>\n${bar}`)
  if (out === offline) throw new Error('The report has no <body> tag')
  return out
}
