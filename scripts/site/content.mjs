// The words of the public site, in one file. README.md says the same things in
// Markdown; build-site.test.mjs checks that every FAQ question below is also an
// H3 in the README, so the two stay in step.
//
// Rules for this file: true claims only (no user counts, stars or reviews), say
// "source-available" (never "open source"), and do not name the data or AI services
// CiteFox uses behind the scenes. The engines it tracks may be named.

export const ENGINES = [
  {
    name: 'Google AI Overviews',
    what: 'The AI answer at the top of Google results: whether one shows, its text and every source it links.'
  },
  {
    name: 'Google AI Mode',
    what: 'Google’s full AI search answer and the sources it cites.'
  },
  {
    name: 'ChatGPT',
    what: 'ChatGPT answers to your buyer questions and the web sources they cite.'
  },
  { name: 'Perplexity', what: 'Perplexity answers and their numbered sources.' },
  { name: 'Gemini', what: 'Gemini answers and the pages they cite.' },
  { name: 'Copilot', what: 'Microsoft Copilot answers and the pages they cite.' }
]

export const STEPS = [
  {
    title: 'Add your website',
    text: 'CiteFox AI reads your site and works out what you sell, who buys it and who your competitors are.'
  },
  {
    title: 'Get your buyer questions',
    text: 'It writes the questions your buyers really ask, grouped into topics, for each country and language you sell in.'
  },
  {
    title: 'Check, fix, re-check',
    text: 'It asks every AI engine, saves each answer and source, shows who is cited instead, writes fix briefs and re-checks on a schedule.'
  }
]

/** Each feature has a screenshot made by the media builder in media/. */
export const FEATURES = [
  {
    title: 'AI visibility tracking across six engines',
    image: 'summary.png',
    alt: 'CiteFox Summary screen with the AI visibility score, trend and next fixes',
    text: 'See how often AI answers cite your website, by engine, country and language. A trend line marks every fix you made, and each number opens the exact questions it counts.'
  },
  {
    title: 'Every AI answer and every cited source',
    image: 'question.png',
    alt: 'A question in CiteFox showing the full AI answer and the sources it cites',
    text: 'Open any buyer question to read the full answer, the sources it links and how it changed between checks. CiteFox tells you whether the right page was cited, another page of yours, your brand named without a link, or someone else.'
  },
  {
    title: 'Competitor citation tracking',
    image: 'competitors.png',
    alt: 'CiteFox Competitors screen listing the sites AI answers cite instead of you',
    text: 'Find out who AI answers cite instead of you, on which questions and engines, and where a competitor wins and you do not.'
  },
  {
    title: 'Fix briefs and before-and-after tracking',
    image: 'fixes.png',
    alt: 'CiteFox Fixes screen with page fixes, logged changes and verdicts',
    text: 'Get a short brief for each page to improve or write. Log the change, and CiteFox measures the questions it should help for 14 days, then says whether it worked.'
  },
  {
    title: 'Client-ready AI visibility reports',
    image: 'reports-home.png',
    alt: 'CiteFox Reports screen with six ready reports',
    text: 'Six reports rebuilt after every check: read them in the app, download offline HTML, PDF or CSV, put your agency name and logo on them, or email them to clients on a schedule.'
  }
]

/** Smaller features, listed without a screenshot. */
export const MORE_FEATURES = [
  'Buyer questions written for you from your site, in the wording of each market',
  'Topics and target pages: say which page should win each question',
  'Scheduled re-checks while the app is closed, with a monthly budget you set',
  'Alerts on the desktop, by email or in Slack when a target page loses its citation or a competitor is cited instead',
  'Ask CiteFox: plain-English answers about your stored results, with links to the rows',
  'Import questions, pages and competitors from a sitemap, CSV or Excel file',
  'Many projects, each with its own markets and settings',
  'Light and dark themes on Mac, Windows and Linux'
]

