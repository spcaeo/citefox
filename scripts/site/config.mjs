// One place for the public site's addresses. Change SITE_URL here (or set the
// SITE_URL environment variable for one build) when the site moves, for example
// to a custom domain, then run `npm run site:build`.

/** The public address of site/, with a trailing slash. */
export const SITE_URL = withSlash(process.env.SITE_URL || 'https://spcaeo.github.io/citefox/')

/** The public GitHub repository, `owner/name`. Also in site/release.js DEFAULT_REPO. */
export const REPO = 'spcaeo/citefox'
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`

export const PUBLISHER = { name: 'Space-O Technologies', url: 'https://www.spaceo.ca' }
/** Shown after the publisher in the copyright line. */
export const DIVISION = 'vBridge Technologies, a division of Space-O'
export const CONTACT_EMAIL = 'getcitifox@gmail.com'

/** The default share image (1200 x 630), made by `npm run site:og`. */
export const OG_IMAGE = {
  path: 'og.png',
  width: 1200,
  height: 630,
  alt: 'CiteFox: free AI visibility tracker'
}

export const TAGLINE = 'Free AI visibility tracker for Google AI Overviews, ChatGPT and Perplexity'

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`
}

/** The browser demo and the sample reports, built by their own scripts under SITE_URL. */
export const DEMO_URL = `${SITE_URL}demo/`
export const SAMPLES_URL = `${SITE_URL}samples/`

/**
 * The affiliate disclosure: small type in every site footer and the README's last section,
 * word for word (build-site.test.mjs checks both).
 */
export const AFFILIATE_DISCLOSURE =
  'Affiliate disclosure: some links in CiteFox and on this site are affiliate or partner links. If you sign up through them we may earn a commission, at no extra cost to you. It helps keep CiteFox free.'

/** The "about us" line: home page here, Settings › Data & about in the app (src/shared/project-links.ts, same words; build-site.test.mjs checks). */
export const ABOUT_US =
  'CiteFox is made by Space-O Technologies, a software development company in Canada. We made CiteFox free and source-available so anyone can see where AI answers cite them, keep their data, and fix what is missing.'
