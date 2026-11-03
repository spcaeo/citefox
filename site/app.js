/* eslint-disable @typescript-eslint/explicit-function-return-type -- plain JavaScript, no type annotations */
// The home and download pages: read the latest release from the GitHub API and
// fill in the big button, the OS cards, the file list and the notes. Logic
// lives in release.js; the screenshot zoom in lightbox.js.
import { initLightbox } from './lightbox.js'
import {
  assetsByKey,
  copyable,
  describeAsset,
  detectPlatform,
  enhanceCopyables,
  downloadList,
  formatDay,
  formatSize,
  parseSums,
  pickMain,
  releaseState,
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

const RELEASES = `${repoUrl}/releases`

// The Windows build is not signed with a paid certificate yet, so Windows shows "Windows protected
// your PC" on the first start. Tell people on this page, before they download. Set to false once
// the Windows installer is signed (the dialog, the notes under the button and on the card stop).
const WINDOWS_UNSIGNED = true

let windowsDialog = null
/** A short "before you install" dialog; "Continue" starts the download. */
function askAboutWindowsWarning(href) {
  if (!windowsDialog) {
    const dialog = el('dialog', 'dl-dialog')
    dialog.setAttribute('aria-labelledby', 'win-warning-title')
    const title = el('h2', '', 'One quick thing before you install')
    title.id = 'win-warning-title'
    const lead = el(
      'p',
      '',
      'The first time you open CiteFox, Windows shows a blue screen that says “Windows protected your PC”. This is expected: CiteFox is free and open source, and it is not signed with a paid Windows certificate yet.'
    )
    const steps = el('ol', 'dl-dialog-steps')
    steps.append(
      el('li', '', 'Click “More info” on the blue screen.'),
      el('li', '', 'Click “Run anyway”.')
    )
    const note = el(
      'p',
      'small muted',
      'You only do this once. You can compare the file’s SHA-256 with the list on this page first.'
    )
    const actions = el('div', 'dl-dialog-actions')
    const cancel = el('button', 'cta cta-outline', 'Cancel')
    cancel.type = 'button'
    cancel.addEventListener('click', () => dialog.close())
    const go = el('a', 'dl-btn', 'Continue to download')
    go.dataset.continue = ''
    go.addEventListener('click', () => dialog.close())
    actions.append(cancel, go)
    dialog.append(title, lead, steps, note, actions)
    document.body.append(dialog)
    windowsDialog = dialog
  }
  windowsDialog.querySelector('[data-continue]').href = href
  windowsDialog.showModal()
}

document.addEventListener('click', (event) => {
  if (!WINDOWS_UNSIGNED || event.defaultPrevented || event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link =
    event.target instanceof Element ? event.target.closest('a[data-dl-main], a[data-asset]') : null
  if (!link || !link.href.includes('/releases/download/')) return
  const isWindows = link.matches('[data-dl-main]')
    ? link.dataset.os === 'win'
    : /^win-/.test(link.dataset.asset || '')
  if (!isWindows || typeof HTMLDialogElement !== 'function') return
  event.preventDefault()
  askAboutWindowsWarning(link.href)
})

/** Points the big button at a file (or at the Releases page) and sets its two lines. */
function setMain({ state, href, title, sub, os }) {
  const main = document.querySelector('[data-dl-main]')
  if (!main) return
  main.dataset.state = state
  main.dataset.os = os || ''
  main.href = href
  if (href === RELEASES) {
    main.target = '_blank'
    main.rel = 'noopener'
  } else {
    main.removeAttribute('target')
    main.removeAttribute('rel')
  }
  main.querySelector('[data-dl-title]').textContent = title
  main.querySelector('[data-dl-sub]').textContent = sub
  const icon = os && document.querySelector(`.os-card[data-os="${os}"] .os-icon svg`)
  if (icon) main.querySelector('[data-dl-icon]').replaceChildren(icon.cloneNode(true))
}

/** The line under the big button: a message, then a link to the Releases page. */
function setStatus(message, linkText, href = RELEASES) {
  const status = document.querySelector('[data-dl-status]')
  if (!status) return
  status.replaceChildren()
  if (!message) return
  status.append(message)
  if (linkText) {
    status.append(' ')
    const link = el('a', '', linkText)
    link.href = href
    if (href === RELEASES) {
      link.target = '_blank'
      link.rel = 'noopener'
    }
    status.append(link)
  }
}

function showNoRelease(state) {
  for (const card of document.querySelectorAll('.os-card')) card.dataset.state = state
  if (state === 'none') {
    setMain({
      state,
      href: RELEASES,
      title: 'First release coming soon',
      sub: 'Opens the Releases page on GitHub'
    })
    setStatus(
      'The first release is being built — check back in a few minutes.',
      'See the Releases page'
    )
  } else {
    setMain({
      state,
      href: RELEASES,
      title: 'Download from GitHub',
      sub: 'Every file is on the Releases page'
    })
    setStatus('Could not load the latest version just now.', 'Open the Releases page')
  }
}

const OS_NAMES = { mac: 'Mac', win: 'Windows', linux: 'Linux' }

function renderMain(release, platform, version) {
  const main = pickMain(release.assets, platform, version)
  const also = document.querySelector('[data-dl-also]')
  if (main) {
    setMain({
      state: 'ready',
      href: main.asset.browser_download_url,
      title: main.title,
      sub: main.sub,
      os: main.info.os
    })
    const card = document.querySelector(`.os-card[data-os="${main.info.os}"]`)
    card?.classList.add('own')
    if (also) {
      const others = Object.keys(OS_NAMES).filter((os) => os !== main.info.os)
      also.replaceChildren(
        main.info.os === 'mac' && main.info.arch === 'universal'
          ? 'Works on every Mac, Apple chip and Intel. '
          : '',
        'Also for '
      )
      others.forEach((os, i) => {
        if (i > 0) also.append(' and ')
        const link = el('a', '', OS_NAMES[os])
        link.href = '#dl-cards'
        also.append(link)
      })
    }
    if (WINDOWS_UNSIGNED && main.info.os === 'win') {
      setStatus(
        'Windows will say “Windows protected your PC”. Click More info, then Run anyway.',
        'Why?',
        '#unsigned'
      )
    } else setStatus('')
  } else {
    setMain({
      state: 'ready',
      href: '#dl-cards',
      title: 'Choose your computer',
      sub: `v${version} · Mac, Windows and Linux`
    })
  }
}

/** Points every card link at its file; a file missing from this release is hidden. */
function renderCards(release) {
  const byKey = assetsByKey(release.assets)
  for (const link of document.querySelectorAll('[data-asset]')) {
    const asset = byKey[link.dataset.asset]
    if (!asset) {
      if (link.classList.contains('dl-link')) link.hidden = true
      continue
    }
    link.href = asset.browser_download_url
    link.removeAttribute('target')
    link.removeAttribute('rel')
    link.title = asset.name
    const size = link.querySelector('[data-size]')
    if (size) size.textContent = formatSize(asset.size)
  }
  for (const card of document.querySelectorAll('.os-card')) card.dataset.state = 'ready'
}

function renderFiles(release, sums) {
  const list = $('files')
  if (!list) return
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
  const empty = document.querySelector('[data-files-empty]')
  if (empty) empty.hidden = list.children.length > 0
  document.querySelector('.files-head').hidden = list.children.length === 0
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
  if (!steps) return
  const own = steps.querySelector(`[data-os="${platform.os}"]`)
  if (own) {
    steps.prepend(own)
    own.classList.add('own')
  }
}

async function main() {
  enhanceCopyables(document)
  initLightbox(document)
  $('nav-source').href = repoUrl
  $('license').href = `${repoUrl}/blob/main/LICENSE`

  const platform = detectPlatform(navigator, await platformHints())
  const mobile = document.querySelector('[data-dl-mobile]')
  if (mobile) mobile.hidden = platform.os !== 'mobile'
  orderSteps(platform)

  let release = null
  let status = 0
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    status = response.status
    if (response.ok) release = await response.json()
  } catch {
    // Offline or blocked: status stays 0, shown as an error.
  }
  const state = releaseState(status, release)
  if (state !== 'ready') return showNoRelease(state)

  const version = release.tag_name.replace(/^v/, '')
  renderMain(release, platform, version)
  renderCards(release)
  const meta = document.querySelector('[data-dl-meta]')
  if (meta) meta.textContent = `Latest: v${version} · ${formatDay(release.published_at)}`
  // The version, near the top of the page: it is the newest published release, so it follows every update.
  for (const line of document.querySelectorAll('[data-dl-version]')) {
    const strong = document.createElement('strong')
    strong.textContent = `Version ${version}`
    line.replaceChildren(strong, ` · released ${formatDay(release.published_at)}`)
    if (release.html_url) {
      const link = document.createElement('a')
      link.href = release.html_url
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = 'Release notes'
      line.append(' · ', link)
    }
  }
  const notesLink = document.querySelector('[data-dl-notes]')
  if (notesLink && release.html_url) notesLink.href = release.html_url
  const footer = $('footer-release')
  if (footer) footer.textContent = `Latest: v${version}`

  renderFiles(release, await loadSums(release))

  const notes = renderNotes(release.body || '')
  if (notes && $('notes')) {
    $('notes-title').textContent = `What’s new in ${version}`
    $('notes').innerHTML = notes
    $('notes-section').hidden = false
  }
}

main()

// Hero video: browsers only autoplay muted videos, so one button turns the music on (and back off).
const heroVideo = document.querySelector('[data-hero-video]')
const soundButton = document.querySelector('[data-sound]')
const setSound = (on) => {
  heroVideo.muted = !on
  if (on) {
    heroVideo.currentTime = 0
    void heroVideo.play()
  }
  soundButton.textContent = on ? '🔇 Sound off' : '🔊 Sound on'
  soundButton.setAttribute('aria-pressed', String(on))
}
if (heroVideo && soundButton) {
  soundButton.addEventListener('click', () => setSound(heroVideo.muted))
  // "Watch the video": scroll to the hero video and play it from the start with
  // the music on (the click counts as the visitor allowing sound).
  for (const watch of document.querySelectorAll('[data-watch]')) {
    watch.addEventListener('click', (event) => {
      event.preventDefault()
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches
      heroVideo.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
      setSound(true)
      soundButton.focus({ preventScroll: true })
    })
  }
}
