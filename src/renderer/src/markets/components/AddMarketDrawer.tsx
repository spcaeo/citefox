import { useState, type FormEvent, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { MarketDraft } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { CountryOptions } from '../../onboarding/MarketOptions'
import { matchSerpApiLocation } from '../../onboarding/markets'
import { MarketHelp } from '../../projectMarkets/MarketHelp'
import { languageOptionsWith, type MarketPick } from '../../projectMarkets/marketPicks'
import { untrackedDefault } from '../../projectMarkets/model'
import { marketLabel } from '../../shell/model'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SegmentedControl,
  type HelpFillSource,
  type HelpFillUrlState
} from '../../ui'
import type { MarketActionResult } from '../hooks/useMarketActions'
import type { MarketForm } from '../types'
import { draftFromForm, rangeLabel, searchRange } from '../utils/model'

/**
 * FR-9.6 Add a market to one page, in the shared Drawer over the Markets tab
 * (`?panel=add-market`). Country, language, city and device on the left; what
 * it adds to each check and the markets the page already has on the right.
 * The engine matches the city to SerpApi's list on save (FR-9.5). ✦ Help me fill
 * this suggests markets; one fills the form, and the footer still adds it.
 */
export function AddMarketDrawer({
  projectId,
  pageId,
  help,
  helpSource,
  defaultMarket,
  tracked,
  prompts,
  samples,
  searchesLeft,
  busy,
  onAdd,
  onClose
}: {
  projectId: string
  pageId: string
  /** ✦ Help me fill this: way and bot on the screen's URL (`mk.help`, `mk.bot`). */
  help: HelpFillUrlState
  /** Tests only: the helper's channels. */
  helpSource?: HelpFillSource
  defaultMarket: Market | null
  /** The page's markets: the form starts on a country it does not track yet. */
  tracked: readonly Market[]
  prompts: number
  samples: number
  searchesLeft: number | null
  busy: boolean
  /** Resolves ok when the market is added (and, with `check`, its check started). */
  onAdd: (draft: MarketDraft, check: boolean) => Promise<MarketActionResult>
  /** `added` is true when it closes after adding without a check. */
  onClose: (added?: boolean) => void
}): JSX.Element {
  const [start] = useState<MarketForm>(() => {
    const first = untrackedDefault(tracked)
    return {
      country: first.country || defaultMarket?.country || 'US',
      language: first.language || defaultMarket?.language || 'en',
      location: '',
      device: 'desktop',
      localWording: false
    }
  })
  const [form, setForm] = useState<MarketForm>(start)
  const [message, setMessage] = useState<string | null>(null)
  const [inForm, setInForm] = useState<string | null>(null)
  const matched = matchSerpApiLocation(form.location)
  const one = searchRange(prompts, samples)
  const all = searchRange(prompts, samples, tracked.length + 1)
  const dirty =
    form.country !== start.country ||
    form.language !== start.language ||
    form.location.trim() !== '' ||
    form.device !== start.device ||
    form.localWording !== start.localWording

  function patch(next: Partial<MarketForm>): void {
    setForm((current) => ({ ...current, ...next }))
    setMessage(null)
    setInForm(null)
  }

  /** A suggested market fills the form; the footer's buttons still add it. */
  function applyPick(pick: MarketPick): void {
    patch({ country: pick.country, language: pick.language, location: pick.city })
    setInForm(pick.id)
  }

  async function submit(check: boolean, event?: FormEvent): Promise<void> {
    event?.preventDefault()
    if (busy) return
    setMessage(null)
    const result = await onAdd(draftFromForm(form), check)
    if (!result.ok) setMessage(result.message)
    // With a check the app moves to the running check, which closes the drawer.
    else if (!check) onClose(true)
  }

  const left =
    searchesLeft === null ? '' : ` · ${searchesLeft.toLocaleString('en-US')} searches left`

  return (
    <Drawer
      id="mk-add-market"
      title="Add a market"
      subtitle="A country, language and device Google is searched in. The new market gets its own baseline on its first check."
      testId="mk-add-drawer"
      dirty={dirty}
      busy={busy}
      closeDisabled={busy}
      onClose={() => onClose()}
      footer={{
        summary: message ? (
          <span className="mk-message" role="alert">
            {message}
          </span>
        ) : (
          <span data-testid="mk-add-summary">
            Adds <strong className="num">{rangeLabel(one)}</strong> searches per check
            {left}
          </span>
        ),
        secondary: {
          label: 'Add without checking',
          disabled: busy,
          onClick: () => void submit(false)
        },
        primary: {
          label: 'Add market and run first check',
          busy,
          disabled: busy,
          onClick: () => void submit(true)
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="Market"
            description="Starts on a country this page does not track yet."
          >
            <form
              id="add-market"
              aria-label="Add a market"
              noValidate
              onSubmit={(event) => void submit(true, event)}
            >
              <DrawerFields columns={2}>
                <DrawerField label="Country">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.country}
                      data-autofocus
                      onChange={(event) => patch({ country: event.target.value })}
                    >
                      <CountryOptions current={form.country} />
                    </select>
                  )}
                </DrawerField>
                <DrawerField label="Language">
                  {({ id, describedBy }) => (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      value={form.language}
                      onChange={(event) => patch({ language: event.target.value })}
                    >
                      {languageOptionsWith(form.language).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </DrawerField>
                <DrawerField
                  label="City or region (optional)"
                  hint={
                    matched
                      ? `Matches Google location ${matched}`
                      : 'CiteFox matches the name to Google’s location list when you add the market.'
                  }
                >
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className="ui-input"
                      type="text"
                      placeholder="e.g. Austin, Texas"
                      value={form.location}
                      onChange={(event) => patch({ location: event.target.value })}
                    />
                  )}
                </DrawerField>
                <div className="ui-drawer-field">
                  <span className="ui-drawer-label" aria-hidden="true">
                    Device
                  </span>
                  <SegmentedControl<Market['device']>
                    label="Device"
                    size="sm"
                    options={[
                      { value: 'desktop', label: 'Desktop' },
                      { value: 'mobile', label: 'Mobile' }
                    ]}
                    value={form.device}
                    onChange={(device) => patch({ device })}
                  />
                  <p className="ui-drawer-hint">Local searches are mostly on phones.</p>
                </div>
              </DrawerFields>
              <label className="pop-check mk-check">
                <input
                  type="checkbox"
                  checked={form.localWording}
                  onChange={(event) => patch({ localWording: event.target.checked })}
                />
                <span>
                  Use local wording in questions
                  <br />
                  <span className="faint">
                    Adds the city where a local buyer would say it, when questions are written for
                    this market.
                  </span>
                </span>
              </label>
            </form>
          </DrawerSection>
          <DrawerSection
            title="Help me fill this"
            description="Suggests markets this page doesn't track yet. Use one to fill the form above."
            testId="mk-add-help"
          >
            <MarketHelp
              projectId={projectId}
              pageId={pageId}
              {...help}
              picked={inForm}
              onUse={applyPick}
              fallbackLanguage={form.language}
              disabled={busy}
              {...(helpSource ? { source: helpSource } : {})}
            />
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="Cost and markets">
          <DrawerSection title="Searches per check" testId="mk-add-cost">
            <DrawerFacts
              label="Searches per check"
              items={[
                {
                  label: 'This market',
                  value: <span className="num mk-nowrap">{rangeLabel(one)}</span>
                },
                {
                  label: `All ${tracked.length + 1} markets`,
                  value: <span className="num mk-nowrap">{rangeLabel(all)}</span>
                },
                ...(searchesLeft === null
                  ? []
                  : [
                      {
                        label: 'Left this month',
                        value: <span className="num">{searchesLeft.toLocaleString('en-US')}</span>
                      }
                    ])
              ]}
            />
            <p className="ui-drawer-hint">
              {pluralize(prompts, 'question')} × {pluralize(samples, 'sample')} per market.
            </p>
          </DrawerSection>
          <DrawerSection title="Markets this page tracks" count={tracked.length}>
            <ul className="mk-tracked">
              {tracked.map((market) => (
                <li key={market.id}>
                  {marketLabel(market)}
                  {market.id === defaultMarket?.id ? (
                    <span className="faint"> · default</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
