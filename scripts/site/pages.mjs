// The pages of site/. Each returns `{ path, file, html }`.
import {
  CONTACT_EMAIL,
  LICENSE_URL,
  PUBLISHER,
  RELEASES_URL,
  REPO_URL,
  SITE_URL,
  TAGLINE
} from './config.mjs'
import {
  AUDIENCES,
  DIFFERENT,
  DOC_GROUPS,
  DOC_TITLES,
  ENGINES,
  FAQ,
  FEATURES,
  GEO_VS_SEO,
  GLOSSARY,
  MORE_FEATURES,
  REPORTS,
  STEPS
} from './content.mjs'
import { absolute, breadcrumbData, breadcrumbs, faqData, page } from './layout.mjs'
import { escapeHtml as e } from './markdown.mjs'

/** A screenshot from media (copied to site/media), or nothing if it is not made yet. */
function figure(media, name, alt, root, { eager = false, caption = '' } = {}) {
  const info = media[name]
  if (!info) return ''
  return `<figure class="shot"><img src="${root}media/${name}" alt="${e(alt)}" width="${info.width}" height="${info.height}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />${caption ? `<figcaption class="small muted">${e(caption)}</figcaption>` : ''}</figure>`
}

export function home({ media, version }) {
  const root = './'
  const software = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CiteFox',
    description:
      'A free desktop app that tracks whether Google AI Overviews, Google AI Mode, ChatGPT, Perplexity, Gemini and Copilot cite your website, shows who is cited instead, writes fix briefs and builds client-ready reports.',
    url: SITE_URL,
    downloadUrl: RELEASES_URL,
    operatingSystem: 'macOS, Windows, Linux',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'SEO software',
    softwareVersion: version,
    image: absolute('og.png'),
    screenshot: media['hero.png'] ? absolute('media/hero.png') : undefined,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    isAccessibleForFree: true,
    license: LICENSE_URL,
    codeRepository: REPO_URL,
    publisher: { '@type': 'Organization', name: PUBLISHER.name, url: PUBLISHER.url },
    author: { '@type': 'Organization', name: PUBLISHER.name, url: PUBLISHER.url },
    keywords:
      'AI visibility tracker, AI Overview tracker, GEO, AEO, LLM SEO, generative engine optimization, answer engine optimization, AI citation tracking'
  }
  const faq = FAQ.map(({ q, a }) => ({ question: q, answer: a }))
  const video = media['demo.mp4']
    ? `<video class="shot" controls preload="none" playsinline${media['hero.png'] ? ` poster="media/hero.png"` : ''} width="${media['hero.png']?.width || 1600}" height="${media['hero.png']?.height || 1000}"><source src="media/demo.mp4" type="video/mp4" />Your browser cannot play this video.</video>`
    : ''

  const body = `    <main id="main">
      <section class="hero wrap" id="download">
        <p class="eyebrow">Free desktop app · Mac, Windows and Linux · Source-available</p>
        <h1>Free AI visibility tracker for Google AI Overviews, ChatGPT and Perplexity</h1>
        <p class="lead">
          CiteFox shows whether AI answers cite your website for the questions your buyers ask,
          which page they cite, who they cite instead, and what to fix. Your keys and data stay on
          your computer.
        </p>
        <div id="primary" class="primary" aria-live="polite">
          <p class="muted">Finding the latest version…</p>
        </div>
        <p id="release-meta" class="muted small"></p>
        <p id="mobile-note" class="note" hidden>
          CiteFox is a desktop app. Open this page on your Mac or PC to download it.
        </p>
        <p id="other-platforms" class="small"></p>
        ${figure(media, 'hero.png', 'CiteFox showing which buyer questions AI answers cite your site for, by engine', root, { eager: true })}
      </section>

      <section class="band" id="features" aria-labelledby="features-title">
        <div class="wrap">
          <h2 id="features-title">Track your citations in AI search, then win more of them</h2>
          <p class="section-lead">GEO and AEO tools for agencies and marketing teams, in one free desktop app.</p>
          <div class="features">
${FEATURES.map(
  (f) => `            <article class="feature">
              <h3>${e(f.title)}</h3>
              <p>${e(f.text)}</p>
              ${figure(media, f.image, f.alt, root)}
            </article>`
).join('\n')}
          </div>
          <h3 class="sub">Also included</h3>
          <ul class="ticks">
${MORE_FEATURES.map((t) => `            <li>${e(t)}</li>`).join('\n')}
          </ul>
        </div>
      </section>

      <section class="wrap" aria-labelledby="how-title">
        <h2 id="how-title">How CiteFox works</h2>
        <ol class="how">
${STEPS.map((s) => `          <li><h3>${e(s.title)}</h3><p>${e(s.text)}</p></li>`).join('\n')}
        </ol>
        ${video}
      </section>

      <section class="wrap" id="engines" aria-labelledby="engines-title">
        <h2 id="engines-title">Supported AI engines</h2>
        <p>Every buyer question is asked on each engine you pick, in each market (country and language) you sell in.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">Engine</th><th scope="col">What CiteFox records</th></tr></thead>
            <tbody>
${ENGINES.map((x) => `              <tr><th scope="row">${e(x.name)}</th><td>${e(x.what)}</td></tr>`).join('\n')}
            </tbody>
          </table>
        </div>
        <p class="small muted">For every answer: whether your page is cited, which page, your brand named without a link, or not there at all, plus every other site cited.</p>
      </section>

      <section class="band" id="reports" aria-labelledby="reports-title">
        <div class="wrap">
          <h2 id="reports-title">Client-ready AI visibility reports</h2>
          <p class="section-lead">Rebuilt after every check. Read them in the app, download offline HTML, PDF or CSV, or email them on a schedule, with your agency’s name and logo.</p>
          <ul class="cards">
${REPORTS.map((x) => `            <li class="mini"><h3><a href="docs/${x.doc}/">${e(x.name)}</a></h3><p>${e(x.text)}</p></li>`).join('\n')}
          </ul>
          ${figure(media, 'report-visibility.png', 'The CiteFox Visibility report with share of voice and the questions that cite you', root)}
        </div>
      </section>

      <section class="wrap" aria-labelledby="who-title">
        <h2 id="who-title">Who CiteFox is for</h2>
        <ul class="cards three">
${AUDIENCES.map((x) => `          <li class="mini"><h3>${e(x.title)}</h3><p>${e(x.text)}</p></li>`).join('\n')}
        </ul>
      </section>

      <section class="wrap" aria-labelledby="geo-title">
        <h2 id="geo-title">GEO vs SEO: why AI citations matter</h2>
${GEO_VS_SEO.map((t) => `        <p>${e(t)}</p>`).join('\n')}
        <p><a href="glossary/">Read the GEO and AEO glossary</a></p>
      </section>

      <section class="wrap" aria-labelledby="diff-title">
        <h2 id="diff-title">What makes CiteFox different</h2>
        <ul class="ticks">
${DIFFERENT.map((t) => `          <li>${e(t)}</li>`).join('\n')}
        </ul>
        <p class="small muted">Your projects stay on your computer. CiteFox sends its maker only the details you give when you join and an anonymous daily version ping. <a href="${REPO_URL}/blob/main/Docs/PRIVACY.md" target="_blank" rel="noopener">Privacy details</a></p>
      </section>

      <section class="band" id="faq" aria-labelledby="faq-title">
        <div class="wrap">
          <h2 id="faq-title">Frequently asked questions</h2>
          <div class="faq">
${FAQ.map((x) => `            <div class="qa"><h3>${e(x.q)}</h3><p>${e(x.a)}</p></div>`).join('\n')}
          </div>
        </div>
      </section>

      <div class="wrap">
        <section id="unsigned" class="card" aria-labelledby="unsigned-title">
          <h2 id="unsigned-title">Opening CiteFox the first time</h2>
          <p>
            CiteFox is not signed with a paid certificate yet, so your computer asks once before the
            first start. This is expected. You can check every file against its SHA-256 below.
          </p>
          <div class="steps">
            <div class="step" data-os="mac">
              <h3>Mac</h3>
              <ol>
                <li>Open the downloaded <code>.dmg</code> and drag CiteFox to Applications.</li>
                <li>Open CiteFox. macOS says it cannot check the app. Click <strong>Done</strong>.</li>
                <li>
                  Open <strong>System Settings › Privacy &amp; Security</strong>, scroll down and
                  click <strong>Open Anyway</strong> next to CiteFox. Confirm with your password.
                </li>
                <li>
                  On macOS 14 or older you can instead right-click CiteFox in Applications and choose
                  <strong>Open</strong>.
                </li>
              </ol>
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
        </section>

        <section id="files-section" class="card" aria-labelledby="files-title" hidden>
          <h2 id="files-title">All downloads</h2>
          <div class="files-head small muted">
            <span>File</span><span>Size</span><span>SHA-256</span>
          </div>
          <ul id="files" class="files"></ul>
          <p id="sums" class="small"></p>
        </section>

        <section id="notes-section" class="card" aria-labelledby="notes-title" hidden>
          <h2 id="notes-title">What’s new</h2>
          <div id="notes" class="notes"></div>
        </section>

        <p class="small">
          <a id="older" href="${RELEASES_URL}" target="_blank" rel="noopener">Older versions and betas</a>
        </p>
      </div>
    </main>`

  return {
    path: '',
    file: 'index.html',
    html: page({
      path: '',
      root,
      title: 'CiteFox: Free AI Visibility Tracker for AI Overviews & ChatGPT',
      description:
        'Free desktop app that tracks whether Google AI Overviews, ChatGPT, Perplexity, Gemini and Copilot cite your site. GEO and AEO reports for agencies. Mac, Windows, Linux.',
      body,
      data: [software, faqData(faq)],
      script: 'app.js',
      footerRelease: true
    })
  }
}

