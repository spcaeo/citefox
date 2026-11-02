/**
 * FR-25.5. AI output must not claim that an edit, fix or change to the page caused a
 * citation or visibility change. Saying why the overview chose a source ("the overview
 * cites X because X answers Y") is allowed: no page edit is credited.
 *
 * Each sentence is judged on its own. A sentence claims a cause when it
 *  - names an edit to the page, a citation or visibility outcome, and a causal or
 *    temporal link between them ("after you updated the FAQ, Google started citing
 *    you"), or
 *  - says outright that something caused or produced a citation ("this video caused
 *    a citation").
 */

const PAGE_PART =
  '(?:page|pages|content|faq|faqs|copy|article|post|section|sections|title|titles|meta(?: description)?|h1|headings?|schema|text|site|intro|opening)'
const EDIT_VERB =
  '(?:edit(?:s|ed|ing)?|updat(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|fix(?:es|ed|ing)?|rewr(?:ite|ites|ote|itten|iting)|revis(?:e|es|ed|ing)|add(?:s|ed|ing)?|remov(?:e|es|ed|ing)|optimi[sz](?:e|es|ed|ing))'
const EDIT_NOUN =
  '(?:edit|edits|update|updates|change|changes|fix|fixes|rewrite|revision|revisions)'

const PAGE_EDIT = new RegExp(
  [
    // "you updated", "we rewrote", "your team changed"
    `\\b(?:you|we|your team|the team|the site owner)\\s+(?:\\w+\\s+){0,2}${EDIT_VERB}\\b`,
    // "updated the FAQ", "rewrote the opening section"
    `\\b${EDIT_VERB}\\s+(?:the|your|its|this|our|their|a|an)\\s+(?:\\w+\\s+){0,2}${PAGE_PART}\\b`,
    // "the page was updated", "the FAQ has been rewritten"
    `\\b${PAGE_PART}\\s+(?:was|were|is|has been|have been|got|had been)\\s+(?:\\w+\\s+)?${EDIT_VERB}\\b`,
    // "changes to your page", "the fix to the title"
    `\\b${EDIT_NOUN}\\s+(?:to|of|on)\\s+(?:the|your|its|this|our)\\s+(?:\\w+\\s+){0,2}${PAGE_PART}\\b`,
    // "the edit", "this change", "your update"
    `\\b(?:the|this|that|these|those|your|our)\\s+(?:recent\\s+|latest\\s+)?${EDIT_NOUN}\\b`,
    // "the content change", "a page edit", "the new FAQ"
    `\\b(?:content|page|faq|copy|title)\\s+${EDIT_NOUN}\\b`,
    `\\bnew\\s+(?:faq|section|content|copy|intro|title)\\b`
  ].join('|'),
  'i'
)

const OUTCOME =
  /\b(?:cit(?:e|es|ed|ing|ation|ations)|visib(?:le|ility)|appear(?:s|ed|ing)?|show(?:s|ed|n|ing)? up|mention(?:s|ed|ing)?|rank(?:s|ed|ing|ings)?|picked up|featured)\b/i

const LINK =
  /\b(?:because|caus(?:e|es|ed|ing)|due to|as a result|result(?:s|ed)? in|le(?:d|ads?) to|thanks to|dr(?:o|i)ve[sn]?|produc(?:e|es|ed|ing)|earn(?:s|ed)|trigger(?:s|ed)|helped|after|once|since|following|so)\b/i

const CAUSED_A_CITATION =
  /\b(?:caus(?:e|es|ed|ing)|produc(?:e|es|ed|ing)|result(?:s|ed)? in|le(?:d|ads?) to|trigger(?:s|ed))\s+(?:\w+\s+){0,3}(?:citations?|cites?|visibility)\b/i

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter((part) => part.trim().length > 0)
}

function sentenceClaimsCause(sentence: string): boolean {
  if (CAUSED_A_CITATION.test(sentence)) return true
  return PAGE_EDIT.test(sentence) && OUTCOME.test(sentence) && LINK.test(sentence)
}

export function claimsCause(text: string): boolean {
  return sentences(text).some(sentenceClaimsCause)
}
