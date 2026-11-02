import type { CapRule, ClaudeFallback, GenerationTemplateKind } from '@shared/domain'

/** The settings tabs, mock-up order. Each id is also its section's DOM id. */
export const SECTIONS = [
  { id: 'ps-general', label: 'General' },
  { id: 'ps-track', label: 'What to track' },
  { id: 'ps-markets', label: 'Markets' },
  { id: 'ps-schedule', label: 'Schedule' },
  { id: 'ps-searches', label: 'Searches & cost' },
  { id: 'ps-claude', label: 'CiteFox AI' },
  { id: 'ps-rules', label: 'Project rules' },
  { id: 'ps-templates', label: 'Templates' },
  { id: 'ps-reports', label: 'Reports' },
  { id: 'ps-data', label: 'Data' }
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export const CAP_RULE_LABELS: Readonly<Record<CapRule, string>> = {
  pause: 'Pause checks',
  notify: 'Ask me',
  allow_10: 'Allow 10% over'
}

export const CAP_RULE_ORDER: readonly CapRule[] = ['pause', 'notify', 'allow_10']

export const FALLBACK_LABELS: Readonly<Record<Exclude<ClaudeFallback, 'switch_key'>, string>> = {
  wait: 'Wait for the plan limit to reset',
  retry_later: 'Retry later',
  ask: 'Ask me'
}

export const TEMPLATE_KINDS: readonly { kind: GenerationTemplateKind; label: string }[] = [
  { kind: 'buyer_profile', label: 'Buyer profile' },
  { kind: 'buyer_prompts', label: 'Buyer questions' },
  { kind: 'coverage_matrix', label: 'Coverage matrix' }
]

export const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const

export const DEVICE_OPTIONS = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' }
] as const