export const REPORTS = [
  {
    name: 'Visibility report',
    doc: 'reports-visibility',
    text: 'Where you stand at one check, and who wins instead.'
  },
  { name: 'What changed', doc: 'reports-changed', text: 'Any two checks compared, verdict first.' },
  {
    name: 'Impact review',
    doc: 'reports-impact',
    text: 'What your published pages and fixes did, before and after.'
  },
  {
    name: 'Pitch / audit',
    doc: 'reports-pitch',
    text: 'A short audit from one check, to win a client or brief your boss.'
  },
  {
    name: 'Content plan',
    doc: 'reports-content',
    text: 'The pages to write or fix first, ready for a writer.'
  },
  {
    name: 'Head-to-head',
    doc: 'reports-rival',
    text: 'You against one competitor: where they get cited and you do not.'
  }
]

export const AUDIENCES = [
  {
    title: 'SEO and GEO agencies',
    text: 'Track AI citations for every client, pitch new clients with an audit, and send branded reports on a schedule.'
  },
  {
    title: 'In-house marketers',
    text: 'Show whether AI answers recommend you or a competitor, and prove which page changes moved the numbers.'
  },
  {
    title: 'SaaS and ecommerce teams',
    text: 'See which product, category and comparison pages AI engines cite for the questions buyers ask before they buy.'
  }
]

export const DIFFERENT = [
  'A desktop app: your projects, answers and reports stay on your computer, not in someone else’s cloud.',
  'Free to download and use; checks run on your own keys, and CiteFox shows the cost before every check.',
  'Source-available: anyone can read the code and see exactly what it does.',
  'Page-level answers: which of your pages is cited, and whether it is the page you want cited.',
  'A full loop: buyer questions, checks, fix briefs, 14-day verdicts and client reports in one tool.'
]

export const GEO_VS_SEO = [
  'SEO works to rank a page in the list of search results. GEO (generative engine optimization) and AEO (answer engine optimization) work to get a page cited as a source, or a brand named, inside an AI-written answer.',
  'AI answers appear above the links or replace them. A page can rank well and still not be cited, and AI engines also cite pages that do not rank at the top.',
  'Each engine picks its own sources, and answers change by country, language and over time. So citations have to be measured per engine and market, and checked again after every change.',
  'CiteFox does that measuring: which questions cite you, which page, who is cited instead, and whether your fixes changed it.'
]

