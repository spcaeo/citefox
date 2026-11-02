import { useMemo } from 'react'
import type { SetupStepProps } from '../steps/types'
import type { SectionEnv } from './types'

/** The section cards' view of a step's props. */
export function useSectionEnv(props: SetupStepProps): SectionEnv {
  const { draft, onDraft, sections, announce } = props
  return useMemo(
    () => ({ draft, onDraft, client: sections, announce }),
    [draft, onDraft, sections, announce]
  )
}
