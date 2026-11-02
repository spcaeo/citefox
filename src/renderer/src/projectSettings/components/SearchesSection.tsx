import { useId, useState, type JSX } from 'react'
import { Button, PickerSelect } from '../../ui'
import { openDrawer } from '../../shell/drawers'
import type { CapRule, SampleCount, SearchSource } from '@shared/domain'
import { sectionHash } from '../../shell/routes'
import { withHashTab } from '../../shell/useHashTab'
import { SAMPLE_OPTIONS } from '../constants'
import { useSave } from '../hooks/useSave'
import type { SectionProps } from '../types'
import {
  capRuleOptions,
  keyOptionLabel,
  keysOf,
  paceLine,
  parseCap,
  searchFromForm
} from '../utils/model'
import { SaveStatus, Section } from './bits'
import { UsagePopover } from './UsagePopover'

/** FR-11.4. Shared keys up to a monthly cap, or a dedicated key, and the cap rule. */
export function SearchesSection({ view, admin, keys, refresh }: SectionProps): JSX.Element {
  const base = useId()
  const name = view.project.name
  const serp = keysOf(keys, 'serpapi')
  const [source, setSource] = useState<SearchSource>(view.search.source)
  const [cap, setCap] = useState(view.search.cap === null ? '' : String(view.search.cap))
  const [capRule, setCapRule] = useState<CapRule>(view.search.capRule)
  const [keyId, setKeyId] = useState<string>(view.search.dedicatedKeyId ?? serp[0]?.id ?? '')
  const [samples, setSamples] = useState<SampleCount>(view.defaultSamples)
  const [checkWhenReady, setCheckWhenReady] = useState(view.checkWhenReady)
  const [capError, setCapError] = useState<string | null>(null)
  const save = useSave()
  const parsedCap = parseCap(cap)
  const rules = capRuleOptions('cap' in parsedCap ? parsedCap.cap : null, view.usage.resetsOn)
  const pace = paceLine(view.usage)

  async function onSave(): Promise<void> {
    const parsed = parseCap(cap)
    if ('error' in parsed) {
      setCapError(parsed.error)
      return
    }
    setCapError(null)
    if (source === 'dedicated' && keyId.length === 0) {
      save.fail('Choose a SerpApi key, or add one with “+ Add a SerpApi key…”.')
      return
    }
    await save.run(async () => {
      await admin.updateProjectSettings({
        projectId: view.project.id,
        search: searchFromForm(source, parsed.cap, capRule, keyId.length > 0 ? keyId : null),
        defaultSamples: samples,
        checkWhenReady
      })
      await refresh()
    }, 'Searches saved.')
  }

  /** "+ Add a SerpApi key…": the new key comes back chosen. */
  function addKey(): void {
    openDrawer(
      'add-key',
      { 'key.provider': 'serpapi' },
      {
        onResult: (id) => {
          if (typeof id !== 'string') return
          // Pick it once the list has it, so the select can show it.
          void refresh().finally(() => setKeyId(id))
        }
      }
    )
  }

  return (
    <Section id={'ps-searches'} title="Searches & cost">
      <fieldset className="ps-fieldset">
        <legend className="field-label">Where this project&apos;s searches come from</legend>
        <label className={source === 'shared' ? 'radio on' : 'radio'}>
          <input
            type="radio"
            name={`${base}-src`}
            checked={source === 'shared'}
            onChange={() => setSource('shared')}
          />
          <span className="stack-tight">
            <span className="field-label">Shared keys</span>
            <span className="hint">
              In the order and rule set in{' '}
              <a href={withHashTab(sectionHash('connections'), 'serpapi')}>Connections</a>
            </span>
          </span>
        </label>
        {source === 'shared' ? (
          <div className="ps-indent stack-tight">
            <div className="ps-grid2">
              <div className="field">
                <label className="field-label" htmlFor={`${base}-cap`}>
                  Monthly cap for {name}
                </label>
                <input
                  id={`${base}-cap`}
                  className="ob-input mono"
                  inputMode="numeric"
                  placeholder="No cap"
                  value={cap}
                  aria-invalid={capError !== null}
                  aria-describedby={capError ? `${base}-cap-e` : undefined}
                  onChange={(event) => setCap(event.target.value)}
                />
                {capError ? (
                  <span className="field-error" id={`${base}-cap-e`}>
                    {capError}
                  </span>
                ) : null}
              </div>
              <UsagePopover view={view} admin={admin} />
            </div>
            <p className="hint">
              {pace ? `${pace} ` : ''}Other projects can&apos;t use {name}&apos;s cap, and {name}{' '}
              can&apos;t go past it. Leave the cap blank for no cap.
            </p>
          </div>
        ) : null}
        <label className={source === 'dedicated' ? 'radio on' : 'radio'}>
          <input
            type="radio"
            name={`${base}-src`}
            checked={source === 'dedicated'}
            onChange={() => setSource('dedicated')}
          />
          <span className="stack-tight">
            <span className="field-label">A dedicated key</span>
            <span className="hint">
              Only this project uses it, and it&apos;s skipped for every other project
            </span>
          </span>
        </label>
        {source === 'dedicated' ? (
          <div className="ps-indent stack-tight">
            <label className="field" htmlFor={`${base}-key`}>
              <span className="field-label">Dedicated key</span>
              <PickerSelect
                id={`${base}-key`}
                className="select"
                value={keyId}
                onChange={setKeyId}
                {...(serp.length === 0 || keyId === '' ? { placeholder: 'Choose a key' } : {})}
                options={serp.map((key) => ({ value: key.id, label: keyOptionLabel(key) }))}
                createLabel="+ Add a SerpApi key…"
                onCreate={addKey}
              />
            </label>
            {serp.length === 0 ? (
              <p className="hint">No SerpApi key yet. Add one here, or in Connections.</p>
            ) : null}
            <UsagePopover view={view} admin={admin} />
          </div>
        ) : null}
      </fieldset>
      <fieldset className="ps-fieldset">
        <legend className="field-label">When the cap is reached</legend>
        <div className="ps-radios">
          {rules.map((rule) => (
            <label key={rule.rule} className={capRule === rule.rule ? 'radio on' : 'radio'}>
              <input
                type="radio"
                name={`${base}-rule`}
                checked={capRule === rule.rule}
                onChange={() => setCapRule(rule.rule)}
              />
              <span className="stack-tight">
                <span className="field-label">{rule.label}</span>
                <span className="hint">{rule.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field ps-narrow">
        <label className="field-label" htmlFor={`${base}-samples`}>
          Samples per question
        </label>
        <select
          id={`${base}-samples`}
          className="select"
          aria-describedby={`${base}-samples-h`}
          value={samples}
          onChange={(event) => setSamples(Number(event.target.value) as SampleCount)}
        >
          {SAMPLE_OPTIONS.map((count) => (
            <option key={count} value={count}>
              {count === 1 ? '1 (default)' : String(count)}
            </option>
          ))}
        </select>
        <span className="hint" id={`${base}-samples-h`}>
          For new pages in this project. Each page keeps its own samples; a change on a page starts
          a new baseline there, so before/after comparisons stay fair.
        </span>
      </div>
      <label className="radio ps-check-ready" htmlFor={`${base}-ready`}>
        <input
          id={`${base}-ready`}
          type="checkbox"
          checked={checkWhenReady}
          aria-describedby={`${base}-ready-h`}
          onChange={(event) => setCheckWhenReady(event.target.checked)}
        />
        <span className="stack-tight">
          <span className="field-label">Check new pages automatically when they are ready</span>
          <span className="hint" id={`${base}-ready-h`}>
            Off: CiteFox sets a new page up by itself (no searches) and waits for you to start its
            first check. On: the first check starts as soon as setup is done and uses searches.
          </span>
        </span>
      </label>
      <div className="actions">
        <Button
          variant="primary"
          disabled={save.state.kind === 'saving'}
          onClick={() => void onSave()}
        >
          Save searches
        </Button>
      </div>
      <SaveStatus state={save.state} />
    </Section>
  )
}
