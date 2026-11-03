// The download experience (Loom style): one big button for this computer, three
// OS cards, a 3-step install strip and a release row. Used at the top of the
// home page and on its own /download/ page. The HTML is static; site/app.js
// fills in the real files from the latest GitHub release (data-dl-* and
// data-asset attributes). Until then every link goes to the Releases page.
import { RELEASES_URL } from './config.mjs'
import {
  BROWSER,
  COMPARE,
  DOWNLOAD,
  HISTORY,
  KEY,
  NOTES,
  OPEN,
  OS_ICON,
  PLAY,
  REPORT,
  SHIELD
} from './icons.mjs'

const out = `href="${RELEASES_URL}" target="_blank" rel="noopener"`

/** A download link that app.js points at one release file (`<os>-<arch>-<kind>`). */
const asset = (key, label, cls) =>
  `<a class="${cls}" data-asset="${key}" ${out}>${cls.includes('dl-btn') ? DOWNLOAD : ''}<span class="dl-btn-label">${label}</span><span class="dl-size" data-size></span></a>`

/**
 * One call-to-action link in the site's button style: `primary` (solid fox),
 * `outline` (secondary) or `text` (a text button). Outside links open in a new window.
 */
export function cta(href, label, icon, variant = 'outline', attrs = '') {
  const outside = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''
  return `<a class="cta cta-${variant}" href="${href}"${outside}${attrs ? ` ${attrs}` : ''}>${icon}<span>${label}</span></a>`
}

/** The big Download for <OS> button (app.js sets its icon, label, file and size). */
function mainButton() {
  return `<a class="dl-main" data-dl-main data-state="loading" ${out}>
            <span class="dl-main-icon" data-dl-icon>${DOWNLOAD}</span>
            <span class="dl-main-text">
              <span class="dl-main-title" data-dl-title>Download CiteFox</span>
              <span class="dl-main-sub" data-dl-sub>Finding the latest version…</span>
            </span>
          </a>`
}

/** The state line under the big button and the phone note. */
function statusLines() {
  return `<p class="dl-version small" data-dl-version aria-live="polite"></p>
          <p class="dl-status" data-dl-status aria-live="polite"></p>
          <p class="note" data-dl-mobile hidden>CiteFox is a desktop app. Open this page on your Mac or PC to download it, or pick a file below.</p>`
}

/** The big button for the visitor's computer, with its state line (the /download/ page). */
export function primaryBlock() {
  return `<div class="dl-primary" data-dl-primary>
          ${mainButton()}
          ${statusLines()}
          <p class="dl-also small" data-dl-also>Free for Mac, Windows and Linux. <a href="#dl-cards">See every download</a></p>
        </div>`
}

/**
 * The home hero's actions: Download for <OS> (primary), Watch the video and
 * Try the live demo (secondary), then Sample reports, Compare and All
 * downloads (text buttons). `video` is false when the page has no product video.
 */
export function heroActions({ video }) {
  return `<div class="dl-primary hero-actions" data-dl-primary>
          <div class="cta-row">
            ${mainButton()}
${
  video
    ? `            ${cta('#hero-video', 'Watch the video', PLAY, 'outline', 'data-watch')}
`
    : ''
}            ${cta('demo/', 'Try the live demo', BROWSER)}
          </div>
          <div class="cta-row cta-row-text">
            ${cta('samples/', 'Sample reports', REPORT, 'text')}
            ${cta('compare/', 'Compare', COMPARE, 'text')}
            ${cta('#download', 'All downloads', DOWNLOAD, 'text')}
          </div>
          ${statusLines()}
          <p class="small muted hero-note">The demo runs in your browser with sample data. No install, no sign-up.</p>
        </div>`
}

