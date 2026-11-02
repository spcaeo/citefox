// The sample reports on the site (Docs/DEMO.md): one per ready report kind.
// tests/demo/samples.e2e.ts writes site/samples/<slug>/index.html from the app's
// offline HTML download; scripts/site/pages.mjs builds the gallery and the
// sitemap from this list. Types: samples.d.mts.

export const SAMPLES = [
  {
    kind: 'visibility',
    slug: 'visibility',
    title: 'Visibility report',
    goal: 'Show where a client stands',
    description:
      'Which buyer questions Google AI Overviews, ChatGPT and Perplexity cite the site for, which page they cite and who wins instead.'
  },
  {
    kind: 'changed',
    slug: 'what-changed',
    title: 'What changed',
    goal: 'Show a client progress',
    description:
      'Citations won and lost between two checks, the competitors that moved and the pages behind each change.'
  },
  {
    kind: 'impact',
    slug: 'impact-review',
    title: 'Impact review',
    goal: 'Prove the fixes worked',
    description:
      'What each published or rewritten page did in AI answers after it went live, with a verdict after 14 days.'
  },
  {
    kind: 'pitch',
    slug: 'pitch-audit',
    title: 'Pitch / audit',
    goal: 'Pitch a new client',
    description:
      'A short AI visibility audit from one check: the opportunity, the most cited sites and a plan you can send.'
  },
  {
    kind: 'content',
    slug: 'content-plan',
    title: 'Content plan',
    goal: 'Plan what to write next',
    description:
      'The pages to write or fix first, with the questions each one should win and the sites cited today.'
  },
  {
    kind: 'rival',
    slug: 'head-to-head',
    title: 'Head-to-head',
    goal: 'Beat one competitor',
    description:
      'Where one competitor gets cited in AI answers and the site does not, question by question.'
  }
]
