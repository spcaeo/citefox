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