const CARDS = [
  {
    os: 'mac',
    name: 'macOS',
    req: 'macOS 11 Big Sur or later. Apple chip and Intel.',
    primary: ['mac-universal-dmg', 'Universal .dmg'],
    secondary: null,
    more: [
      ['mac-arm64-dmg', 'Apple chip .dmg'],
      ['mac-x64-dmg', 'Intel .dmg']
    ],
    hint: 'Universal works on every Mac.'
  },
  {
    os: 'win',
    name: 'Windows',
    req: 'Windows 10 or 11, 64-bit.',
    primary: ['win-x64-installer', 'Installer .exe'],
    secondary: ['win-x64-portable', 'Portable .exe'],
    more: [
      ['win-arm64-installer', 'Arm installer'],
      ['win-arm64-portable', 'Arm portable']
    ],
    hint: 'Portable runs without installing. Windows may say “Windows protected your PC”: click More info, then Run anyway.'
  },
  {
    os: 'linux',
    name: 'Linux',
    req: 'x64 and arm64. .deb for Ubuntu and Debian.',
    primary: ['linux-x64-appimage', 'AppImage'],
    secondary: ['linux-x64-deb', '.deb package'],
    more: [
      ['linux-arm64-appimage', 'arm64 AppImage'],
      ['linux-arm64-deb', 'arm64 .deb']
    ],
    hint: 'AppImage runs on most distributions.'
  }
]

/** Three OS cards side by side (stacked on a phone). */
export function osCards(level = 3) {
  const h = `h${level}`
  return `<ul class="os-cards" id="dl-cards" aria-label="Downloads by operating system">
${CARDS.map(
  (c) => `          <li class="os-card" data-os="${c.os}">
            <span class="os-icon">${OS_ICON[c.os]}</span>
            <${h} class="os-name">${c.name}</${h}>
            <p class="os-req">${c.req}</p>
            <div class="os-actions">
              ${asset(c.primary[0], c.primary[1], 'dl-btn')}
${c.secondary ? `              ${asset(c.secondary[0], c.secondary[1], 'dl-btn dl-btn-2')}\n` : ''}            </div>
            <p class="os-more">${c.more.map(([key, label]) => asset(key, label, 'dl-link')).join('')}</p>
            <p class="os-hint">${c.hint}</p>
          </li>`
).join('\n')}
        </ul>`
}

/** "Install in a minute": Download → Open → Add your keys. */
export function installStrip(level = 3, stepsHref = 'download/#unsigned') {
  const h = `h${level}`
  return `<ol class="install" aria-label="Install in a minute">
          <li><span class="install-icon">${DOWNLOAD}</span><${h}>1. Download</${h}><p>Pick your computer above. It is one file, free, no sign-up.</p></li>
          <li><span class="install-icon">${OPEN}</span><${h}>2. Open</${h}><p>The app is not signed yet, so allow it once. Mac: click <strong>Done</strong>, then <strong>System Settings › Privacy &amp; Security › Open Anyway</strong>. Windows: <strong>More info</strong> › <strong>Run anyway</strong>. <a href="${stepsHref}">Full steps</a></p></li>
          <li><span class="install-icon">${KEY}</span><${h}>3. Add your keys and run a check</${h}><p>Paste your own API keys, add your site and buyer questions, then run your first check.</p></li>
        </ol>`
}

/** Release notes · Older versions · Checksums, plus the version and date. */
export function releaseRow(checksumsHref) {
  return `<div class="release-row">
          <p class="release-meta small muted" data-dl-meta></p>
          <nav class="release-links" aria-label="Release">
            <a class="cta cta-outline cta-sm" data-dl-notes ${out}>${NOTES}<span>Release notes</span></a>
            <a class="cta cta-outline cta-sm" ${out}>${HISTORY}<span>Older versions</span></a>
            <a class="cta cta-outline cta-sm" href="${checksumsHref}">${SHIELD}<span>Checksums (SHA-256)</span></a>
          </nav>
        </div>`
}

/** The heading line and section for the home page, right under the hero. */
export function homeDownload() {
  return `      <section class="wrap dl-section" id="download" aria-labelledby="download-title">
        <h2 id="download-title">Download CiteFox</h2>
        <p class="section-lead">Free for Mac, Windows and Linux. Pick your computer.</p>
        ${osCards(3)}
        <h3 class="install-title">Install in a minute</h3>
        ${installStrip(4, 'download/#unsigned')}
        ${releaseRow('download/#files-section')}
      </section>`
}

