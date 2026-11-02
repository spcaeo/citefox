import { useId, useState, type JSX } from 'react'
import { ROLE_PRESETS, type RolePreset, type WidgetKind } from '@shared/summary-board'
import { Button, Drawer } from '../../ui'
import { GALLERY_ORDER, SIZE_LABEL, WIDGET_INFO } from './catalog'
import { PRESET_INFO, type WidgetSpec } from './model'

export interface GalleryChoices {
  /** Competitor sites to watch: their domain and name. */
  competitors: readonly { domain: string; label: string }[]
  /** Questions to pin. */
  questions: readonly { pageId: string; promptId: string; label: string }[]
}

/**
 * "+ Add widget": every widget with one line on what it shows and the sizes it comes in,
 * and the role presets to start from. A widget about one thing (a competitor, a
 * question) asks which first.
 */
export function Gallery({
  choices,
  full,
  onAdd,
  onPreset,
  onClose
}: {
  choices: GalleryChoices
  /** The board holds as many widgets as it can. */
  full: boolean
  onAdd: (spec: WidgetSpec) => void
  onPreset: (preset: RolePreset) => void
  onClose: () => void
}): JSX.Element {
  return (
    <Drawer
      id="summary-gallery"
      title="Add a widget"
      subtitle="Pick what your Summary shows. Each widget has its own engine filter."
      onClose={onClose}
      footer={{ cancel: 'Close' }}
      testId="summary-gallery"
    >
      <section className="wb-gallery-section" aria-labelledby="wb-presets-title">
        <h3 id="wb-presets-title" className="wb-gallery-title">
          Start from a role
        </h3>
        <p className="wb-gallery-sub">Replaces the widgets on your Summary. You can undo it.</p>
        <ul className="wb-presets">
          {ROLE_PRESETS.map((preset) => (
            <li key={preset} className="wb-preset">
              <span className="wb-preset-title">{PRESET_INFO[preset].title}</span>
              <span className="wb-preset-text">{PRESET_INFO[preset].description}</span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Use the ${PRESET_INFO[preset].title} layout`}
                onClick={() => onPreset(preset)}
              >
                Use this layout
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="wb-gallery-section" aria-labelledby="wb-widgets-title">
        <h3 id="wb-widgets-title" className="wb-gallery-title">
          Widgets
        </h3>
        {full ? (
          <p className="wb-gallery-sub" role="status">
            Your Summary is full. Remove a widget to add another.
          </p>
        ) : null}
        <ul className="wb-gallery">
          {GALLERY_ORDER.map((kind) => (
            <GalleryCard key={kind} kind={kind} choices={choices} disabled={full} onAdd={onAdd} />
          ))}
        </ul>
      </section>
    </Drawer>
  )
}

function GalleryCard({
  kind,
  choices,
  disabled,
  onAdd
}: {
  kind: WidgetKind
  choices: GalleryChoices
  disabled: boolean
  onAdd: (spec: WidgetSpec) => void
}): JSX.Element {
  const info = WIDGET_INFO[kind]
  const pickId = useId()
  const options =
    info.needs === 'domain'
      ? choices.competitors.map((item) => ({ value: item.domain, label: item.label }))
      : info.needs === 'question'
        ? choices.questions.map((item) => ({
            value: `${item.pageId}\u0000${item.promptId}`,
            label: item.label
          }))
        : []
  const [picked, setPicked] = useState(options[0]?.value ?? '')
  const value = options.some((option) => option.value === picked)
    ? picked
    : (options[0]?.value ?? '')
  const blocked = info.needs !== null && options.length === 0
  const add = (): void => {
    if (info.needs === 'domain') {
      const label = options.find((option) => option.value === value)?.label ?? value
      onAdd({ kind, config: { domain: value, label } })
    } else if (info.needs === 'question') {
      const [pageId = '', promptId = ''] = value.split('\u0000')
      const label = options.find((option) => option.value === value)?.label ?? ''
      onAdd({ kind, config: { pageId, promptId, label } })
    } else {
      onAdd({ kind, ...(kind === 'trend' ? { config: { scope: { kind: 'project' } } } : {}) })
    }
  }
  return (
    <li className="wb-gallery-card" data-kind={kind}>
      <span className="wb-gallery-name">{info.title}</span>
      <span className="wb-gallery-text">{info.description}</span>
      <span className="wb-gallery-sizes">
        {info.sizes.map((size) => SIZE_LABEL[size]).join(' · ')}
        {info.engines ? ' · own engine filter' : ''}
      </span>
      {info.needs !== null && options.length > 0 ? (
        <label className="wb-gallery-pick" htmlFor={pickId}>
          <span className="sr-only">
            {info.needs === 'domain' ? 'Competitor to watch' : 'Question to pin'}
          </span>
          <select
            id={pickId}
            className="select"
            value={value}
            onChange={(event) => setPicked(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {blocked ? (
        <span className="wb-gallery-text">
          {info.needs === 'domain' ? 'No competitor is cited yet.' : 'No question is checked yet.'}
        </span>
      ) : null}
      <Button
        size="sm"
        icon="plus"
        disabled={disabled || blocked}
        aria-label={`Add ${info.title}`}
        onClick={add}
      >
        Add
      </Button>
    </li>
  )
}
