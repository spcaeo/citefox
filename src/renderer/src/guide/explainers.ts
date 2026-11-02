import type { GuideScreen, PageExplainer } from './types'

/** "What is this page?" for each main screen. */
export const EXPLAINERS: Readonly<Partial<Record<GuideScreen, PageExplainer>>> = {
  summary: {
    title: 'What is the Summary?',
    body: 'How visible your site is in AI answers across the whole project, as widgets you can arrange. Start here each week, then open a topic for the details.'
  },
  topic: {
    title: 'What is a topic page?',
    body: 'A topic groups the buyer questions about one theme. This page shows which of them cite you, which page they cite, and what to do next.'
  },
  prompt: {
    title: 'What is this page?',
    body: 'One buyer question, with the full AI answer and every source it cited. Use it to see why you are, or are not, the page it trusts.'
  },
  topics: {
    title: 'What are topics?',
    body: 'Each topic groups the questions buyers ask about one theme, with its own target page. Each shows one number: the right page cited, of searches with an AI answer.'
  },
  questions: {
    title: 'What is this list?',
    body: 'Every question CiteFox checks for you, across all topics and pages. Filter it to find the ones that need work.'
  },
  competitors: {
    title: 'What is Competitors?',
    body: 'Which competitors AI answers cite, how often, and for which questions. Mark new ones from the Sources of any question.'
  },
  citations: {
    title: 'What is Citations?',
    body: 'Every page AI answers cited for your questions, yours and other sites. Use it to find sites worth pitching or learning from.'
  },
  fixes: {
    title: 'What is Fixes?',
    body: 'Your to-do list of page fixes, the changes you made, and whether each one worked. Open a fix to get its brief and the edits for the page.'
  },
  history: {
    title: 'What is Check history?',
    body: 'Every check CiteFox ran and what it found. Compare two checks to see what moved.'
  },
  reports: {
    title: 'What are Reports?',
    body: 'Ready reports from your checks, by goal or by report: visibility, what changed, impact, pitch, content plan and head-to-head. Open, download or email them.'
  },
  alerts: {
    title: 'What are alerts?',
    body: 'Rules that tell you when something changes, such as a citation won or lost, and how you hear about it.'
  },
  pages: {
    title: 'What is All pages?',
    body: 'Every page of your site CiteFox knows, and which ones AI answers cite. Track a page to start checking its questions.'
  },
  settings: {
    title: 'What is App settings?',
    body: 'Settings for every project: AI and searches, the look, email, report branding and your data.'
  }
}
