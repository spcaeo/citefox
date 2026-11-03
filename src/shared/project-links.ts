/**
 * The project's public places, shown in Settings › Data & about. One list, so the app
 * and its tests agree. The website and GitHub copies live in scripts/site/config.mjs.
 */

export const REPO_URL = 'https://github.com/spcaeo/citefox'
export const SITE_URL = 'https://spcaeo.github.io/citefox/'
export const PUBLISHER_URL = 'https://www.spaceo.ca'

export interface ProjectLink {
  label: string
  url: string
}

export const PROJECT_LINKS: readonly ProjectLink[] = [
  { label: 'Website', url: SITE_URL },
  { label: 'Source code', url: REPO_URL },
  { label: 'Help docs', url: `${REPO_URL}/blob/main/Docs/help/README.md` },
  { label: "What's new", url: `${REPO_URL}/blob/main/CHANGELOG.md` },
  { label: 'Downloads', url: `${REPO_URL}/releases` },
  { label: 'Report a problem', url: `${REPO_URL}/issues/new/choose` },
  { label: 'Ideas and questions', url: `${REPO_URL}/discussions` },
  { label: 'Licence', url: `${REPO_URL}/blob/main/LICENSE` },
  { label: 'Privacy', url: `${REPO_URL}/blob/main/Docs/PRIVACY.md` },
  { label: 'Space-O Technologies', url: PUBLISHER_URL }
]

/** The short "about us" line in the app and on the website. */
export const ABOUT_US =
  'CiteFox is made by Space-O Technologies, a software development company in Canada. We made CiteFox free and source-available so anyone can see where AI answers cite them, keep their data, and fix what is missing.'
