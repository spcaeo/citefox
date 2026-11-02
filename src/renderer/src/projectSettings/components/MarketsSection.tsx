import { useId, useMemo, useState, type JSX } from 'react'
import { Button } from '../../ui'
import type { MarketDevice } from '@shared/domain'
import { CountryOptions, LanguageOptions } from '../../onboarding/MarketOptions'
import { MarketsTable } from '../../projectMarkets/MarketsTable'
import { createProjectMarketsSource, type ProjectMarketsSource } from '../../projectMarkets/source'
import { sectionHash } from '../../shell/routes'
import { DEVICE_OPTIONS } from '../constants'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import { SaveStatus, Section } from './bits'

/**
 * The project's markets as a table (add, make default, remove with Undo), and
 * the default market's own fields (FR-9, FR-10.3).
 */
export function MarketsSection(
  props: SectionProps & {
    /** Tests pass a fake. Production uses the preload bridge. */
    marketsSource?: ProjectMarketsSource
  }
): JSX.Element {
  const { view, refresh, marketsSource } = props
  const source = useMemo(() => marketsSource ?? createProjectMarketsSource(), [marketsSource])
  const project = view.project
  return (
    <Section
      id={'ps-markets'}
      title="Markets"
      intro={
        <>
          Every market in {project.name}, with the pages and topics checked in it. One page&apos;s
          markets are on its Markets tab, from <a href={sectionHash('pages')}>All pages</a>.
        </>
      }
    >
      <MarketsTable
        // Reloads after the default market's fields are saved below.
        key={JSON.stringify(project.defaultMarket)}
        source={source}
        projectId={project.id}
        onChanged={() => void refresh()}
      />
      {/* Keyed on the default market: Make default starts the form over on the new one. */}
      <DefaultMarketForm key={project.defaultMarket?.id ?? 'none'} {...props} />
    </Section>
  )
}

/** The default market's own fields. Saving rewrites that market for every page in it. */
function DefaultMarketForm({ view, client, refresh }: SectionProps): JSX.Element {
  const base = useId()
  const project = view.project
  const current = project.defaultMarket
  const [country, setCountry] = useState(current?.country ?? 'US')
  const [language, setLanguage] = useState(current?.language ?? 'en')
  const [city, setCity] = useState(current?.location ?? '')
  const [device, setDevice] = useState<MarketDevice>(current?.device ?? 'desktop')
  const save = useSave()

  async function onSave(): Promise<void> {
    await save.run(async () => {
      await client.updateProject({
        projectId: project.id,
        country,
        language,
        location: city.trim().length === 0 ? null : city.trim(),
        device
      })
      await refresh()
    }, 'Default market saved.')
  }

  return (
    <>
      <fieldset className="ps-fieldset">
        <legend className="field-label">Edit the default market</legend>
        <div className="ps-grid4">
          <label className="field" htmlFor={`${base}-country`}>
            <span className="field-label">Country</span>
            <select
              id={`${base}-country`}
              className="select"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            >
              <CountryOptions current={country} />
            </select>
          </label>
          <label className="field" htmlFor={`${base}-language`}>
            <span className="field-label">Language</span>
            <select
              id={`${base}-language`}
              className="select"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <LanguageOptions current={language} />
            </select>
          </label>
          <label className="field" htmlFor={`${base}-city`}>
            <span className="field-label">
              City <span className="optional">(optional)</span>
            </span>
            <input
              id={`${base}-city`}
              className="ob-input"
              placeholder="e.g. Toronto"
              value={city}
              onChange={(event) => setCity(event.target.value)}
            />
          </label>
          <label className="field" htmlFor={`${base}-device`}>
            <span className="field-label">Device</span>
            <select
              id={`${base}-device`}
              className="select"
              value={device}
              onChange={(event) => setDevice(event.target.value as MarketDevice)}
            >
              {DEVICE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      <p className="hint">
        Changes this market itself, so the pages checked in it change too. To start new pages in
        another market, use Make default in the table.
      </p>
      <div className="actions">
        <Button
          variant="primary"
          disabled={save.state.kind === 'saving'}
          onClick={() => void onSave()}
        >
          Save default market
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </>
  )
}
