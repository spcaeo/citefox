import { useState, type JSX } from 'react'
import {
  CLORO_CREDITS,
  ENGINE_IDS,
  ENGINE_LABEL,
  type EngineId,
  type Market
} from '@shared/domain'
import type { PromptTextRules, PromptVersionStep } from '@shared/ipc'
import { drawerHref } from '../../shell/drawers'
import { promptHash } from '../../shell/routes'
import { formatDay } from '../../utils/dates'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection
} from '../../ui'
import {
  costLine,
  costProblem,
  plainMarket,
  textProblem,
  wordHint,
  type PromptPanel
} from './model'
import type { SaveWording } from './usePromptEditFlow'

export interface PromptEditDrawerProps {
  mode: PromptPanel
  pageId: string
  /** "Buyer prompt 10" or "Prompt". */
  title: string
  /** The wording in the shown market. */
  text: string
  /** Wording per market in the saved version, for "every market". Empty: unknown. */
  texts: readonly { marketId: string; text: string }[]
  /** This version first, then the versions it was carried from. Empty until they load. */
  steps: readonly PromptVersionStep[]
  /** Null until the prompt's versions load (the engine still checks on save). */
  rules: PromptTextRules | null
  /** The markets this prompt is checked in. */
  markets: readonly Market[]
  marketId: string
  samples: number
  searchesLeft: number | null
  /** Set when this is an older version: nothing can be saved or checked here. */
  currentPromptId: string | null
  stale: boolean
  busy: boolean
  error: string | null
  onSave: (request: SaveWording) => void
  /** The engines the page checks; a re-check can pick some (empty: just Google). */
  engines?: readonly EngineId[]
  /** The engine on screen, picked first. */
  engine?: EngineId
  onRecheck: (markets: readonly Market[], engines: readonly EngineId[] | null) => void
  onClose: () => void
}

/**
 * Edit question / Check now on Prompt detail (`?drawer=pd-edit`,
 * `?drawer=pd-recheck`). The wording with its checks in code (length, no brand
 * name), then a clear choice between "Save and check now" and "Save only", with
 * the search cost shown first. The rail holds the facts, the wording rules and
 * the versions this wording was carried through.
 */
