/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript, no type annotations */
// Pure helpers for the download page (site/app.js renders with them).
// No framework and no build step: this file is served as is by GitHub Pages
// and imported by src/main/download-site.test.ts.

export const DEFAULT_REPO = 'spcaeo/citefox'

/** `owner/repo` from a `<owner>.github.io/<repo>/` address, else the default. */
export function repoFromLocation(hostname, pathname, fallback = DEFAULT_REPO) {
  const host = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname || '')
  const first = (pathname || '').split('/').filter(Boolean)[0]
  return host && first ? `${host[1]}/${first}` : fallback
}

/**
 * Which computer is looking: `{ os: 'mac'|'win'|'linux'|'mobile'|'unknown',
 * arch: 'arm64'|'x64'|'unknown' }`. `hints` are what the page could learn
 * beyond the user agent: `architecture` from User-Agent Client Hints
 * ('arm' or 'x86', Chrome and Edge) and the WebGL `renderer` string.
 */
export function detectPlatform(nav, hints = {}) {
  const ua = nav?.userAgent || ''
  const platform = nav?.userAgentData?.platform || nav?.platform || ''
  const touch = (nav?.maxTouchPoints || 0) > 1
  const fromHints =
    hints.architecture === 'arm' ? 'arm64' : hints.architecture === 'x86' ? 'x64' : 'unknown'

  if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform + ua) && touch)) {
    return { os: 'mobile', arch: 'unknown' }
  }
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) {
    let arch = fromHints
    if (arch === 'unknown' && hints.renderer) {
      if (/Apple M\d/i.test(hints.renderer)) arch = 'arm64'
      else if (/Intel|AMD|Radeon|NVIDIA/i.test(hints.renderer)) arch = 'x64'
    }
    return { os: 'mac', arch }
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) {
    // Windows on Arm runs x64 apps too, so x64 is the safe guess.
    return { os: 'win', arch: fromHints === 'arm64' || /ARM64/i.test(ua) ? 'arm64' : 'x64' }
  }
  if (/Linux|X11|CrOS/i.test(platform + ua)) {
    return {
      os: 'linux',
      arch: fromHints === 'arm64' || /aarch64|arm64/i.test(ua) ? 'arm64' : 'x64'
    }
  }
  return { os: 'unknown', arch: 'unknown' }
}

const KINDS = [
  { re: /-mac-(universal|arm64|x64)\.dmg$/, os: 'mac', kind: 'dmg' },
  { re: /-mac-(universal|arm64|x64)\.zip$/, os: 'mac', kind: 'zip' },
  { re: /-win-(x64|arm64)-portable\.exe$/, os: 'win', kind: 'portable' },
  { re: /-win-(x64|arm64)\.exe$/, os: 'win', kind: 'installer' },
  { re: /-linux-(x86_64|amd64|x64|arm64|aarch64)\.AppImage$/, os: 'linux', kind: 'appimage' },
  { re: /-linux-(x86_64|amd64|x64|arm64|aarch64)\.deb$/, os: 'linux', kind: 'deb' }
]

const ARCH_NAMES = {
  x86_64: 'x64',
  amd64: 'x64',
  x64: 'x64',
  arm64: 'arm64',
  aarch64: 'arm64',
  universal: 'universal'
}

const KIND_LABEL = {
  dmg: 'Disk image (.dmg)',
  zip: 'Zip',
  installer: 'Installer (.exe)',
  portable: 'Portable, no install (.exe)',
  appimage: 'AppImage',
  deb: 'Ubuntu and Debian (.deb)'
}

const OS_LABEL = { mac: 'Mac', win: 'Windows', linux: 'Linux' }

function archLabel(os, arch) {
  if (arch === 'universal') return 'every Mac'
  if (os === 'mac') return arch === 'arm64' ? 'Apple chip' : 'Intel chip'
  if (os === 'win') return arch === 'arm64' ? 'Arm' : 'x64'
  return arch === 'arm64' ? 'Arm64' : 'x64'
}

/** What a release file is, from its name; null for update files and blockmaps. */
export function describeAsset(name) {
  for (const k of KINDS) {
    const match = k.re.exec(name)
    if (!match) continue
    const arch = ARCH_NAMES[match[1]] || match[1]
    return {
      os: k.os,
      arch,
      kind: k.kind,
      label: `${OS_LABEL[k.os]} · ${archLabel(k.os, arch)}`,
      kindLabel: KIND_LABEL[k.kind]
    }
  }
  return null
}

/**
 * The big buttons for this computer: an array of `{ asset, title }`.
 * Mac with an unknown chip gets both chip buttons (or the universal file).
 */
