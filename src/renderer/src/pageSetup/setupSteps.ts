import type { PageSetupStep } from '@shared/domain'

/** The four page setup steps, in order, for the v2 Stepper (Add page, Page read). */
export const PAGE_SETUP_STEPS: readonly { id: PageSetupStep; label: string }[] = [
  { id: 'read', label: 'Read page' },
  { id: 'profile', label: 'Buyer profile' },
  { id: 'prompts', label: 'Questions' },
  { id: 'check', label: 'First check' }
]
