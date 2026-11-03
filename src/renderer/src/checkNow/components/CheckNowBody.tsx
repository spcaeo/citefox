import { useId, type JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import { allQuestionCount, ItemPicker, MarketChips, ScopeChooser } from '../../scope'
import { marketLabel } from '../../shell/model'
import { DrawerGrid, DrawerMain, DrawerRail, DrawerSection } from '../../ui'
import type { CheckNowData } from '../hooks/useCheckNow'
import { checkablePage, offeredKinds, type CheckNowState, type QuestionMode } from '../model'

export interface CheckNowBodyProps {
  state: CheckNowState
  data: CheckNowData
  /** A state change; `push` makes it its own Back step (a new scope kind). */
  onChange: (patch: Partial<CheckNowState>, push?: boolean) => void
}

/**
 * Check now's body: what to check (scope kinds and the picker), the markets,
 * and which questions. The same body sits in the drawer and on `#/check`.
 */
export function CheckNowBody({ state, data, onChange }: CheckNowBodyProps): JSX.Element {
  const { options } = data
  return (
    <DrawerGrid className="cn2-grid">
      <DrawerMain>
        <DrawerSection
          title="What to check"
          description="Pages that are due, everything again, or the pages, topics, groups or clusters you pick."
          loading={options === null && data.error === null}
          error={data.error}
          onRetry={data.reload}
          testId="check-now-scope"
        >
          {options ? (
            <ScopeChooser
              options={options}
              value={state.scope}
              onChange={(scope) =>
                onChange(
                  // Picked questions belong to the page they came from.
                  { scope, q: '', ...(state.prompts.length > 0 ? { prompts: [] } : {}) },
                  scope.kind !== state.scope.kind
                )
              }
              kinds={offeredKinds(options, state.scope.kind)}
              countText={{ all: pluralize(allQuestionCount(options), 'question') }}
              legend="What to check"
              pageFilter={checkablePage}
              query={state.q}
              onQueryChange={(q) => onChange({ q })}
              testId="check-now-chooser"
            />
          ) : null}
          {options && state.scope.kind === 'all' ? (
            <p className="cn2-note" data-testid="check-now-all-note">
              Runs all {pluralize(allQuestionCount(options), 'question')} of every tracked page and
              topic again.
            </p>
          ) : null}
        </DrawerSection>
      </DrawerMain>
      <DrawerRail label="Markets and questions">
        <DrawerSection
          title="Markets"
          description="Each market is searched on its own. A page is only checked in markets it has."
          loading={options === null && data.error === null}
        >
          {options ? (
            <MarketChips
              markets={options.markets}
              selected={state.markets}
              onChange={(markets) => onChange({ markets })}
            />
          ) : null}
        </DrawerSection>
        <QuestionsSection state={state} data={data} onChange={onChange} />
      </DrawerRail>
    </DrawerGrid>
  )
}

/** " in 🇬🇧 GB · EN" when the not-cited check runs in fewer markets than the project has. */
function whereText(data: CheckNowData): string {
  const ids = data.plan?.marketIds ?? null
  const markets = data.options?.markets ?? []
  if (ids === null || ids.length === 0 || ids.length >= markets.length) return ''
  const names = markets.filter((market) => ids.includes(market.id)).map(marketLabel)
  return names.length > 0 ? ` in ${names.join(', ')}` : ''
}

function QuestionsSection({ state, data, onChange }: CheckNowBodyProps): JSX.Element {
  const name = useId()
  const handedOver = state.only === 'picked' && data.onlyPageId === null
  // Picking questions needs one page; ids handed over by another screen also count.
  const canPick = data.onlyPageId !== null || state.prompts.length > 0
  const modes: { mode: QuestionMode; label: string; hint: string; disabled?: string }[] = [
    { mode: 'all', label: 'All questions', hint: 'Every question the pages track.' },
    {
      mode: 'failed',
      label: 'Only the ones that failed last time',
      hint:
        data.failed === null
          ? 'Looking at the last check…'
          : `${pluralize(data.failed.questions, 'question')} had no result in their last check.`,
      ...(data.failed !== null && data.failed.questions === 0
        ? { disabled: 'Nothing failed last time.' }
        : {})
    },
    {
      mode: 'notcited',
      label: 'Only questions not cited last time',
      hint: 'Only the questions whose last result did not cite the page.'
    },
    {
      mode: 'picked',
      label: handedOver ? `Selected questions (${state.prompts.length})` : 'Questions I pick',
      hint: handedOver
        ? 'The questions you selected before opening Check now.'
        : 'Pick questions of one page or topic.',
      ...(canPick ? {} : { disabled: 'Pick one page or topic first.' })
    }
  ]
  const notCitedLine =
    state.only === 'failed' && data.plan && !data.plan.waiting && data.plan.blocked === null
      ? `${pluralize(data.plan.promptIds?.length ?? 0, 'question')} on ${pluralize(data.plan.estimate.pages, 'page')} failed last time${whereText(data)}.`
      : state.only === 'notcited' && data.plan && !data.plan.waiting && data.plan.blocked === null
        ? `${pluralize(data.plan.promptIds?.length ?? 0, 'question')} on ${pluralize(data.plan.estimate.pages, 'page')} were not cited last time${whereText(data)}.`
        : null

  return (
    <DrawerSection title="Questions" testId="check-now-questions">
      <fieldset className="cn2-modes">
        <legend className="sr-only">Which questions</legend>
        {modes.map((item) => (
          <label key={item.mode} className="cn2-mode" title={item.disabled}>
            <input
              type="radio"
              name={name}
              value={item.mode}
              checked={state.only === item.mode}
              disabled={item.disabled !== undefined}
              onChange={() =>
                // Ids without a mode mean "selected questions", so leaving it drops them.
                onChange(
                  item.mode === 'picked' ? { only: 'picked' } : { only: item.mode, prompts: [] },
                  true
                )
              }
            />
            <span className="cn2-mode-text">
              <span className="cn2-mode-label">{item.label}</span>
              <span className="cn2-mode-hint">{item.disabled ?? item.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {notCitedLine ? (
        <p className="cn2-note" role="status">
          {notCitedLine}
        </p>
      ) : null}
      {data.notCitedError ? (
        <p className="cn2-error" role="alert">
          {data.notCitedError}
        </p>
      ) : null}
      {state.only === 'picked' && data.onlyPageId !== null ? (
        data.questionsError ? (
          <p className="cn2-error" role="alert">
            {data.questionsError}
          </p>
        ) : data.questions === null ? (
          <p className="cn2-note" role="status">
            Loading the questions…
          </p>
        ) : (
          <ItemPicker
            label="Questions to check"
            items={data.questions}
            selected={state.prompts}
            onChange={(prompts) => onChange({ prompts })}
            noun={['question', 'questions']}
            maxHeight={260}
            empty={<p className="cn2-note">This page has no questions yet.</p>}
            testId="check-now-question-picker"
          />
        )
      ) : null}
    </DrawerSection>
  )
}