export const FAQ = [
  {
    q: 'What is CiteFox?',
    a: 'CiteFox is a free desktop app for Mac, Windows and Linux that tracks whether Google AI Overviews, Google AI Mode, ChatGPT, Perplexity, Gemini and Copilot cite your website for the questions your buyers ask. It shows which page is cited, who is cited instead, what to fix, and whether your fixes worked.'
  },
  {
    q: 'Is CiteFox free?',
    a: 'Yes. The app is free to download and use. Checks use search credits from your own account with a search data service; free plans are enough to try it. CiteFox shows what a check will use before it runs and stops at a monthly budget you set.'
  },
  {
    q: 'How do I check if Google AI Overviews cite my website?',
    a: 'Add your website in CiteFox and run a check. It asks Google each buyer question in the markets you pick, records whether an AI Overview appeared, and lists every source it cited, with your pages marked. Re-checks show what changed over time.'
  },
  {
    q: 'Can CiteFox track ChatGPT and Perplexity citations?',
    a: 'Yes. CiteFox asks ChatGPT, Perplexity, Gemini, Copilot and Google AI Mode the same questions as Google, and shows for each engine whether your site was cited, named without a link, or missing.'
  },
  {
    q: 'What is the difference between GEO, AEO and SEO?',
    a: 'SEO aims to rank pages in search results. GEO (generative engine optimization) and AEO (answer engine optimization) aim to get your pages cited, and your brand named, inside AI-written answers such as Google AI Overviews and ChatGPT. LLM SEO is another name for the same work.'
  },
  {
    q: 'Does CiteFox send my data to a server?',
    a: 'Your projects, questions, AI answers and reports stay on your computer, and your keys stay in your system keychain. CiteFox talks only to the services you connect and the pages you ask it to read. It sends its maker, Space-O Technologies, just two things: the details you give in the Join step, and an anonymous daily version ping.'
  },
  {
    q: 'Is CiteFox open source?',
    a: 'CiteFox is source-available, not open source. The full code is public on GitHub: you can read it, run it, change it for your own use and send improvements. Copies you share must keep the CiteFox name and sponsors. See the LICENSE file.'
  },
  {
    q: 'Can agencies use CiteFox for client reports?',
    a: 'Yes. The license allows use for your company’s clients. CiteFox has six ready reports (Visibility, What changed, Impact review, Pitch / audit, Content plan and Head-to-head) that you can brand with your agency name and logo, download as offline HTML, PDF or CSV, or email on a schedule.'
  },
  {
    q: 'What do I need to run CiteFox?',
    a: 'A Mac, Windows or Linux computer, a key for a search data service (CiteFox links to sign-up pages with free plans and tests the key), and an AI assistant for CiteFox AI: one you already use on your computer under your own plan, or a paste-in mode with your own ChatGPT.'
  },
  {
    q: 'How does CiteFox compare with Profound, Peec AI and Otterly.AI?',
    a: 'CiteFox is a free desktop app that keeps your data on your computer, checks whether the page you want cited is the one cited, and gives each logged fix a 14-day verdict. Hosted tools such as Profound, Peec AI and Otterly.AI offer team dashboards, more engines, prompt volume data, AI crawler analytics and APIs. The comparison page has the full table, with a source for every fact.'
  },
  {
    q: 'Why does my computer warn me when I open CiteFox?',
    a: 'CiteFox builds are not code-signed with a paid certificate yet, so macOS and Windows ask once before the first start. On a Mac, click Open Anyway in System Settings › Privacy & Security. On Windows, choose More info, then Run anyway. Every release lists a SHA-256 checksum for each file.'
  },
  {
    q: 'Which countries and languages does CiteFox support?',
    a: 'You pick the markets: a country and language pair, such as United States · English or Germany · German. CiteFox writes the buyer questions in each market’s wording and checks each market separately, because AI answers differ by place and language.'
  }
]

/**
 * The search-landing glossary (site/glossary/). Short, factual definitions of the
 * words people search for. The app's own words are in Docs/help/glossary.md.
 */