function docsNav(docs, root, currentId) {
  return DOC_GROUPS.map(
    (group) =>
      `<div class="docs-group"><p class="docs-group-title">${e(group.title)}</p><ul>${group.ids
        .map((id) => {
          const doc = docs[id]
          const here = id === currentId
          return `<li><a href="${root}docs/${id}/"${here ? ' aria-current="page"' : ''}>${e(doc.meta.title)}</a></li>`
        })
        .join('')}</ul></div>`
  ).join('')
}

/** Every help topic in the order of DOC_GROUPS. */
export function docOrder() {
  return DOC_GROUPS.flatMap((g) => g.ids)
}

export function docsIndex({ docs }) {
  const root = '../'
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Docs', path: 'docs/' }
  ]
  const body = `    <main id="main" class="wrap doc">
      ${breadcrumbs(trail, root)}
      <h1>CiteFox documentation</h1>
      <p class="lead left">How to track your website’s citations in Google AI Overviews, ChatGPT, Perplexity and other AI answers with CiteFox: every screen and every report, in plain words.</p>
${DOC_GROUPS.map(
  (group) => `      <section aria-labelledby="g-${group.ids[0]}">
        <h2 id="g-${group.ids[0]}">${e(group.title)}</h2>
        <ul class="cards">
${group.ids
  .map(
    (id) =>
      `          <li class="mini"><h3><a href="${id}/">${e(docs[id].meta.title)}</a></h3><p>${e(docs[id].meta.summary)}</p></li>`
  )
  .join('\n')}
        </ul>
      </section>`
).join('\n')}
      <section aria-labelledby="more-title">
        <h2 id="more-title">More</h2>
        <ul>
          <li><a href="../glossary/">GEO and AEO glossary</a>: AI Overview, citation, share of voice and more.</li>
          <li><a href="../#faq">Frequently asked questions</a></li>
          <li><a href="${REPO_URL}/issues" target="_blank" rel="noopener">Report a bug or ask for a feature</a></li>
        </ul>
      </section>
    </main>`
  return {
    path: 'docs/',
    file: 'docs/index.html',
    html: page({
      path: 'docs/',
      root,
      title: 'CiteFox Docs: AI Visibility Tracking Help and Guides',
      description:
        'Guides for CiteFox, the free AI visibility tracker: setup, every screen, the six AI visibility reports and the words CiteFox uses.',
      body,
      data: [breadcrumbData(trail)],
      current: 'docs'
    })
  }
}

