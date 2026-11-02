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
  CONTROL,
  DIFFERENT,
  EDITIONS,
  KEYS,
  KEYS_NOTES,
  PRIVATE,
  REPORT_EXTRAS,
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
import { SAMPLES } from './samples.mjs'
import { escapeHtml as e } from './markdown.mjs'
import { cta, downloadPage, heroActions, homeDownload } from './download.mjs'
import { ARROW, BROWSER, DOWNLOAD, REPORT } from './icons.mjs'

/** A screenshot from media (copied to site/media), or nothing if it is not made yet. */
function figure(media, name, alt, root, { eager = false, caption = '' } = {}) {
  const info = media[name]
  if (!info) return ''
  // The link opens the full-size image; site/lightbox.js turns it into a zoomed view.
  return `<figure class="shot"><a class="zoom" href="${root}media/${name}" data-zoom><img src="${root}media/${name}" alt="${e(alt)}" width="${info.width}" height="${info.height}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" /></a>${caption ? `<figcaption class="small muted">${e(caption)}</figcaption>` : ''}</figure>`
}

/** SoftwareApplication JSON-LD for the home and download pages. */
function softwareData(media, version) {
  return {
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
}

export function download({ media, version }) {
  return downloadPage({ page, breadcrumbs, breadcrumbData, software: softwareData(media, version) })
}

export function home({ media, version }) {
  const root = './'
  const software = softwareData(media, version)
  const faq = FAQ.map(({ q, a }) => ({ question: q, answer: a }))
  // The product video plays silently in the hero (autoplay needs muted); the link opens
  // the same video with its music. Without it the hero shows the screenshot.
  const poster = media['demo-poster.png']
  const heroMedia = media['demo.mp4']
    ? `<figure class="shot hero-video" id="hero-video"><video class="shot" data-hero-video autoplay muted loop playsinline preload="auto"${poster ? ` poster="${root}media/demo-poster.png" width="${poster.width}" height="${poster.height}"` : ''} aria-label="CiteFox product video: how often AI answers cite you, which page wins, who is cited instead, what to fix, and client-ready reports"><source src="${root}media/demo.mp4" type="video/mp4" /></video><button type="button" class="sound-btn" data-sound aria-pressed="false">🔊 Sound on</button><figcaption class="small">A 75-second tour with music. Browsers start videos muted: press <strong>Sound on</strong> to hear it.</figcaption></figure>`
    : figure(
        media,
        'hero.png',
        'CiteFox showing which buyer questions AI answers cite your site for, by engine',
        root,
        { eager: true }
      )
  const video = media['demo-silent.mp4']
    ? figure(
        media,
        'hero.png',
        'CiteFox showing which buyer questions AI answers cite your site for, by engine',
        root
      )
    : ''

  const body = `    <main id="main">
      <section class="hero wrap">
        <p class="eyebrow">Free desktop app · Mac, Windows and Linux · Source-available</p>
        <h1>Free AI visibility tracker for Google AI Overviews, ChatGPT and Perplexity</h1>
        <p class="lead">
          Know whether AI answers recommend you when buyers ask, which of your pages they cite,
          which competitor they pick instead, and exactly what to fix to win them back. A free, local
          alternative to Profound, Peec AI, Otterly.AI and Semrush’s AI toolkit.
        </p>
        ${heroActions({ video: Boolean(media['demo.mp4']) })}
        <ul class="pills" aria-label="In short">
          <li>Bring your own API keys</li>
          <li>Data stays on your computer</li>
          <li>Six client-ready reports</li>
          <li>Server edition coming soon</li>
        </ul>
        ${heroMedia}
      </section>

${homeDownload()}

      <section class="wrap" id="keys" aria-labelledby="keys-title">
        <h2 id="keys-title">Pay only for what you use, and keep your data</h2>
        <p class="section-lead">CiteFox is free. Checks run on your own pay-as-you-go accounts, so you pay the services directly at their price, nobody marks it up, and your data never leaves your computer.</p>
        <div class="split">
          <div class="mini">
            <h3>What you connect</h3>
            <dl class="pairs">
${KEYS.map((k) => `              <dt>${e(k.title)}</dt><dd>${e(k.text)}</dd>`).join('\n')}
            </dl>
            <ul class="ticks">
${KEYS_NOTES.map((t) => `              <li>${e(t)}</li>`).join('\n')}
            </ul>
          </div>
          <div class="mini">
            <h3>Local and private</h3>
            <ul class="ticks">
${PRIVATE.map((t) => `              <li>${e(t)}</li>`).join('\n')}
            </ul>
            <p class="small muted">CiteFox itself receives only the details you give when you join and an anonymous daily version ping. <a href="${REPO_URL}/blob/main/Docs/PRIVACY.md" target="_blank" rel="noopener">Privacy details</a></p>
          </div>
        </div>
      </section>

      <section class="band" id="why" aria-labelledby="why-title">
        <div class="wrap">
          <h2 id="why-title">What you get with CiteFox</h2>
          <ul class="cards three">
${DIFFERENT.map((x) => `            <li class="mini"><h3>${e(x.title)}</h3><p>${e(x.text)}</p></li>`).join('\n')}
          </ul>
          <p class="cta-row cta-row-left">${cta('compare/', 'See the sourced comparison with Profound, Peec AI, Otterly.AI and six more', ARROW, 'text')}</p>
        </div>
      </section>

      <section class="band" id="features" aria-labelledby="features-title">
        <div class="wrap">
          <h2 id="features-title">Win the AI answers your buyers read</h2>
          <p class="section-lead">Find out where AI search cites you, where it picks a competitor, and what to change, with GEO and AEO tools for agencies and marketing teams in one free desktop app.</p>
          <div class="features">
${FEATURES.map(
  (f) => `            <article class="feature">
              <h3>${e(f.title)}</h3>
              <p>${e(f.text)}</p>
              ${figure(media, f.image, f.alt, root)}
            </article>`
).join('\n')}
          </div>
          <h3 class="sub">Also in the app</h3>
          <ul class="ticks">
${MORE_FEATURES.map((t) => `            <li>${e(t)}</li>`).join('\n')}
          </ul>
        </div>
      </section>

      <section class="wrap" aria-labelledby="how-title">
        <h2 id="how-title">From your website to your first fixes in three steps</h2>
        <ol class="how">
${STEPS.map((s) => `          <li><h3>${e(s.title)}</h3><p>${e(s.text)}</p></li>`).join('\n')}
        </ol>
        ${video}
      </section>

      <section class="wrap" id="engines" aria-labelledby="engines-title">
        <h2 id="engines-title">See every AI engine your buyers use, side by side</h2>
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

      <section class="wrap" id="real-answers" aria-labelledby="real-title">
        <h2 id="real-title">Decide on real AI answers, not guessed “prompt volume”</h2>
        <p><strong>Nobody has real prompt volume data.</strong> ChatGPT, Perplexity and Gemini don’t publish how often a question is asked, so every “prompt volume” figure is a modelled estimate (<a href="https://ahrefs.com/blog/how-ahrefs-estimates-ai-search-demand/" target="_blank" rel="noopener">Ahrefs</a> notes only Microsoft Copilot shares query data).</p>
        <p><strong>Chat assistants answer each person differently.</strong> ChatGPT can use your saved memories and past chats to tailor replies (<a href="https://help.openai.com/en/articles/8590148" target="_blank" rel="noopener">OpenAI help</a>), and other assistants now remember earlier conversations too.</p>
        <p><strong>Google’s AI Overviews are the steadier signal.</strong> No personal chat memory, and Google aims to keep results mostly the same for everyone. The wording stays close from day to day while the cited sources rotate (<a href="https://ahrefs.com/blog/ai-overview-change/" target="_blank" rel="noopener">Ahrefs</a>), so CiteFox anchors on AI Overviews, checks the other engines beside it, and re-checks on a schedule.</p>
        <ol class="how">
          <li><h3>Your real buyer questions</h3><p>Asked the three ways people ask: a short search, a question and a longer situation. Never with your brand name, so you see whether AI finds you on its own.</p></li>
          <li><h3>Real answers, again and again</h3><p>Every check keeps the full answer and every source, so you follow trends, not one lucky or unlucky answer.</p></li>
          <li><h3>The right page for each question</h3><p>A Primary page plus Also OK pages, so “cited” means the page you want, and every fix is measured before and after.</p></li>
        </ol>
      </section>

      <section class="band" id="reports" aria-labelledby="reports-title">
        <div class="wrap">
          <h2 id="reports-title">Prove results to clients in one click</h2>
          <p class="section-lead">Six client-ready AI visibility reports, rebuilt after every check. Each answers one question a client or a boss asks.</p>
          <p class="cta-row cta-row-left">${cta('samples/', 'See the sample reports', REPORT, 'outline')}${cta('demo/#/reports', 'Try Reports in the live demo', BROWSER, 'text')}</p>
          <ul class="cards">
${REPORTS.map((x) => `            <li class="mini"><h3><a href="docs/${x.doc}/">${e(x.name)}</a></h3><p>${e(x.text)}</p><p class="small muted">For: ${e(x.who)}</p></li>`).join('\n')}
          </ul>
          <ul class="ticks">
${REPORT_EXTRAS.map((t) => `            <li>${e(t)}</li>`).join('\n')}
          </ul>
          <p><a href="samples/">Open the sample reports</a>, the same offline HTML files the app downloads, or <a href="demo/#/reports">try Reports in the live demo</a>.</p>
          ${figure(media, 'report-visibility.png', 'The CiteFox Visibility report with share of voice and the questions that cite you', root)}
        </div>
      </section>

      <section class="wrap" aria-labelledby="who-title">
        <h2 id="who-title">Built for the people who answer for AI visibility</h2>
        <ul class="cards three">
${AUDIENCES.map((x) => `          <li class="mini"><h3>${e(x.title)}</h3><p>${e(x.text)}</p></li>`).join('\n')}
        </ul>
      </section>

      <section class="wrap" aria-labelledby="geo-title">
        <h2 id="geo-title">GEO vs SEO: why AI citations matter</h2>
${GEO_VS_SEO.map((t) => `        <p>${e(t)}</p>`).join('\n')}
        <p><a href="glossary/">Read the GEO and AEO glossary</a></p>
      </section>

      <section class="wrap" aria-labelledby="control-title">
        <h2 id="control-title">Own your data, your costs and your client work</h2>
        <ul class="ticks two">
${CONTROL.map((t) => `          <li>${e(t)}</li>`).join('\n')}
        </ul>
        <p class="card"><strong>Pairs with Skald for AI crawlers and traffic.</strong> <a href="https://github.com/spcaeo/skald" target="_blank" rel="noopener">Skald</a> is our free analytics that runs on your own server and reads its access log: every AI crawler and assistant visit by name, checked to be real, split by why it came, plus the people and leads AI answers sent you. CiteFox shows what AI says about you; Skald shows what AI does on your site.</p>
      </section>

      <section class="wrap" id="editions" aria-labelledby="editions-title">
        <h2 id="editions-title">Editions and roadmap</h2>
        <ul class="cards editions">
${EDITIONS.map((x) => `          <li class="mini"><p class="status${x.status.startsWith('Free') ? ' now' : ''}">${e(x.status)}</p><h3>${e(x.name)}</h3><p>${e(x.text)}</p></li>`).join('\n')}
        </ul>
        <p>Want early access to Server, the managed service or the MCP server? Email <a href="mailto:${CONTACT_EMAIL}?subject=CiteFox%20early%20access" data-copy="${CONTACT_EMAIL}" data-what="email">${CONTACT_EMAIL}</a>.</p>
      </section>

      <section class="band" id="faq" aria-labelledby="faq-title">
        <div class="wrap">
          <h2 id="faq-title">Frequently asked questions</h2>
          <div class="faq">
${FAQ.map((x) => `            <div class="qa"><h3>${e(x.q)}</h3><p>${e(x.a)}</p></div>`).join('\n')}
          </div>
        </div>
      </section>

    </main>`

  return {
    path: '',
    file: 'index.html',
    html: page({
      path: '',
      root,
      title: 'CiteFox: Free AI Visibility Tracker, Local Alternative to Profound',
      description:
        'Free AI visibility tracker: see if AI Overviews, ChatGPT, Perplexity, Gemini and Copilot cite your site. Your own API keys, data on your computer, 6 client reports.',
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
        <p class="cta-row cta-row-left">${cta('../download/', 'Download CiteFox', DOWNLOAD, 'primary')}${cta('../demo/', 'Try the live demo', BROWSER)}</p>
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

/**
 * The sample report gallery (samples/): one card per ready report, linking to the
 * standalone report that `npm run samples:build` writes. `thumbs` names the
 * screenshots found in media/samples/ (made by `npm run demo:check -- --thumbs`).
 */
export function samplesIndex({ thumbs = {} } = {}) {
  const root = '../'
  const path = 'samples/'
  const trail = [
    { name: 'Home', path: '' },
    { name: 'Sample reports', path }
  ]
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'CiteFox sample reports',
    itemListElement: SAMPLES.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: `${s.title} (sample)`,
      url: absolute(`${path}${s.slug}/`)
    }))
  }
  const card = (s) => {
    const thumb = thumbs[s.slug]
    const img = thumb
      ? `<a class="sample-thumb" href="${s.slug}/" tabindex="-1" aria-hidden="true"><img src="${root}media/samples/${thumb}" alt="" width="1440" height="900" loading="lazy" decoding="async" /></a>`
      : ''
    return `          <li class="mini sample">${img}<p class="eyebrow small">${e(s.goal)}</p><h2><a href="${s.slug}/">${e(s.title)}</a></h2><p>${e(s.description)}</p></li>`
  }
  const body = `    <main id="main" class="wrap doc wide">
      ${breadcrumbs(trail, root)}
      <h1>Sample AI visibility reports</h1>
      <p class="lead left">Six client-ready reports made by CiteFox for a sample site, exactly as the app downloads them (Download › Offline HTML). Open one, click any number to see its list, and switch engines at the top.</p>
      <ul class="cards samples">
${SAMPLES.map(card).join('\n')}
      </ul>
      <p class="cta-row cta-row-left">${cta('../demo/#/reports', 'Try Reports in the live demo', BROWSER)}${cta('../download/', 'Download CiteFox', DOWNLOAD, 'text')}</p>
      <p class="small muted">The sample site, its questions and its results are made up for this demo. Read how each report works in the <a href="../docs/">docs</a>.</p>
    </main>`
  return {
    path,
    file: 'samples/index.html',
    html: page({
      path,
      root,
      title: 'Sample AI Visibility Reports for Clients | CiteFox',
      description:
        'Six sample AI visibility reports made with CiteFox: visibility, what changed, impact review, pitch audit, content plan and head-to-head. Open them in your browser.',
      body,
      data: [breadcrumbData(trail), list],
      current: 'samples'
    })
  }
}

export function notFound() {
  const root = SITE_URL
  const body = `    <main id="main" class="wrap doc">
      <h1>Page not found</h1>
      <p class="lead left">This page does not exist, or it has moved.</p>
      <ul>
        <li><a href="${root}download/">Download CiteFox</a></li>
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