/** First start of an unsigned app, per OS (on /download/). */
function unsignedSteps() {
  return `<section id="unsigned" class="card" aria-labelledby="unsigned-title">
          <h2 id="unsigned-title">Opening CiteFox the first time</h2>
          <p>
            CiteFox is not signed with a paid certificate yet, so your computer asks once before the
            first start. This is expected. You can check every file against its SHA-256 below.
          </p>
          <p class="card">
            <strong>Skip the warning: install with one command.</strong> On a Mac or Linux, paste this into
            Terminal. It downloads the latest release from GitHub, checks it against its SHA-256 and
            installs it, so your computer does not ask first.
            <code data-copy>curl -fsSL https://spcaeo.github.io/citefox/install.sh | bash</code>
            <span class="small muted">Read the script first if you like: <a href="../install.sh">install.sh</a>.</span>
          </p>
          <div class="steps">
            <div class="step" data-os="mac">
              <h3>Mac</h3>
              <ol>
                <li>Open the downloaded <code>.dmg</code> and drag CiteFox to Applications.</li>
                <li>Open CiteFox once. macOS says it could not verify the app. Click <strong>Done</strong>.</li>
                <li>
                  Go to <strong>System Settings › Privacy &amp; Security</strong>, scroll to
                  “CiteFox was blocked…”, click <strong>Open Anyway</strong> and enter your password.
                </li>
                <li>
                  Or run one command in Terminal:
                  <code data-copy>xattr -dr com.apple.quarantine /Applications/CiteFox.app</code>
                </li>
              </ol>
              <p class="small muted">
                On macOS 14 or older, right-click CiteFox in Applications and choose
                <strong>Open</strong> also works. macOS 15 removed that shortcut.
              </p>
              <p class="small muted">
                After an update macOS may ask once to let CiteFox read its saved keys. Click
                <strong>Always Allow</strong>.
              </p>
            </div>
            <div class="step" data-os="win">
              <h3>Windows</h3>
              <ol>
                <li>Run the downloaded installer.</li>
                <li>
                  If you see “Windows protected your PC”, click <strong>More info</strong>, then
                  <strong>Run anyway</strong>.
                </li>
                <li>
                  CiteFox installs for you only (no admin needed) and adds a Start menu and desktop
                  shortcut.
                </li>
              </ol>
            </div>
            <div class="step" data-os="linux">
              <h3>Linux</h3>
              <ol>
                <li>
                  AppImage: allow it to run (Properties › Allow executing, or
                  <code data-copy>chmod +x CiteFox-*.AppImage</code>) and open it.
                </li>
                <li>
                  Ubuntu and Debian: install the <code>.deb</code> with
                  <code data-copy>sudo apt install ./CiteFox-*.deb</code>
                </li>
              </ol>
            </div>
          </div>
        </section>`
}

/** The /download/ page: the same blocks, plus first-start steps, every file with its checksum, and the notes. */
export function downloadPage({ page, breadcrumbs, breadcrumbData, software }) {
  const root = '../'
  const path = 'download/'
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Download', path }
  ]
  const body = `    <main id="main">
      <section class="wrap dl-page" aria-labelledby="dl-title">
        ${breadcrumbs(trail, root)}
        <h1 id="dl-title">Download CiteFox</h1>
        <p class="lead">The free AI visibility tracker for Mac, Windows and Linux. Source-available, your own API keys, your data on your computer.</p>
        ${primaryBlock()}
        ${osCards(2)}
        <h2 class="install-title">Install in a minute</h2>
        ${installStrip(3, '#unsigned')}
        ${releaseRow('#files-section')}
      </section>

      <div class="wrap">
        ${unsignedSteps()}

        <section id="files-section" class="card" aria-labelledby="files-title">
          <h2 id="files-title">All downloads and checksums</h2>
          <p class="small muted" data-files-empty>The file list appears here when the latest release is published. <a ${out}>See releases on GitHub</a></p>
          <div class="files-head small muted" hidden>
            <span>File</span><span>Size</span><span>SHA-256</span>
          </div>
          <ul id="files" class="files"></ul>
          <p id="sums" class="small"></p>
        </section>

        <section id="notes-section" class="card" aria-labelledby="notes-title" hidden>
          <h2 id="notes-title">What’s new</h2>
          <div id="notes" class="notes"></div>
        </section>
      </div>
    </main>`
  return {
    path,
    file: 'download/index.html',
    html: page({
      path,
      root,
      title: 'Download CiteFox for Mac, Windows and Linux (Free)',
      description:
        'Download CiteFox, the free AI visibility tracker: Universal .dmg for Mac, installer or portable .exe for Windows, AppImage and .deb for Linux, with checksums.',
      body,
      data: [breadcrumbData(trail), software],
      script: 'app.js',
      current: 'download',
      footerRelease: true
    })
  }
}
