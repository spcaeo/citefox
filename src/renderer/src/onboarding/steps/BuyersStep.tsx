import type { JSX } from 'react'
import { SectionCard, SetupStepFrame, useSectionEnv } from '../sections'
import { StartOverStep } from '../sections/StartOverStep'
import { keptCount } from '../sections/merge'
import { buyerFromText } from '../sections/rowView'
import type { SetupStepProps } from './types'

const BUYER_FIELDS = [
  {
    key: 'name',
    label: 'Who they are',
    placeholder: 'Who they are, e.g. "Practice manager at a small clinic"'
  },
  { key: 'detail', label: 'Their situation', placeholder: 'What happened and what they need' }
] as const

const TRIGGER_FIELDS = [
  { key: 'name', label: 'What happened', placeholder: 'Something that happened to them' }
] as const

/**
 * Step 5, "Who buys from you, and what makes them look?" (mock-up panel 5):
 * the buyers (who, and their situation) and what sends them looking (a list:
 * each reason is a sentence, too long for a chip).
 * Continue needs at least one kept buyer.
 */
export function BuyersStep(props: SetupStepProps): JSX.Element {
  const env = useSectionEnv(props)
  const buyers = props.draft.lists.buyers
  const kept = keptCount(buyers)
  const note =
    kept === 0
      ? 'Keep at least one buyer to continue'
      : `${kept} of ${buyers.length} ${buyers.length === 1 ? 'buyer' : 'buyers'} kept`

  return (
    <SetupStepFrame
      step={5}
      title="Who buys from you, and what makes them look?"
      from="✦ From your site"
      sub="Buyer questions are written from these situations."
      alert={props.alert}
      onBack={props.onBack}
      note={note}
      primary={{
        label: 'Continue',
        onClick: props.onContinue,
        disabled: kept === 0 || props.busy,
        busy: props.busy
      }}
      headAction={<StartOverStep step={props} sections={['buyers', 'triggers']} />}
    >
      <SectionCard
        variant="list"
        env={env}
        list="buyers"
        title="Buyers"
        noun={{ one: 'buyer', many: 'buyers' }}
        addPlaceholder="+ Add a buyer: who they are and their situation"
        parseAdd={buyerFromText}
        fields={BUYER_FIELDS}
        aiLabel="✦"
        redoLabel="Redo buyers"
      />
      <SectionCard
        variant="list"
        env={env}
        list="triggers"
        title="What sends them looking"
        noun={{ one: 'reason', many: 'reasons' }}
        addPlaceholder='+ Add something that happened, e.g. "Gateway shut down"'
        fields={TRIGGER_FIELDS}
        aiLabel={null}
        redoLabel="Redo these"
      />
    </SetupStepFrame>
  )
}