export function pickPrimary(assets, platform) {
  const files = assets
    .map((asset) => ({ asset, info: describeAsset(asset.name) }))
    .filter((f) => f.info !== null)
  const find = (os, kind, arch) =>
    files.find((f) => f.info.os === os && f.info.kind === kind && f.info.arch === arch)
  const button = (f, title) => (f ? [{ asset: f.asset, title, info: f.info }] : [])

  if (platform.os === 'mac') {
    const arm = find('mac', 'dmg', 'arm64')
    const intel = find('mac', 'dmg', 'x64')
    const universal = find('mac', 'dmg', 'universal')
    if (platform.arch === 'arm64' && arm) return button(arm, 'Download for Mac (Apple chip)')
    if (platform.arch === 'x64' && intel) return button(intel, 'Download for Mac (Intel chip)')
    if (arm && intel) {
      return [...button(arm, 'Mac with Apple chip'), ...button(intel, 'Mac with Intel chip')]
    }
    return button(universal, 'Download for Mac')
  }
  if (platform.os === 'win') {
    const own = find('win', 'installer', platform.arch) || find('win', 'installer', 'x64')
    return button(
      own,
      own?.info.arch === 'arm64' ? 'Download for Windows (Arm)' : 'Download for Windows'
    )
  }
  if (platform.os === 'linux') {
    const own = find('linux', 'appimage', platform.arch) || find('linux', 'appimage', 'x64')
    return button(own, 'Download for Linux (AppImage)')
  }
  return []
}

/** `mac-universal-dmg`: the key a page link uses (data-asset) for one release file. */
export function assetKey(info) {
  return `${info.os}-${info.arch}-${info.kind}`
}

/** `{ key: asset }` for every release file people download. */
export function assetsByKey(assets) {
  const out = {}
  for (const asset of assets || []) {
    const info = describeAsset(asset.name)
    if (info && !out[assetKey(info)]) out[assetKey(info)] = asset
  }
  return out
}

const SHORT_KIND = {
  'mac-universal-dmg': 'Universal .dmg',
  'mac-arm64-dmg': 'Apple chip .dmg',
  'mac-x64-dmg': 'Intel .dmg',
  'win-x64-installer': 'Installer .exe',
  'win-arm64-installer': 'Arm installer .exe',
  'win-x64-portable': 'Portable .exe',
  'win-arm64-portable': 'Arm portable .exe',
  'linux-x64-appimage': 'AppImage',
  'linux-arm64-appimage': 'arm64 AppImage',
  'linux-x64-deb': '.deb',
  'linux-arm64-deb': 'arm64 .deb'
}

/**
 * The one big button (Loom style): `{ asset, info, title, sub }` or null.
 * A Mac with a known chip gets its own .dmg, otherwise the Universal one.
 */
export function pickMain(assets, platform, version) {
  const buttons = pickPrimary(assets, platform)
  let pick = buttons.length === 1 ? buttons[0] : null
  if (!pick && platform.os === 'mac') {
    const universal = assets.find((a) => /-mac-universal\.dmg$/.test(a.name))
    const chosen = universal || buttons[0]?.asset
    if (chosen) pick = { asset: chosen, info: describeAsset(chosen.name) }
  }
  if (!pick) return null
  const kind = SHORT_KIND[assetKey(pick.info)] || pick.info.kindLabel
  const size = formatSize(pick.asset.size)
  return {
    asset: pick.asset,
    info: pick.info,
    title: `Download for ${OS_LABEL[pick.info.os]}`,
    sub: [version ? `v${version}` : '', kind, size].filter(Boolean).join(' · ')
  }
}

/**
 * What the download section shows for an API answer: 'ready' (a release with
 * files), 'none' (no release yet, or one still being built with no files) or
 * 'error' (GitHub could not be reached or said something else).
 */
export function releaseState(status, release) {
  if (status === 404) return 'none'
  if (status !== 200 || !release || typeof release.tag_name !== 'string') return 'error'
  return downloadList(release.assets || []).length ? 'ready' : 'none'
}

