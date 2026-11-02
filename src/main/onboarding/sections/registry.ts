import type { SetupSectionId } from '@shared/ipc'
import { BRANDS_SECTION, PRODUCTS_SECTION, SUMMARY_SECTION } from './business'
import { BUYERS_SECTION, TRIGGERS_SECTION } from './buyers'
import { COMPETITORS_SECTION, INTEGRATIONS_SECTION, SWITCHING_FROM_SECTION } from './companies'
import { EXAMPLES_SECTION } from './examples'
import { QUESTIONS_SECTION, TOPIC_SECTION } from './questions'
import type { SectionDef } from './types'

/** Every onboarding v2 section, by id (Docs/ONBOARDING.md). */
export const SETUP_SECTIONS: Readonly<Record<SetupSectionId, SectionDef>> = {
  summary: SUMMARY_SECTION,
  brands: BRANDS_SECTION,
  products: PRODUCTS_SECTION,
  buyers: BUYERS_SECTION,
  triggers: TRIGGERS_SECTION,
  competitors: COMPETITORS_SECTION,
  switchingFrom: SWITCHING_FROM_SECTION,
  integrations: INTEGRATIONS_SECTION,
  examples: EXAMPLES_SECTION,
  topic: TOPIC_SECTION,
  questions: QUESTIONS_SECTION
}

export const SETUP_SECTION_IDS = Object.keys(SETUP_SECTIONS) as SetupSectionId[]

export function isSetupSectionId(value: unknown): value is SetupSectionId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SETUP_SECTIONS, value)
}

export function sectionDef(id: SetupSectionId): SectionDef {
  return SETUP_SECTIONS[id]
}

/** The routing tag in front of an in-app run (the e2e Claude stand-in matches on it). */
export function sectionAssistId(id: SetupSectionId): string {
  return `setup.${id}`
}
