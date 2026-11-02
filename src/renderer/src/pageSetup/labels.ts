import type {
  BuyerProfilePart,
  CoverageAction,
  CoverageLevel,
  CoveragePriority,
  IntentStage,
  OutlineLevel,
  PageReadMethod,
  PageReadPhase,
  PromptSource
} from '@shared/domain'

export function profilePartLabel(part: BuyerProfilePart): string {
  switch (part) {
    case 'who':
      return 'Who'
    case 'environment':
      return 'Their environment'
    case 'segments':
      return 'Strongest segments'
    case 'triggers':
      return 'Trigger events'
    case 'values':
      return 'What they value'
    case 'poor_fit':
      return 'Poor fit'
  }
}

export function coverageLabel(level: CoverageLevel): string {
  switch (level) {
    case 'strong':
      return 'Strong'
    case 'partial':
      return 'Partial'
    case 'weak':
      return 'Weak'
    case 'none':
      return 'None'
  }
}

export function actionLabel(action: CoverageAction): string {
  switch (action) {
    case 'update_existing':
      return 'Update existing'
    case 'new_faq':
      return 'New FAQ'
    case 'small_update':
      return 'Small update'
    case 'optional_faq':
      return 'Optional FAQ'
    case 'none':
      return 'No change'
  }
}

export function actionsLabel(actions: readonly CoverageAction[]): string {
  return actions.map(actionLabel).join(' + ')
}

export function priorityLabel(priority: CoveragePriority): string {
  switch (priority) {
    case 'high':
      return 'High'
    case 'medium':
      return 'Medium'
    case 'low':
      return 'Low'
  }
}

export function stageLabel(stage: IntentStage): string {
  switch (stage) {
    case 'problem':
      return 'Problem'
    case 'solution':
      return 'Solution'
    case 'comparison':
      return 'Comparison'
    case 'objection':
      return 'Objection'
    case 'trigger':
      return 'Trigger'
    case 'unset':
      return 'Unset'
  }
}

export function sourceLabel(source: PromptSource): string {
  switch (source) {
    case 'title_meta_h1':
      return 'From title/meta/H1'
    case 'trigger_event':
      return 'From a trigger event'
    case 'objection':
      return 'From an objection'
    case 'detail_check':
      return 'From a detail check'
    case 'written_by_user':
      return 'Written by you'
  }
}

export function outlineLabel(level: OutlineLevel): string {
  switch (level) {
    case 'p':
      return 'P'
    case 'box':
      return 'Box'
    case 'h2':
      return 'H2'
    case 'h3':
      return 'H3'
    case 'cta':
      return 'CTA'
  }
}

export function readMethodLabel(method: PageReadMethod): string {
  switch (method) {
    case 'direct':
      return 'direct fetch'
    case 'jina':
      return 'backup reader'
    case 'file':
      return 'supplied file'
  }
}

export function readPhaseLabel(phase: PageReadPhase): string {
  switch (phase) {
    case 'fetch':
      return 'Fetch the page'
    case 'extract':
      return 'Extract title, outline, and FAQs'
    case 'summary':
      return 'Summarize what the page promises'
  }
}