export const GLOSSARY = [
  {
    term: 'Generative engine optimization (GEO)',
    id: 'geo',
    text: 'Work that helps a brand’s pages get cited, and its name mentioned, in answers written by generative AI, such as Google AI Overviews, ChatGPT, Perplexity and Gemini.'
  },
  {
    term: 'Answer engine optimization (AEO)',
    id: 'aeo',
    text: 'Optimizing content so answer engines (AI assistants and AI search) use it to answer a question. Close to GEO; the two names are often used for the same work.'
  },
  {
    term: 'LLM SEO',
    id: 'llm-seo',
    text: 'Another name for GEO: search optimization aimed at large language models (LLMs) and the AI search tools built on them.'
  },
  {
    term: 'AI search visibility',
    id: 'ai-search-visibility',
    text: 'How often a brand or website appears in AI answers for the questions that matter to it, as a cited source or a named brand.'
  },
  {
    term: 'Google AI Overview',
    id: 'ai-overview',
    text: 'The AI-written summary Google shows at the top of some search results, with links to the sources it used. Not every search shows one.'
  },
  {
    term: 'Google AI Mode',
    id: 'ai-mode',
    text: 'Google’s conversational AI search, where the whole result is an AI answer with cited sources and follow-up questions.'
  },
  {
    term: 'Answer engine',
    id: 'answer-engine',
    text: 'A tool that replies with a written answer instead of a list of links, such as ChatGPT, Perplexity, Gemini, Copilot or Google AI Mode.'
  },
  {
    term: 'AI citation',
    id: 'ai-citation',
    text: 'A link to a web page that an AI answer shows as one of its sources. A citation can send visitors, so it is the main thing GEO measures.'
  },
  {
    term: 'Brand mention (named, not cited)',
    id: 'brand-mention',
    text: 'An AI answer that says a brand’s name in its text without linking to the brand’s site. It builds awareness but sends no visit.'
  },
  {
    term: 'Citation rate',
    id: 'citation-rate',
    text: 'The share of checked questions whose AI answer cites your site. CiteFox calls this the score.'
  },
  {
    term: 'AI share of voice',
    id: 'share-of-voice',
    text: 'How often each brand or site is cited across a set of AI answers, compared with the others. It shows who the engines prefer for your topic.'
  },
  {
    term: 'Buyer prompt',
    id: 'buyer-prompt',
    text: 'A question a real buyer would type into AI search, often long and situational, such as “best invoicing tool for a five-person agency that bills hourly”.'
  },
  {
    term: 'Ideal customer profile (ICP)',
    id: 'icp',
    text: 'A short description of who buys from you and what sends them looking. CiteFox writes buyer prompts from it.'
  },
  {
    term: 'Target page',
    id: 'target-page',
    text: 'The page of your site that should be cited for a question. If an answer cites a different page of yours, that page is competing with your target.'
  },
  {
    term: 'Query fan-out',
    id: 'query-fan-out',
    text: 'A technique Google describes for AI Mode: one question is split into several related searches, and the answer draws on the results of all of them.'
  },
  {
    term: 'Zero-click search',
    id: 'zero-click',
    text: 'A search where the person gets an answer on the results page, from an AI Overview or another feature, and does not click through to a website.'
  },
  {
    term: 'Market',
    id: 'market',
    text: 'A country and language pair, such as United States · English. AI answers and their sources differ by market, so each is checked on its own.'
  },
  {
    term: 'Fix brief',
    id: 'fix-brief',
    text: 'A short note of what to change on a page so it answers a set of buyer questions better, ready to hand to a writer.'
  }
]

/** Docs sections and the search title for each help topic (Docs/help/<id>.md). */
export const DOC_GROUPS = [
  { title: 'Start here', ids: ['getting-started', 'glossary'] },
  {
    title: 'Screens',
    ids: [
      'summary',
      'questions',
      'question-page',
      'topics',
      'competitors',
      'citations',
      'fixes',
      'pages',
      'history',
      'alerts',
      'settings'
    ]
  },
  {
    title: 'Reports',
    ids: [
      'reports',
      'reports-visibility',
      'reports-changed',
      'reports-impact',
      'reports-pitch',
      'reports-content',
      'reports-rival',
      'reports-branding'
    ]
  }
]

export const DOC_TITLES = {
  'getting-started': 'Getting started: your first AI visibility check',
  glossary: 'Words CiteFox uses: cited, named, right page',
  summary: 'Summary: AI visibility score, trend and next fixes',
  questions: 'Questions: track buyer questions in AI answers',
  'question-page': 'A question’s page: the AI answer and its sources',
  topics: 'Topics: group buyer questions, set target pages',
  competitors: 'Competitors: who AI answers cite instead of you',
  citations: 'Citations: every page AI answers cite',
  fixes: 'Fixes: fix briefs, changes and 14-day verdicts',
  pages: 'Pages: what each page of your site is cited for',
  history: 'Check history: compare two AI visibility checks',
  alerts: 'Alerts and schedules: when AI citations change',
  settings: 'Settings: projects, connections and app settings',
  reports: 'AI visibility reports: six client-ready reports',
  'reports-visibility': 'Visibility report: where you stand in AI answers',
  'reports-changed': 'What changed report: two checks compared',
  'reports-impact': 'Impact review: before and after your fixes',
  'reports-pitch': 'Pitch / audit report: a quick AI visibility audit',
  'reports-content': 'Content plan report: pages to write or fix first',
  'reports-rival': 'Head-to-head report: you vs one competitor',
  'reports-branding': 'Report branding: your agency name and logo'
}
