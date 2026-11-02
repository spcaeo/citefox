// A small Markdown reader for Docs/help/*.md: front matter, ## and ### headings,
// paragraphs, - and 1. lists, **bold**, *italic*, `code` and [links](url).
// The help topics use nothing else; anything unknown is kept as plain text.

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `{ meta, body }` from a file that starts with a `---` front matter block. */
export function parseFrontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return { meta: {}, body: source }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { meta, body: source.slice(match[0].length) }
}

/** Inline Markdown to HTML. `link(href)` may rewrite link targets. */
export function inline(text, link = (href) => href) {
  const parts = []
  let rest = String(text)
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/
  for (;;) {
    const m = pattern.exec(rest)
    if (!m) break
    parts.push(escapeHtml(rest.slice(0, m.index)))
    const token = m[0]
    if (m[1]) parts.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`)
    else if (m[2]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      parts.push(`<a href="${escapeHtml(link(href))}">${inline(label, link)}</a>`)
    } else if (m[3]) parts.push(`<strong>${inline(token.slice(2, -2), link)}</strong>`)
    else parts.push(`<em>${inline(token.slice(1, -1), link)}</em>`)
    rest = rest.slice(m.index + token.length)
  }
  parts.push(escapeHtml(rest))
  return parts.join('')
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Markdown blocks to HTML. Headings shift by `shift` levels (## becomes h2 with
 * shift 0). Returns the HTML, the headings (for a table of contents) and the
 * questions under a "Common questions" heading (for FAQPage data).
 */
export function renderMarkdown(body, { shift = 0, link } = {}) {
  const lines = body.split(/\r?\n/)
  const html = []
  const headings = []
  const faq = []
  let paragraph = []
  let list = null
  let inFaq = false
  let question = null

  const answerText = (text) => {
    if (question) question.answer.push(text)
  }
  const flushParagraph = () => {
    if (!paragraph.length) return
    const text = paragraph.join(' ')
    html.push(`<p>${inline(text, link)}</p>`)
    answerText(plain(text))
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    html.push(
      `<${list.tag}>${list.items.map((i) => `<li>${inline(i, link)}</li>`).join('')}</${list.tag}>`
    )
    answerText(list.items.map(plain).join(' '))
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = /^(#{2,4})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length + shift
      const text = heading[2]
      const id = slugify(text)
      headings.push({ level, text: plain(text), id })
      html.push(`<h${level} id="${id}">${inline(text, link)}</h${level}>`)
      if (heading[1].length === 2) {
        inFaq = /common questions|faq/i.test(text)
        question = null
      } else if (inFaq) {
        question = { question: plain(text), answer: [] }
        faq.push(question)
      }
    } else if (bullet || numbered) {
      flushParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      if (!list) list = { tag, items: [] }
      list.items.push((bullet || numbered)[1])
    } else if (line.trim() === '') {
      flushParagraph()
      flushList()
    } else if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flushParagraph()
  flushList()
  return {
    html: html.join('\n'),
    headings,
    faq: faq.map((q) => ({ question: q.question, answer: q.answer.join(' ') }))
  }
}

/** Markdown inline text without the marks. */
export function plain(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}
