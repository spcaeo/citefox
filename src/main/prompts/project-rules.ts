/**
 * The owner's rules for a project (Project settings › Project rules) as a short block
 * every AI prompt for that project carries: setup sections, fix briefs, page edits,
 * Why Google picks, help-fill and every assist.
 */

/** The block's first line; the e2e Claude stand-in logs the lines under it. */
export const PROJECT_RULES_HEAD = "The owner's rules for this project (always follow them):"

/** Most rules one prompt lists. */
const MAX_RULES = 40

/** The block's lines, or none when the project has no rule on. */
export function projectRulesLines(rules: readonly string[]): string[] {
  const kept = rules
    .map((rule) => rule.replace(/\s+/gu, ' ').trim())
    .filter((rule, index, all) => rule.length > 0 && all.indexOf(rule) === index)
    .slice(0, MAX_RULES)
  return kept.length === 0 ? [] : [PROJECT_RULES_HEAD, ...kept.map((rule) => `- ${rule}`)]
}

/** The block as one text, or '' with no rule. */
export function projectRulesBlock(rules: readonly string[]): string {
  return projectRulesLines(rules).join('\n')
}

/**
 * `prompt` with the rules block after its first line (the line that names the
 * assist or template stays first, for routing, and a `Variant:` line under it stays
 * second), unless it already has the block.
 */
export function withProjectRules(prompt: string, rules: readonly string[]): string {
  const block = projectRulesBlock(rules)
  if (block.length === 0 || prompt.includes(PROJECT_RULES_HEAD)) return prompt
  const lines = prompt.split('\n')
  const head = lines[1]?.startsWith('Variant: ') ? 2 : 1
  if (lines.length <= head) return `${prompt}\n\n${block}`
  return [...lines.slice(0, head), '', block, ...lines.slice(head)].join('\n')
}