export function docPage({ docs, id }) {
  const root = '../../'
  const doc = docs[id]
  const order = docOrder()
  const at = order.indexOf(id)
  const prev = at > 0 ? docs[order[at - 1]] : null
  const next = at < order.length - 1 ? docs[order[at + 1]] : null
  const path = `docs/${id}/`
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Docs', path: 'docs/' },
    { name: doc.meta.title, path }
  ]
  const toc = doc.rendered.headings.filter((h) => h.level === 2)
  const seo = DOC_TITLES[id] || doc.meta.title
  const summary = doc.meta.summary || ''
  const description =
    `${summary} ${summary.length < 90 ? 'Help for CiteFox, the free AI visibility tracker for AI Overviews and ChatGPT.' : 'CiteFox help.'}`.trim()
  const data = [breadcrumbData(trail)]
  if (doc.rendered.faq.length) data.push(faqData(doc.rendered.faq))
  data.push({
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: seo,
    description: summary,
    url: absolute(path),
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'CiteFox', url: SITE_URL },
    about: { '@type': 'SoftwareApplication', name: 'CiteFox', url: SITE_URL },
    publisher: { '@type': 'Organization', name: PUBLISHER.name, url: PUBLISHER.url }
  })

  const body = `    <main id="main" class="wrap doc-layout">
      <aside class="docs-nav small" aria-label="Docs topics">${docsNav(docs, root, id)}</aside>
      <article class="doc">
        ${breadcrumbs(trail, root)}
        <h1>${e(seo)}</h1>
        <p class="lead left">${e(summary)}</p>
${toc.length > 2 ? `        <nav class="toc small" aria-label="On this page"><p class="docs-group-title">On this page</p><ul>${toc.map((h) => `<li><a href="#${h.id}">${e(h.text)}</a></li>`).join('')}</ul></nav>\n` : ''}        <div class="prose">
${doc.rendered.html}
        </div>
        <nav class="pager" aria-label="More topics">
          ${prev ? `<a class="prev" href="../${prev.meta.id}/"><span class="small muted">Previous</span>${e(prev.meta.title)}</a>` : '<span></span>'}
          ${next ? `<a class="next" href="../${next.meta.id}/"><span class="small muted">Next</span>${e(next.meta.title)}</a>` : '<span></span>'}
        </nav>
        <p class="small muted">Something unclear? <a href="mailto:${CONTACT_EMAIL}">Write to us</a> or <a href="${REPO_URL}/issues" target="_blank" rel="noopener">open an issue</a>.</p>
      </article>
    </main>`
  return {
    path,
    file: `docs/${id}/index.html`,
    html: page({
      path,
      root,
      title: `${seo} | CiteFox Docs`,
      description,
      body,
      data,
      type: 'article',
      current: 'docs'
    })
  }
}

