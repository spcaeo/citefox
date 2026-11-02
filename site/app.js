/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript, no type annotations */
// The download page: reads the latest release from the GitHub API and fills
// in the buttons, the file list and the notes. Logic lives in release.js.
import {
  copyable,
  describeAsset,
  detectPlatform,
  enhanceCopyables,
  downloadList,
  formatDay,
  formatSize,
  parseSums,
  pickPrimary,
  renderNotes,
  repoFromLocation,
  sha256Of,
  shortHash
} from './release.js'

const $ = (id) => document.getElementById(id)
const metaRepo = document.querySelector('meta[name="citefox-repo"]')?.getAttribute('content')
const repo = repoFromLocation(location.hostname, location.pathname, metaRepo || undefined)
const repoUrl = `https://github.com/${repo}`

async function platformHints() {
  const hints = {}
  try {
    const data = await navigator.userAgentData?.getHighEntropyValues?.(['architecture'])
    if (data?.architecture) hints.architecture = data.architecture
  } catch {
    // Not offered by this browser.
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && ext) hints.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
  } catch {
    // No WebGL.
  }
  return hints
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function showNoRelease(message) {
  const primary = $('primary')
  primary.replaceChildren()
  primary.append(el('p', 'muted', message))
  const link = el('a', 'button', 'See releases on GitHub')
  link.href = `${repoUrl}/releases`
  link.target = '_blank'
  link.rel = 'noopener'
  primary.append(link)
}

function renderPrimary(release, platform) {
  const primary = $('primary')
  primary.replaceChildren()
  const buttons = pickPrimary(release.assets, platform)
  for (const { asset, title, info } of buttons) {
    const link = el('a', 'button big')
    link.href = asset.browser_download_url
    link.append(el('span', 'button-title', title))
    link.append(el('span', 'button-sub', `${info.kindLabel} · ${formatSize(asset.size)}`))
    primary.append(link)
  }
  if (buttons.length === 0) {
    primary.append(el('p', 'muted', 'Pick your computer from the list of downloads below.'))
  }
  if (platform.os === 'mac' && buttons.length === 2) {
    const universal = release.assets.find((a) => /-mac-universal\.dmg$/.test(a.name))
    const hint = el('p', 'small muted', 'Not sure which chip? Apple menu › About This Mac. ')
    if (universal) {
      const link = el('a', '', 'Or get the version for every Mac')
      link.href = universal.browser_download_url
      hint.append(link)
    }
    primary.append(hint)
  }

  const others = $('other-platforms')
  others.replaceChildren()
  const names = { mac: 'Mac', win: 'Windows', linux: 'Linux' }
  const links = Object.keys(names)
    .filter((os) => os !== platform.os)
    .map((os) => {
      const a = el('a', '', names[os])
      a.href = '#files-section'
      return a
    })
  if (platform.os === 'mac' || platform.os === 'win' || platform.os === 'linux') {
    others.append('Also for ')
    links.forEach((a, i) => {
      if (i > 0) others.append(i === links.length - 1 ? ' and ' : ', ')
      others.append(a)
    })
  }
}

function renderFiles(release, sums) {
  const list = $('files')
  list.replaceChildren()
  for (const { asset, info } of downloadList(release.assets)) {
    const row = el('li', 'file')
    const name = el('div', 'file-name')
    name.append(el('span', 'file-label', `${info.label} · ${info.kindLabel}`))
    name.append(
      copyable(document, asset.name, { href: asset.browser_download_url, what: 'file name' })
    )
    row.append(name)
    row.append(el('span', 'file-size muted', formatSize(asset.size)))
    const hash = sha256Of(asset, sums)
    const hashCell = el('div', 'file-hash')
    if (hash) hashCell.append(copyable(document, hash, { shown: shortHash(hash), what: 'SHA-256' }))
    else hashCell.append(el('span', 'muted', 'In SHA256SUMS.txt'))
    row.append(hashCell)
    list.append(row)
  }
  const sumsAsset = release.assets.find((a) => a.name === 'SHA256SUMS.txt')
  const sumsLine = $('sums')
  sumsLine.replaceChildren()
  if (sumsAsset) {
    sumsLine.append('All checksums: ')
    sumsLine.append(
      copyable(document, sumsAsset.browser_download_url, {
        shown: 'SHA256SUMS.txt',
        url: sumsAsset.browser_download_url,
        what: 'checksums link'
      })
    )
  }
  $('files-section').hidden = list.children.length === 0
}

async function loadSums(release) {
  // The API gives each asset's sha256 digest; SHA256SUMS.txt is the fallback.
  if (release.assets.every((a) => !describeAsset(a.name) || a.digest)) return {}
  const asset = release.assets.find((a) => a.name === 'SHA256SUMS.txt')
  if (!asset) return {}
  try {
    const response = await fetch(asset.browser_download_url)
    return response.ok ? parseSums(await response.text()) : {}
  } catch {
    return {}
  }
}

function orderSteps(platform) {
  const steps = document.querySelector('.steps')
  const own = steps.querySelector(`[data-os="${platform.os}"]`)
  if (own) {
    steps.prepend(own)
    own.classList.add('own')
  }
}

async function main() {
  enhanceCopyables(document)
  $('nav-source').href = repoUrl
  $('older').href = `${repoUrl}/releases`
  $('license').href = `${repoUrl}/blob/main/LICENSE`

  const platform = detectPlatform(navigator, await platformHints())
  $('mobile-note').hidden = platform.os !== 'mobile'
  orderSteps(platform)

  let release
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (response.status === 404) return showNoRelease('The first release is on its way.')
    if (!response.ok) return showNoRelease('GitHub is busy right now. The files are on GitHub too.')
    release = await response.json()
  } catch {
    return showNoRelease('Could not reach GitHub. The files are on GitHub too.')
  }

  const version = release.tag_name.replace(/^v/, '')
  renderPrimary(release, platform)
  $('release-meta').textContent = `Version ${version} · ${formatDay(release.published_at)}`
  $('footer-release').textContent = `Latest: v${version}`

  renderFiles(release, await loadSums(release))

  const notes = renderNotes(release.body || '')
  if (notes) {
    $('notes-title').textContent = `What’s new in ${version}`
    $('notes').innerHTML = notes
    $('notes-section').hidden = false
  }
}

main()
