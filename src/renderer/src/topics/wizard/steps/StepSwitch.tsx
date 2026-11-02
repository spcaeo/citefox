import type { JSX } from 'react'
import { CleanupStep } from './CleanupStep'
import { CompetitorQuestionsStep, TheirPageStep } from './CompetitorSteps'
import { EstimateStep } from './EstimateStep'
import { ImportStep } from './ImportStep'
import { KeywordsStep } from './KeywordsStep'
import { PagesStep } from './PagesStep'
import { ProfileStep } from './ProfileStep'
import { QuestionsStep } from './QuestionsStep'
import { SeedStep } from './SeedStep'
import type { StepProps } from './shared'

/** The screen for the draft's current step. */
export function StepSwitch(props: StepProps): JSX.Element {
  switch (props.step) {
    case 'seed':
      return <SeedStep {...props} />
    case 'profile':
      return <ProfileStep {...props} />
    case 'questions':
      return props.draft.path === 'competitor' ? (
        <CompetitorQuestionsStep {...props} />
      ) : (
        <QuestionsStep {...props} />
      )
    case 'keywords':
      return <KeywordsStep {...props} />
    case 'import':
      return <ImportStep {...props} />
    case 'cleanup':
      return <CleanupStep {...props} />
    case 'competitor':
      return <TheirPageStep {...props} />
    case 'pages':
      return <PagesStep {...props} />
    case 'estimate':
      return <EstimateStep {...props} />
  }
}
