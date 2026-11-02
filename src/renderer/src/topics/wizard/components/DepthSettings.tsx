import { useId, useState, type JSX } from 'react'
import {
  KEYWORD_INTENT_FAMILIES,
  KEYWORD_INTENT_FAMILY_LABEL,
  MAX_TOPIC_KEYWORDS,
  type DepthPreset,
  type KeywordDepth,
  type TopicDraft
} from '@shared/domain'
import type { TopicDraftPatch } from '@shared/ipc'
import { Button, Panel, SegmentedControl, UiIcon } from '../../../ui'
import { KEYWORD_DEPTH_LINE, KEYWORD_PRESETS, PATTERN_CHOICES } from '../constants'
import { keywordEstimate, rangeText, searchRange } from '../utils/estimate'

const PRESETS: readonly { value: DepthPreset; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'deep', label: 'Deep' },
  { value: 'custom', label: 'Custom' }
]

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(value) || low))
}

/**
 * Depth settings tab: the preset, core terms, seeds, pattern variants and the
 * Custom caps, with a live "≈N keywords · ≈N–2N searches per market" estimate.
 */
export function DepthSettings({
  draft,
  patch,
  generating,
  hasKeywords,
  onGenerate
}: {
  draft: TopicDraft
  patch: (patch: TopicDraftPatch) => void
  generating: boolean
  hasKeywords: boolean
  onGenerate: () => void
}): JSX.Element {
  const settings = draft.depth.keywords
  const [term, setTerm] = useState('')
  const ids = { term: useId(), max: useId(), syn: useId(), cap: useId() }
  const custom = settings.preset === 'custom'
  const keptTerms = draft.keywordTerms.filter((item) => item.kept)
  const estimate = keywordEstimate(settings, keptTerms.length || 3)
  const searches = searchRange(estimate.high, Math.max(1, draft.marketIds.length))

  function set(next: Partial<KeywordDepth>): void {
    patch({ keywordDepth: { ...settings, ...next } })
  }

  function setPreset(preset: DepthPreset): void {
    if (preset === 'custom') set({ preset })
    else patch({ keywordDepth: { preset, ...KEYWORD_PRESETS[preset] } })
  }

  function togglePattern(pattern: string): void {
    const on = settings.patternVariants.includes(pattern)
    set({
      preset: 'custom',
      patternVariants: on
        ? settings.patternVariants.filter((item) => item !== pattern)
        : [...settings.patternVariants, pattern]
    })
  }

  function addTerm(): void {
    const value = term.trim()
    if (!value) return
    patch({
      keywordTerms: [
        ...draft.keywordTerms,
        { id: `term-new-${draft.keywordTerms.length + 1}`, term: value, synonyms: [], kept: true }
      ]
    })
    setTerm('')
  }

  return (
    <div className="tw-depth-grid">
      <Panel title="How deep">
        <SegmentedControl
          label="How deep"
          options={PRESETS}
          value={settings.preset}
          onChange={setPreset}
        />
        <p className="tw-help">{KEYWORD_DEPTH_LINE[settings.preset]}</p>
        <p className="tw-estimate num" role="status">
          About {rangeText(estimate.low, estimate.high)} keywords · ≈
          {rangeText(searches.low, searches.high)} searches per check
        </p>
        {custom ? (
          <div className="tw-custom">
            <label className="tw-field" htmlFor={ids.max}>
              <span className="tw-label">Max keywords</span>
              <input
                id={ids.max}
                type="number"
                min={10}
                max={MAX_TOPIC_KEYWORDS}
                className="ui-input ui-input-sm num"
                value={settings.maxKeywords}
                onChange={(event) =>
                  set({ maxKeywords: clamp(Number(event.target.value), 10, MAX_TOPIC_KEYWORDS) })
                }
              />
            </label>
            <label className="tw-field" htmlFor={ids.syn}>
              <span className="tw-label">Synonyms per core term</span>
              <input
                id={ids.syn}
                type="number"
                min={0}
                max={10}
                className="ui-input ui-input-sm num"
                value={settings.synonymsPerCoreTerm}
                onChange={(event) =>
                  set({ synonymsPerCoreTerm: clamp(Number(event.target.value), 0, 10) })
                }
              />
            </label>
            <label className="tw-field" htmlFor={ids.cap}>
              <span className="tw-label">Most keywords in one group</span>
              <input
                id={ids.cap}
                type="number"
                min={1}
                max={50}
                className="ui-input ui-input-sm num"
                value={settings.perGroupCap}
                onChange={(event) => set({ perGroupCap: clamp(Number(event.target.value), 1, 50) })}
              />
            </label>
            <label className="tw-check">
              <input
                type="checkbox"
                className="ui-check"
                checked={settings.longTailQuestions}
                onChange={() => set({ longTailQuestions: !settings.longTailQuestions })}
              />
              Long-tail question keywords
            </label>
            <fieldset className="tw-fieldset">
              <legend className="tw-label">Intent families</legend>
              <div className="tw-checks tw-checks-2">
                {KEYWORD_INTENT_FAMILIES.map((family) => {
                  const on = settings.intentFamilies.includes(family)
                  return (
                    <label key={family} className="tw-check">
                      <input
                        type="checkbox"
                        className="ui-check"
                        checked={on}
                        onChange={() =>
                          set({
                            intentFamilies: on
                              ? settings.intentFamilies.filter((item) => item !== family)
                              : [...settings.intentFamilies, family]
                          })
                        }
                      />
                      {KEYWORD_INTENT_FAMILY_LABEL[family]}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          </div>
        ) : null}
        <div className="tw-rail-foot">
          <Button size="sm" icon="sparkle" busy={generating} onClick={onGenerate}>
            {hasKeywords ? 'Generate keywords again' : 'Generate keywords'}
          </Button>
          <span className="tw-note">CiteFox AI · about 30 s · no searches</span>
        </div>
      </Panel>
      <Panel title="Core terms · one coverage group each">
        <div className="tw-chips">
          {draft.keywordTerms.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.kept ? 'tw-chip-btn on' : 'tw-chip-btn'}
              aria-pressed={item.kept}
              title={item.synonyms.join(', ')}
              onClick={() =>
                patch({
                  keywordTerms: draft.keywordTerms.map((t) =>
                    t.id === item.id ? { ...t, kept: !t.kept } : t
                  )
                })
              }
            >
              <UiIcon name={item.kept ? 'check' : 'plus'} size={12} />
              {item.term}
            </button>
          ))}
        </div>
        <div className="tw-add-row">
          <label className="sr-only" htmlFor={ids.term}>
            Add a core term
          </label>
          <input
            id={ids.term}
            className="ui-input ui-input-sm"
            placeholder="Add a core term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTerm()
              }
            }}
          />
          <Button size="sm" icon="plus" onClick={addTerm}>
            Add
          </Button>
        </div>
        <p className="tw-label">Seeds</p>
        <div className="tw-chips">
          {[draft.seed, ...draft.otherSeeds].filter(Boolean).map((seed) => (
            <span key={seed} className="ui-chip ui-chip-neutral">
              {seed}
            </span>
          ))}
        </div>
      </Panel>
      <Panel title="Pattern variants per synonym">
        <div className="tw-checks tw-checks-2">
          {PATTERN_CHOICES.map((pattern) => (
            <label key={pattern} className="tw-check mono">
              <input
                type="checkbox"
                className="ui-check"
                checked={settings.patternVariants.includes(pattern)}
                onChange={() => togglePattern(pattern)}
              />
              {pattern.replace('{X}', '…')}
            </label>
          ))}
        </div>
      </Panel>
    </div>
  )
}
