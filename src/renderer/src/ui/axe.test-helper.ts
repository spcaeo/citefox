import axe from 'axe-core'

/** Page-level rules that do not apply to a component rendered alone. */
const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

/** axe violations in `node`, as "rule: help" lines (empty when clean). */
export async function axeViolations(node: Element): Promise<string[]> {
  const result = await axe.run(node, RULES)
  return result.violations.map((violation) => `${violation.id}: ${violation.help}`)
}
