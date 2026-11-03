import { helpTopicForScreen, type HelpTopicId } from '@shared/help-topics'
import type { AiContext } from './context/types'

/**
 * "Common questions here" in the empty Ask drawer: how / why / what-next
 * questions for this screen, answered from the help docs plus the project's
 * own facts, and the screen's help topic. Built in code; listing them never
 * calls CiteFox AI. The rail's data suggestions stay as they are.
 */

const MAX = 3

const BY_TOPIC: Readonly<Record<HelpTopicId, readonly string[]>> = {
  'getting-started': [
    'How do I start tracking my site?',
    'What does a check cost?',
    'What should I set up first?'
  ],
  summary: ['What should I fix first?', 'Why is What changed empty?', 'What does Right page mean?'],
  questions: [
    'What does Right page mean?',
    'How do I set a target page?',
    'What should I fix first?'
  ],
  topics: ['What is a topic for?', 'How is the topic goal measured?', 'What should I fix first?'],
  'question-page': [
    'What does Right page mean?',
    'Why is another page of mine cited?',
    'How do I get a fix brief?'
  ],
  competitors: [
    'How does CiteFox find competitors?',
    'How do I add a competitor?',
    'What should I do when a rival is cited instead?'
  ],
  citations: [
    'What counts as a citation?',
    'Why is my brand named but my page not cited?',
    'What should I fix first?'
  ],
  fixes: [
    'How do I log a fix?',
    'When does CiteFox say if a fix worked?',
    'Why is there no verdict yet?'
  ],
  pages: ['How do I track a page?', 'What is a target page?', 'Why does a page have no questions?'],
  history: ['Why is What changed empty?', 'When is my next check?', 'How do I compare two checks?'],
  reports: [
    'Which report should I send my client?',
    'How do I add my agency logo?',
    'How do I schedule a report?'
  ],
  'reports-visibility': ['What does the Visibility report show?', 'How do I download it?'],
  'reports-changed': ['Why is What changed empty?', 'What does the What changed report show?'],
  'reports-impact': ['When does the Impact report fill in?', 'How is impact measured?'],
  'reports-pitch': ['What is the Pitch report for?', 'How do I make a pitch for a prospect?'],
  'reports-content': ['What does the Content report show?', 'How do I use it to write pages?'],
  'reports-rival': ['What does the Rival report show?', 'How do I pick the rival?'],
  'reports-branding': ['Where is report branding?', 'How do I add my agency logo?'],
  alerts: [
    'How often should CiteFox check?',
    'Which alerts should I turn on?',
    'Why did I get this alert?'
  ],
  settings: [
    'Where is report branding?',
    'What do CiteFox credits pay for?',
    'Where is my data kept?'
  ],
  'report-a-problem': [
    'How do I report a problem?',
    'What does a problem report contain?',
    'Does CiteFox send my report by itself?'
  ],
  glossary: ['What does Right page mean?', 'What is an AI Overview?', 'What is a check?']
}

/** The screen's help topic and up to 3 questions about it. No project: Getting started. */
export function helpQuestionsFor(context: Pick<AiContext, 'screen' | 'projectId'>): {
  topicId: HelpTopicId
  questions: string[]
} {
  const topicId =
    context.projectId === null ? 'getting-started' : helpTopicForScreen(context.screen)
  return { topicId, questions: BY_TOPIC[topicId].slice(0, MAX) }
}