export function glossary() {
  const root = '../'
  const path = 'glossary/'
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Glossary', path }
  ]
  const terms = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    name: 'GEO and AEO glossary',
    url: absolute(path),
    hasDefinedTerm: GLOSSARY.map((t) => ({
      '@type': 'DefinedTerm',
      name: t.term,
      description: t.text,
      url: absolute(`${path}#${t.id}`)
    }))
  }
  const body = `    <main id="main" class="wrap doc">
      ${breadcrumbs(trail, root)}
      <h1>GEO and AEO glossary: AI search terms explained</h1>
      <p class="lead left">Plain definitions of generative engine optimization, answer engine optimization, AI Overviews, AI citations and the other words used in AI search visibility.</p>
      <nav class="toc small" aria-label="Terms"><ul class="inline-list">${GLOSSARY.map((t) => `<li><a href="#${t.id}">${e(t.term.replace(/ \(.*\)$/, ''))}</a></li>`).join('')}</ul></nav>
      <div class="glossary">
${GLOSSARY.map((t) => `        <section class="term" id="${t.id}"><h2>${e(t.term)}</h2><p>${e(t.text)}</p></section>`).join('\n')}
      </div>
      <section aria-labelledby="geo-seo">
        <h2 id="geo-seo">GEO vs SEO</h2>
${GEO_VS_SEO.map((t) => `        <p>${e(t)}</p>`).join('\n')}
      </section>
      <section aria-labelledby="measure">
        <h2 id="measure">Measure your AI search visibility</h2>
        <p>CiteFox is a free desktop app that checks your buyer questions in ${ENGINES.map(
          (x) => x.name
        )
          .join(', ')
          .replace(/, ([^,]*)$/, ' and $1')}, and shows which of your pages each answer cites.</p>
        <p><a class="button" href="../#download">Download CiteFox</a></p>
        <p class="small">The words the app itself uses (Right page, Named, not cited, Target page) are in <a href="../docs/glossary/">Words CiteFox uses</a>.</p>
      </section>
    </main>`
  return {
    path,
    file: 'glossary/index.html',
    html: page({
      path,
      root,
      title: 'GEO & AEO Glossary: AI Overviews, AI Citations, LLM SEO | CiteFox',
      description:
        'What GEO, AEO, LLM SEO, AI Overviews, AI citations and AI share of voice mean, in plain words. A glossary of AI search visibility terms.',
      body,
      data: [breadcrumbData(trail), terms],
      current: 'glossary'
    })
  }
}

export function notFound() {
  const root = SITE_URL
  const body = `    <main id="main" class="wrap doc">
      <h1>Page not found</h1>
      <p class="lead left">This page does not exist, or it has moved.</p>
      <ul>
        <li><a href="${root}">Download CiteFox</a></li>
        <li><a href="${root}docs/">Read the docs</a></li>
        <li><a href="${root}glossary/">GEO and AEO glossary</a></li>
      </ul>
    </main>`
  return {
    path: '404.html',
    file: '404.html',
    html: page({
      path: '404.html',
      root,
      title: 'Page not found | CiteFox',
      description:
        'This page of the CiteFox site does not exist. Download CiteFox or read the docs.',
      body,
      noindex: true
    })
  }
}

export { TAGLINE }
