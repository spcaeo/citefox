import type { SuggestedFaq } from '@shared/domain'

/** One schema.org FAQPage (https://schema.org/FAQPage) for the given drafts. */
export interface FaqPageJsonLd {
  '@context': 'https://schema.org'
  '@type': 'FAQPage'
  mainEntity: {
    '@type': 'Question'
    name: string
    acceptedAnswer: { '@type': 'Answer'; text: string }
  }[]
}

/**
 * The drafts as FAQPage structured data, ready to paste inside a
 * `<script type="application/ld+json">` on the page. Empty drafts are left
 * out; repeated questions keep the first answer (Google reads one per question).
 */
export function faqPageJsonLd(faqs: readonly (SuggestedFaq | null)[]): FaqPageJsonLd {
  const seen = new Set<string>()
  const mainEntity: FaqPageJsonLd['mainEntity'] = []
  for (const faq of faqs) {
    if (!faq) continue
    const name = faq.question.trim()
    const text = faq.answer.trim()
    const key = name.toLowerCase()
    if (!name || !text || seen.has(key)) continue
    seen.add(key)
    mainEntity.push({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })
  }
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity }
}

/** The JSON-LD as pretty-printed text, or null when no draft has a question and answer. */
export function faqPageJsonLdText(faqs: readonly (SuggestedFaq | null)[]): string | null {
  const data = faqPageJsonLd(faqs)
  return data.mainEntity.length === 0 ? null : JSON.stringify(data, null, 2)
}

/** Words in a text, as the draft counter shows them. */
export function draftWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Brand names the text mentions (case-insensitive, whole words). */
export function brandsNamed(text: string, brands: readonly string[]): string[] {
  const lower = text.toLowerCase()
  return brands.filter((brand) => {
    const name = brand.trim().toLowerCase()
    if (!name) return false
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(lower)
  })
}