/** Release files people download, in a fixed order: Mac, Windows, Linux. */
export function downloadList(assets) {
  const osOrder = { mac: 0, win: 1, linux: 2 }
  const kindOrder = { dmg: 0, zip: 1, installer: 0, portable: 1, appimage: 0, deb: 1 }
  // Mac: every Mac, then Apple chip, then Intel. Windows and Linux: x64 first.
  const archOrder = (info) =>
    ({ universal: 0, arm64: info.os === 'mac' ? 1 : 3, x64: 2 })[info.arch]
  return assets
    .map((asset) => ({ asset, info: describeAsset(asset.name) }))
    .filter((f) => f.info !== null)
    .sort(
      (a, b) =>
        osOrder[a.info.os] - osOrder[b.info.os] ||
        kindOrder[a.info.kind] - kindOrder[b.info.kind] ||
        archOrder(a.info) - archOrder(b.info)
    )
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/** `sha256:abc…` (the API's asset digest) or a SHA256SUMS.txt line → hex. */
export function sha256Of(asset, sums = {}) {
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:'))
    return asset.digest.slice(7)
  return sums[asset.name] || ''
}

/** SHA256SUMS.txt → `{ fileName: hex }`. */
export function parseSums(text) {
  const out = {}
  for (const line of (text || '').split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match) out[match[2]] = match[1].toLowerCase()
  }
  return out
}

/** `Nov 2, 2026` in the visitor's own locale and zone. */
export function formatDay(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    )
}

/**
 * The release notes as safe HTML: headings, bullets, quotes, bold, code and
 * http(s) links. Everything else is escaped text. The part after the first
 * `---` (the file guide and unsigned-build steps) is left out: the page shows
 * those in its own sections.
 */
export function renderNotes(markdown) {
  const body = (markdown || '').replace(/\r\n/g, '\n').split(/\n-{3,}\n/)[0]
  const html = []
  let list = false
  const closeList = () => {
    if (list) html.push('</ul>')
    list = false
  }
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      html.push(`<h4>${inline(heading[2])}</h4>`)
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!list) html.push('<ul>')
      list = true
      html.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
    } else if (/^>\s?/.test(line)) {
      closeList()
      html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      html.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  return html.join('\n')
}

/** `a1b2c3d4e5f6…9f8e7d` so a 64-character hash fits a phone row; copy takes all of it. */
export function shortHash(hex) {
  return hex.length > 20 ? `${hex.slice(0, 12)}…${hex.slice(-6)}` : hex
}

// ---- The one copy / open helper (owner rule: copy and open icons) ----

const COPY_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5"/></svg>'
const TICK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>'
const OPEN_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2L7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>'

/**
 * A value people may want to take, with a copy icon after it (a URL also gets
 * an open icon). `shown` is the visible text (defaults to the value), `href`
 * makes the text itself a link (a download), `url` adds the open icon.
 * Every copy button and copyable value on the page comes from here.
 */
export function copyable(doc, value, options = {}) {
  const wrap = doc.createElement('span')
  wrap.className = 'copyable'
  const text = doc.createElement(options.href ? 'a' : 'code')
  text.className = 'copyable-value'
  text.textContent = options.shown || value
  if (options.href) text.setAttribute('href', options.href)
  if (options.shown && options.shown !== value) text.setAttribute('title', value)
  wrap.append(text)

  const copy = doc.createElement('button')
  copy.type = 'button'
  copy.className = 'icon-btn copy-btn'
  copy.setAttribute('aria-label', `Copy ${options.what || 'value'}`)
  copy.innerHTML = COPY_ICON
  let timer = 0
  copy.addEventListener('click', async () => {
    try {
      await doc.defaultView.navigator.clipboard.writeText(value)
    } catch {
      return
    }
    copy.classList.add('copied')
    copy.innerHTML = TICK_ICON
    copy.setAttribute('aria-label', 'Copied')
    clearTimeout(timer)
    timer = setTimeout(() => {
      copy.classList.remove('copied')
      copy.innerHTML = COPY_ICON
      copy.setAttribute('aria-label', `Copy ${options.what || 'value'}`)
    }, 2000)
  })
  wrap.append(copy)

  if (options.url) {
    const open = doc.createElement('a')
    open.className = 'icon-btn open-btn'
    open.href = options.url
    open.target = '_blank'
    open.rel = 'noopener'
    open.setAttribute('aria-label', `Open ${options.what || 'link'} in a new window`)
    open.innerHTML = OPEN_ICON
    wrap.append(open)
  }
  return wrap
}

/**
 * Values written in a page get the copy icon: `<code data-copy>` (a command) and
 * `<a data-copy="value" data-what="email">` (a link whose value is copied).
 */
export function enhanceCopyables(doc) {
  for (const node of doc.querySelectorAll('[data-copy]')) {
    const value = node.getAttribute('data-copy') || node.textContent.trim()
    const what = node.getAttribute('data-what') || 'command'
    const href = node.tagName === 'A' ? node.getAttribute('href') : undefined
    node.replaceWith(copyable(doc, value, { what, href, shown: node.textContent.trim() }))
  }
}
