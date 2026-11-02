import {
  TEMPLATE_VARIABLES,
  isTemplateVariable,
  type TemplateVariable,
  type TemplateVariableWarning
} from '@shared/domain'
import {
  TemplateSyntaxError,
  parseTemplate,
  renderTemplateParts,
  templateNames,
  type TemplatePart
} from '@shared/template-syntax'

/**
 * Save-time checks for the three generation templates, with the same rules main
 * renders by (`@shared/template-syntax`). `{{ name }}` is a variable. An unknown name
 * warns. A tag or a filter is a render error. Anything else malformed is a syntax
 * error. Neither error echoes the body.
 */
export type TemplateIssueKind = 'syntax' | 'render'

export class TemplateCallError extends Error {
  readonly channel: string
  readonly kind: TemplateIssueKind

  constructor(channel: string, kind: TemplateIssueKind) {
    super(`${channel}: Nunjucks ${kind} error`)
    this.name = 'TemplateCallError'
    this.channel = channel
    this.kind = kind
  }
}

export interface TemplateAnalysis {
  variables: readonly TemplateVariable[]
  warnings: readonly TemplateVariableWarning[]
}

export function analyzeTemplate(body: string, channel: string): TemplateAnalysis {
  parse(body, channel)
  return analysis(body)
}

export function renderTemplate(
  body: string,
  channel: string,
  values: Readonly<Record<TemplateVariable, string>>
): { text: string; analysis: TemplateAnalysis } {
  const parts = parse(body, channel)
  return { text: renderTemplateParts(parts, values), analysis: analysis(body) }
}

function parse(body: string, channel: string): TemplatePart[] {
  try {
    return parseTemplate(body)
  } catch (error) {
    if (error instanceof TemplateSyntaxError) {
      throw new TemplateCallError(channel, error.issue === 'syntax' ? 'syntax' : 'render')
    }
    throw error
  }
}

function analysis(body: string): TemplateAnalysis {
  const names = templateNames(body)
  return {
    variables: TEMPLATE_VARIABLES.filter((name) => names.includes(name)),
    warnings: names
      .filter((name) => !isTemplateVariable(name))
      .map((name) => ({
        name,
        message: `Unknown variable {{ ${name} }}. CiteFox will leave it blank.`
      }))
  }
}
