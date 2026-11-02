import { SHIPPED_TEMPLATE_NAME, type GenerationTemplateKind } from '@shared/domain'

export interface ShippedTemplate {
  id: string
  kind: GenerationTemplateKind
  name: string
  body: string
}

/**
 * Shipped wording for the three generation templates.
 * Variables stay in Nunjucks `{{ name }}` form. Project overrides are a later milestone.
 */
export const SHIPPED_TEMPLATES: readonly ShippedTemplate[] = [
  {
    id: 'buyer-profile',
    kind: 'buyer_profile',
    name: SHIPPED_TEMPLATE_NAME,
    body: [
      'You are a B2B marketer describing who reads this page and buys from it.',
      '',
      'Page: {{ url }}',
      'Title: {{ title }}',
      'Meta description: {{ meta_description }}',
      'H1: {{ h1 }}',
      'Main text:',
      '{{ page_text }}',
      '',
      'Brand: {{ brand_name }}.',
      '',
      'Describe the buyer in six parts: who, environment, strongest segments, trigger events, what they value, and poor fit with reasons.',
      "Use plain sentences. Don't invent anything the page doesn't support."
    ].join('\n')
  },
  {
    id: 'buyer-prompts',
    kind: 'buyer_prompts',
    name: SHIPPED_TEMPLATE_NAME,
    body: [
      'You are helping a marketer find the questions their buyers type into Google before they know any brand.',
      '',
      'Step 1 · Read the live page',
      'URL: {{ url }}',
      'Title: {{ title }}',
      'Meta description: {{ meta_description }}',
      'H1: {{ h1 }}',
      'Main text:',
      '{{ page_text }}',
      '',
      'Step 2 · Analyse what the page promises',
      "Say what the title, meta description and H1 each promise. Point out where they don't match, and anything Google will cut off (titles over about 60 characters).",
      '',
      'Step 3 · Write the questions',
      'Never use this brand name: {{ brand_name }}.',
      'Write {{ prompt_count }} questions a buyer would type before they know any brand.',
      'Make them long and situational, in full sentences: who they are, what they already use, and what just went wrong.',
      'Map each question to one source: title/meta/H1, a trigger event, or an objection.'
    ].join('\n')
  },
  {
    id: 'coverage',
    kind: 'coverage',
    name: SHIPPED_TEMPLATE_NAME,
    body: [
      'Compare this page with the AI Overview answer for each buyer prompt.',
      '',
      'The page, read live:',
      'URL: {{ url }}',
      'Title: {{ title }}',
      'H1: {{ h1 }}',
      'Main text:',
      '{{ page_text }}',
      '',
      'Brand: {{ brand_name }}.',
      'Prompts to cover: {{ prompt_count }}.',
      '',
      'Before you call anything a gap, check the page text above. If the page already answers it, quote where.',
      '',
      'For each prompt, write what is there now, what to update, and whether a new FAQ is needed.',
      'Rate coverage as strong, partial, weak, or none.',
      "Finish with page-wide fixes: factual errors, promises the page doesn't keep, typos, and title or meta problems."
    ].join('\n')
  }
]