export function PromptEditDrawer(props: PromptEditDrawerProps): JSX.Element {
  const { mode, rules, markets, marketId, samples, searchesLeft } = props
  const editing = mode === 'edit'
  const [text, setText] = useState(props.text)
  const sameEverywhere =
    props.texts.length > 1 && props.texts.every((item) => item.text === props.text)
  const [allMarkets, setAllMarkets] = useState(sameEverywhere)
  const [picked, setPicked] = useState<readonly string[]>(() =>
    markets.some((market) => market.id === marketId)
      ? [marketId]
      : markets.slice(0, 1).map((m) => m.id)
  )
  const [action, setAction] = useState<'save' | 'check' | null>(null)
  // Every engine is offered: the page's own are ticked (or just the one on screen).
  const own = props.engines && props.engines.length > 0 ? props.engines : (['google_aio'] as const)
  const chosen = markets.filter((market) => picked.includes(market.id))
  // New wording, or the same wording copied to markets that ask it differently.
  const changed =
    text.trim() !== props.text.trim() ||
    (allMarkets && props.texts.some((item) => item.text !== text.trim()))
  const problem = rules
    ? textProblem(text, rules)
    : text.trim()
      ? null
      : 'Write the wording before saving.'
  // An unchanged wording is the saved one; its problems (if any) are not news.
  const showProblem = problem !== null && changed
  const spend = costProblem(samples, chosen.length, searchesLeft)
  const shownMarket = markets.find((market) => market.id === marketId)
  const noun = rules?.kind === 'keyword' ? 'Keyword' : 'Question'
  const blocked = props.stale || props.busy
  const engineList = props.engines ? ENGINE_IDS : []
  const [pickedEngines, setPickedEngines] = useState<readonly EngineId[]>(() =>
    props.engine && own.includes(props.engine) ? [props.engine] : own
  )
  // Exactly the page's engines: no override; none picked blocks the check.
  const same =
    pickedEngines.length === own.length && own.every((engine) => pickedEngines.includes(engine))
  const enginesChosen = engineList.length === 0 || same ? null : pickedEngines
  const noEngine = engineList.length > 0 && pickedEngines.length === 0
  const cost = costLine(samples, chosen, searchesLeft)
  const runEngines: readonly EngineId[] = engineList.length === 0 ? ['google_aio'] : pickedEngines
  const google = runEngines.includes('google_aio')
  // Answer engines spend CiteFox credits: one answer per market and sample each.
  const credits = runEngines
    .filter((engine) => engine !== 'google_aio')
    .reduce((sum, engine) => sum + CLORO_CREDITS[engine] * chosen.length * samples, 0)
  const recheckCost = [
    google ? cost : null,
    credits > 0 ? `about ${credits.toLocaleString('en-US')} CiteFox credits for the other engines` : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · plus ')

  function save(withCheck: boolean): void {
    if (blocked || !changed || problem !== null || (withCheck && spend !== null)) return
    setAction(withCheck ? 'check' : 'save')
    props.onSave({ text: text.trim(), marketId, allMarkets, recheck: withCheck ? chosen : null })
  }

  const hint = rules ? wordHint(text, rules) : 'Without your brand.'
  const [counter, ...rest] = hint.split(' · ')

  return (
    <Drawer
      id={editing ? 'pd-edit' : 'pd-recheck'}
      title={editing ? `Edit ${noun.toLowerCase()}` : 'Check this question now'}
      subtitle={
        editing
          ? `${props.title} · saving makes a new version, so earlier checks stay with the old wording`
          : `${props.title} · checks the wording as it is, in the markets you pick`
      }
      dirty={editing && changed}
      busy={props.busy}
      closeDisabled={props.busy}
      onClose={props.onClose}
      testId="prompt-edit-drawer"
      footer={
        editing
          ? {
              summary: changed
                ? `Save only searches nothing · Save and check now: ${cost.charAt(0).toLowerCase()}${cost.slice(1)}`
                : 'No changes yet · nothing is searched',
              secondary: {
                label: 'Save only',
                disabled: blocked || !changed || problem !== null,
                busy: props.busy && action === 'save',
                onClick: () => save(false)
              },
              primary: {
                label: 'Save and check now',
                icon: 'refresh',
                disabled: blocked || !changed || problem !== null || spend !== null,
                busy: props.busy && action === 'check',
                onClick: () => save(true)
              }
            }
          : {
              summary: chosen.length === 0 ? cost : `Costs: ${recheckCost}`,
              primary: {
                label: 'Spend and check now',
                icon: 'refresh',
                disabled: blocked || spend !== null || noEngine,
                onClick: () => props.onRecheck(chosen, enginesChosen)
              }
            }
      }
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="Wording"
            description={
              editing
                ? 'As a buyer would type it into Google.'
                : 'The wording the re-check searches.'
            }
            error={props.error}
          >
            <div className="pd2-edit-stack">
              {props.stale ? (
                <p className="pd2-edit-note" role="note">
                  This is an older version of the question. Changes go on its current wording.{' '}
                  {props.currentPromptId ? (
                    <a
                      href={drawerHref(
                        mode === 'edit' ? 'pd-edit' : 'pd-recheck',
                        {},
                        promptHash(props.pageId, props.currentPromptId)
                      )}
                    >
                      Open the current wording
                    </a>
                  ) : null}
                </p>
              ) : null}
              {editing ? (
                <DrawerFields>
                  <DrawerField
                    label={`${noun}, as a buyer would type it${
                      shownMarket && markets.length > 1 ? ` · ${plainMarket(shownMarket)}` : ''
                    }`}
                    counter={counter}
                    hint={rest.length > 0 ? rest.join(' · ') : null}
                    error={showProblem ? problem : null}
                  >
                    {({ id, describedBy }) => (
                      <textarea
                        id={id}
                        className="ui-input pd2-edit-textarea"
                        rows={5}
                        value={text}
                        data-autofocus
                        aria-describedby={describedBy}
                        aria-invalid={showProblem ? true : undefined}
                        onChange={(event) => setText(event.currentTarget.value)}
                      />
                    )}
                  </DrawerField>
                  {props.texts.length > 1 ? (
                    <label className="pd2-edit-check">
                      <input
                        type="checkbox"
                        className="ui-check"
                        checked={allMarkets}
                        onChange={(event) => setAllMarkets(event.currentTarget.checked)}
                      />
                      <span>Use this wording in all {props.texts.length} markets</span>
                    </label>
                  ) : null}
                </DrawerFields>
              ) : (
                <p className="pd2-edit-quote">{props.text}</p>
              )}
            </div>
          </DrawerSection>

          {!editing && chosen.length > 0 && !noEngine ? (
            <div className="pd2-recheck-warn" role="note">
              <strong>This check costs searches.</strong> {recheckCost}. They come off this
              month&rsquo;s allowance and are not given back, even when the answer has not
              changed.
            </div>
          ) : null}
          <DrawerSection
            title={editing ? 'Check now after saving' : 'Check in'}
            description={
              editing
                ? 'Only for Save and check now. Save only searches nothing.'
                : 'Each market is searched once per sample.'
            }
          >
            <div className="pd2-edit-stack">
              {markets.length > 1 ? (
                <fieldset className="pd2-edit-markets">
                  <legend className="sr-only">Markets to re-check</legend>
                  {markets.map((market) => (
                    <label key={market.id} className="pd2-edit-check">
                      <input
                        type="checkbox"
                        className="ui-check"
                        checked={picked.includes(market.id)}
                        onChange={(event) => {
                          const on = event.currentTarget.checked
                          setPicked((current) =>
                            on ? [...current, market.id] : current.filter((id) => id !== market.id)
                          )
                        }}
                      />
                      <span>{plainMarket(market)}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {!editing && engineList.length > 0 ? (
                <fieldset className="pd2-edit-markets" aria-label="Engines to check">
                  <legend className="pd2-edit-cost">Engines</legend>
                  {engineList.map((engine) => (
                    <label key={engine} className="pd2-edit-check">
                      <input
                        type="checkbox"
                        className="ui-check"
                        checked={pickedEngines.includes(engine)}
                        onChange={(event) => {
                          const on = event.currentTarget.checked
                          setPickedEngines((current) =>
                            on ? [...current, engine] : current.filter((id) => id !== engine)
                          )
                        }}
                      />
                      <span>
                        {ENGINE_LABEL[engine]}
                        {own.includes(engine) ? '' : ' · one-off'}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {noEngine ? <p className="pd2-edit-error">Pick at least one engine.</p> : null}
              {editing ? (
                <p className="pd2-edit-cost" role="status">
                  {cost}
                </p>
              ) : markets.length === 1 && markets[0] ? (
                <p className="pd2-edit-cost">{plainMarket(markets[0])}</p>
              ) : null}
              {spend !== null && chosen.length > 0 ? (
                <p className="pd2-edit-error">{spend}</p>
              ) : null}
            </div>
          </DrawerSection>
        </DrawerMain>

        <DrawerRail label={`About this ${noun.toLowerCase()}`}>
          <DrawerSection title="Facts">
            <div className="pd2-edit-facts">
              <DrawerFacts
                label={`About this ${noun.toLowerCase()}`}
                items={[
                  { label: 'Question', value: props.title },
                  {
                    label: 'Markets',
                    value: markets.map((market) => plainMarket(market)).join(', ') || 'None'
                  },
                  { label: 'Samples', value: <span className="num">{samples}</span> },
                  ...(searchesLeft !== null
                    ? [
                        {
                          label: 'Searches left',
                          value: <span className="num">{searchesLeft.toLocaleString('en-US')}</span>
                        }
                      ]
                    : [])
                ]}
              />
            </div>
          </DrawerSection>
          <DrawerSection title="Wording rules" description="CiteFox checks them again on save.">
            <ul className="pd2-edit-list">
              {rulesList(rules, noun).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </DrawerSection>
          {props.steps.length > 0 ? (
            <DrawerSection title="Versions" count={props.steps.length}>
              <ol className="pd2-edit-list">
                {props.steps.map((step, index) => (
                  <li key={step.promptId}>
                    <strong>
                      v{step.promptSetVersion}
                      {index === 0 ? ' · this one' : ''}
                    </strong>{' '}
                    · saved {formatDay(step.savedAt)}
                    <span className="pd2-edit-version-text">{stepText(step, marketId)}</span>
                  </li>
                ))}
              </ol>
            </DrawerSection>
          ) : null}
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

function stepText(step: PromptVersionStep, marketId: string): string {
  return step.texts.find((item) => item.marketId === marketId)?.text ?? step.texts[0]?.text ?? ''
}

/** The rules the editor checks, in plain words. */
function rulesList(rules: PromptTextRules | null, noun: string): string[] {
  if (!rules) return ['Without your brand name.']
  const out: string[] = []
  if (rules.kind === 'buyer_prompt') {
    out.push(`${rules.minWords} to ${rules.maxWords} words: a full situational question.`)
  } else {
    out.push(`Up to ${rules.maxWords} words: Google reads no more.`)
  }
  out.push(
    rules.brands.length > 0
      ? `Without your brand: ${rules.brands.join(', ')}.`
      : 'Without your brand name.'
  )
  if (rules.kind !== 'buyer_prompt') {
    out.push(`Written as a buyer who has not found you yet would ask the ${noun.toLowerCase()}.`)
  }
  return out
}
