import type { JSX } from 'react'
import type { SetupItem } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { HostText, NameLine, SectionCard, SetupStepFrame, useSectionEnv } from '../sections'
import { StartOverStep } from '../sections/StartOverStep'
import { freshCount, keptCount } from '../sections/merge'
import { competitorFromText } from '../sections/rowView'
import type { ReadLive } from './readLive'
import { OpenSearches } from './SearchLines'
import type { SetupStepProps } from './types'

const COMPETITOR_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Competitor name' },
  { key: 'url', label: 'Domain', placeholder: 'competitor.example.com', mono: true },
  { key: 'tag', label: 'Product it competes with', placeholder: 'Your product it competes with' }
] as const

/** A competitor's tag: "Partial overlap" for a partial one, else the product it competes with. */
function competitorTag(item: SetupItem): string | null {
  if (item.tier === 'partial') return 'Partial overlap'
  return item.tag && item.tag.trim().length > 0 ? item.tag : null
}

/**
 * Step 6, "Who could buyers pick instead of you?" (mock-up panel 6): the
 * competitors (name, domain, the product they compete with, "new" marks) and
 * two small editable lines, what buyers switch from and what they use it
 * with (neither are rivals). Continue needs nothing; OnboardingApp saves the
 * profile when the user leaves this step. A competitor search from step 3 that is still
 * running or did not finish shows above the list, with "Try again".
 */
export function CompetitorsStep(
  props: SetupStepProps & {
    /** Step 3's competitor searches: one still running or not finished shows here. */
    searches?: { live: ReadLive; retry: (productId: string) => void }
  }
): JSX.Element {
  const env = useSectionEnv(props)
  const competitors = props.draft.lists.competitors
  const kept = keptCount(competitors)
  const fresh = freshCount(competitors)
  const note = `${pluralize(kept, 'competitor')}${fresh > 0 ? ` · ${fresh} new` : ''}`

  return (
    <SetupStepFrame
      step={6}
      title="Who could buyers pick instead of you?"
      from="✦ From a web search"
      sub="CiteFox labels these when AI answers cite them instead of you."
      alert={props.alert}
      onBack={props.onBack}
      note={note}
      primary={{
        label: 'Continue',
        onClick: props.onContinue,
        disabled: props.busy,
        busy: props.busy
      }}
      headAction={
        <StartOverStep step={props} sections={['competitors', 'switchingFrom', 'integrations']} />
      }
    >
      {props.searches ? (
        <OpenSearches live={props.searches.live} onRetry={props.searches.retry} />
      ) : null}
      <SectionCard
        variant="list"
        env={env}
        list="competitors"
        title="Competitors"
        noun={{ one: 'competitor', many: 'competitors' }}
        addPlaceholder="+ competitor.com"
        addMono
        parseAdd={competitorFromText}
        fields={COMPETITOR_FIELDS}
        aiLabel={null}
        rowTag={competitorTag}
        renderSub={(item) => <HostText host={item.url} />}
        redoLabel="Redo competitors"
      />
      <div className="osc-lines">
        <NameLine
          env={env}
          list="switchingFrom"
          label="They switch from"
          note="(not rivals)"
          placeholder="AT&T gateway, Verizon gateway"
        />
        <NameLine
          env={env}
          list="integrations"
          label="Used with"
          note="(not rivals)"
          placeholder="Gmail, Outlook"
        />
      </div>
    </SetupStepFrame>
  )
}
