import type { AiContext, AiEntityRef } from '../context/types'

/**
 * The questions a ✦ menu offers about one thing (deep audit crosscut §3.7):
 * what people ask about THAT number, row, chart or section. Built in code
 * from the thing and the screen, so listing them never calls Claude. Picking
 * one opens Ask CiteFox with the question and the thing in context.
 */

/** What a ✦ is about, with what a KPI tile adds. */
export interface SparkleTarget extends AiEntityRef {
  /** A KPI tile's trend text, such as "+3 since Sep 28". */
  trend?: string | null
  /** True when the tile shows a goal bar (the 50–70% band). */
  goal?: boolean
}

/** The heading over the menu's questions. */
export function sparkleHeading(target: SparkleTarget): string {
  switch (target.kind) {
    case 'kpi':
      return 'This number'
    case 'question':
      return 'This question'
    case 'page':
      return 'This page'
    case 'topic':
      return 'This topic'
    case 'competitor':
    case 'domain':
      return 'This site'
    case 'check':
      return 'This check'
    case 'chart':
      return 'This chart'
    case 'section':
      return 'This section'
    case 'market':
      return 'This market'
    case 'fix':
      return 'This fix'
    default:
      return 'Ask about this'
  }
}

/** "Since Sep 28" from a trend text such as "+3 since Sep 28", else "since the last check". */
function sinceWords(trend: string | null | undefined): string {
  const match = trend ? /since (.+)$/i.exec(trend) : null
  return match ? `since ${match[1]}` : 'since the last check'
}

function quote(text: string, max = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`
}

/** 3 to 5 questions about the target, the most asked first. */
export function sparkleQuestions(
  target: SparkleTarget,
  context: AiContext | null = null
): string[] {
  const label = target.label.trim()
  const about = quote(label)
  switch (target.kind) {
    case 'kpi': {
      const value = target.detail?.trim() ?? ''
      const out = [`Explain this number: ${label}${value ? ` (${value})` : ''}`]
      // The tile's own value in the question: "Why is citation share 14%?".
      if (value) out.push(`Why is ${lowerFirst(label)} ${value}?`)
      if (target.trend) out.push(`Why did ${label} change ${sinceWords(target.trend)}?`)
      if (/cited|citation|score|share|visib/i.test(label))
        out.push('Which questions are not cited?')
      if (target.goal || /cited|score|share|goal|%/i.test(`${label} ${target.detail ?? ''}`)) {
        out.push('How do I reach the 50–70% band?')
      }
      out.push(`What would move ${label} most?`)
      return unique(out).slice(0, 5)
    }
    case 'question': {
      const target_ = target.detail ? ` for ${target.detail}` : ''
      return [
        `Why isn't my page cited for ${about}?`,
        `Draft an answer${target_} to ${about}`,
        `Rewrite ${about} the way buyers ask`,
        `Suggest 5 questions like ${about}`,
        `Which topic should ${about} move to?`
      ]
    }
    case 'page':
      return [
        `Why isn't ${about} cited more?`,
        `Which questions should ${about} answer?`,
        `What should I change on ${about} first?`,
        `Who is cited instead of ${about}?`
      ]
    case 'topic':
      return [
        `How is the topic ${about} doing?`,
        `Which questions in ${about} are not cited?`,
        `What should I fix first in ${about}?`,
        `Summarise ${about} for my client in 5 lines`
      ]
    case 'competitor':
    case 'domain':
      return [
        `Where is ${label} cited instead of me?`,
        `Which of my questions does ${label} win?`,
        `What do ${label}'s cited pages have that mine don't?`,
        `Why is ${label} ahead of me?`
      ]
    case 'check':
      return [
        `What changed in the check of ${label}?`,
        'Which questions moved in this check, and in which market?',
        'What did this check find that I should fix first?'
      ]
    case 'market':
      return [
        `Why is ${label} weaker than my other markets?`,
        `Who is cited in ${label} instead of me?`,
        `Which questions are not cited in ${label}?`
      ]
    case 'fix':
      return [
        `Did the fix ${about} work?`,
        'Which questions moved after this fix?',
        'Draft the next fix for this page'
      ]
    case 'chart':
      return [
        `Explain the chart ${about}`,
        `What changed most in ${about}?`,
        'What should I do about this trend?'
      ]
    case 'community':
    case 'video':
      return [
        `Why do AI Overviews cite ${about}?`,
        `How do I show up in ${about}?`,
        'Draft a helpful reply I could post'
      ]
    case 'setting':
    case 'connection':
    case 'alert':
    case 'template':
      return [
        `What does ${about} do?`,
        `What should I set ${about} to?`,
        `What happens if I change ${about}?`
      ]
    case 'section':
      return sectionQuestions(label, context)
    default:
      return [
        `Explain ${about}`,
        `What should I do about ${about}?`,
        `What stands out in ${about}?`
      ]
  }
}

function sectionQuestions(title: string, context: AiContext | null): string[] {
  const about = quote(title)
  const helpScreens = new Set([
    'settings',
    'connections',
    'permissions',
    'alerts',
    'templates',
    'playground'
  ])
  if (context && helpScreens.has(context.screen)) {
    return [
      `What does ${about} do?`,
      `What should I set up in ${about}?`,
      `What does ${about} cost?`
    ]
  }
  return [`Explain ${about}`, `What stands out in ${about}?`, `What should I do about ${about}?`]
}

/** "citation share" from "Citation share"; keeps "AI Overviews" and "US" as they are. */
function lowerFirst(text: string): string {
  const [first = '', second = ''] = text
  if (second !== '' && second === second.toUpperCase() && /[A-Z]/.test(second)) return text
  return `${first.toLowerCase()}${text.slice(1)}`
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)]
}
