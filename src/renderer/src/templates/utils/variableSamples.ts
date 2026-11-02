/**
 * Example values for "Variables you can use": what a filled variable looks
 * like, so a reader can picture the rendered prompt. Generic on purpose
 * (owner's prompt method): never a real brand. The real values come from the
 * page and market when the template runs; Try it shows them.
 */
const SAMPLES: Readonly<Record<string, string>> = {
  url: 'https://example.com/blog/business-texting-guide/',
  'page.url': 'https://example.com/blog/business-texting-guide/',
  page_url: 'https://example.com/blog/business-texting-guide/',
  title: 'Business Texting: A Complete Guide (2026)',
  'page.title': 'Business Texting: A Complete Guide (2026)',
  page_title: 'Business Texting: A Complete Guide (2026)',
  meta_description: 'How small teams send and receive texts from a business number.',
  'page.meta_description': 'How small teams send and receive texts from a business number.',
  h1: 'Business texting, explained',
  'page.h1': 'Business texting, explained',
  page_h1: 'Business texting, explained',
  page_text: 'Business texting lets a team send and receive SMS from one shared number…',
  'page.body': 'Business texting lets a team send and receive SMS from one shared number…',
  brand_name: 'Example Co',
  brand_names: 'Example Co, ExampleCo',
  prompt_count: '10',
  count: '24',
  outline: 'H2 What is business texting? · H3 Shared numbers · H2 Pricing',
  page_sections: 'What is business texting? · Shared numbers · Pricing · FAQ',
  faqs: 'Q: Can I text from my landline? A: Yes, once the number is enabled…',
  last_modified: '2026-09-14',
  competitors: 'competitor-one.com, competitor-two.com',
  switching_from: 'A carrier email-to-text gateway that shut down',
  integrations: 'Alarm monitoring software, an email app',
  market: 'United States · New York · desktop',
  markets: 'United States · English, United Kingdom · English',
  market_language: 'English',
  'market.country': 'United States',
  'market.language': 'English',
  'market.location': 'New York',
  'market.device': 'desktop',
  buyer_values: 'Fast setup, keeping their existing number, team inboxes',
  icp: 'Who: owners of 5 to 50 person service businesses · Values: fast setup…',
  prompt: 'best way to text customers from a business number',
  prompt_text: 'best way to text customers from a business number',
  'aio.prompt': 'best way to text customers from a business number',
  question: 'how to set up business texting',
  related_prompts: 'business texting app for small teams\ntext from landline number',
  aio_text: 'Business texting tools let you send SMS from a shared number. Popular options…',
  overview_text: 'Business texting tools let you send SMS from a shared number. Popular options…',
  'aio.text': 'Business texting tools let you send SMS from a shared number. Popular options…',
  aio_references: '1. example.com/blog/business-texting-guide/\n2. competitor-one.com/sms',
  'aio.references': '1. example.com/blog/business-texting-guide/\n2. competitor-one.com/sms',
  'aio.status': 'Page cited',
  brand_facts: 'Example Co keeps your existing number.\nPlans start at a flat monthly price.',
  own_pages: 'Pricing page: plans start at a flat monthly price…',
  prompts: '1. best way to text customers (Page cited)\n2. texting app for teams (Not cited)',
  videos_cited: 'youtube.com/watch?v=… "How to text from a landline"',
  'run.aios_shown': '18',
  'run.page_cited': '7',
  'run.other_own_page': '2',
  'run.named_without_link': '3',
  'run.invisible': '6',
  'run.previous_page_cited': '5',
  'run.baseline_page_cited': '4',
  'run.content_changed': 'Yes',
  'run.content_change': 'A pricing FAQ was added under the H2 "Pricing".',
  notes: 'Added a comparison table on Oct 2.'
}

/** An example value for a variable, or null when there is no good example. */
export function variableSample(name: string): string | null {
  return SAMPLES[name] ?? null
}
