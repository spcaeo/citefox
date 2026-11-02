import { useId, type JSX } from 'react'
import type { CompetitorProductOption, SavedCompetitor } from '@shared/ipc'
import { SiteIcon } from '../../siteIcon/SiteIcon'
import { ChipInput, DrawerField, DrawerFields, DrawerSection, SegmentedControl } from '../../ui'
import {
  previewDomain,
  WHOLE_BUSINESS,
  type CompetitorForm,
  type CompetitorFormErrors
} from './model'

const TIERS = [
  { value: 'direct', label: 'Direct' },
  { value: 'partial', label: 'Partial' }
]

/** Domain (with its site icon), name, other domains, tier and products. */
export function CompetitorFields({
  form,
  errors,
  products,
  onChange
}: {
  form: CompetitorForm
  errors: CompetitorFormErrors
  products: readonly CompetitorProductOption[]
  onChange: (patch: Partial<CompetitorForm>) => void
}): JSX.Element {
  const base = useId()
  const preview = previewDomain(form)
  const toggle = (value: string): void =>
    onChange({
      products: form.products.includes(value)
        ? form.products.filter((item) => item !== value)
        : [...form.products, value]
    })
  return (
    <DrawerFields columns={2}>
      <DrawerField
        label="Domain"
        htmlFor={`${base}-domain`}
        hint={
          preview ? `Matches links on ${preview} and its subdomains.` : 'Such as simpletexting.com'
        }
        error={errors.domain}
      >
        <span className="cmp-domain-field">
          {preview ? <SiteIcon domain={preview} size={20} /> : null}
          <input
            id={`${base}-domain`}
            className="ui-input mono"
            value={form.domain}
            data-autofocus=""
            spellCheck={false}
            autoComplete="off"
            aria-describedby={`${base}-domain-hint${errors.domain ? ` ${base}-domain-error` : ''}`}
            onChange={(event) => onChange({ domain: event.target.value })}
          />
        </span>
      </DrawerField>
      <DrawerField
        label="Name"
        htmlFor={`${base}-name`}
        hint={form.name.trim() === '' && preview ? `Blank: ${preview}` : 'How reports name it.'}
        error={errors.name}
      >
        <input
          id={`${base}-name`}
          className="ui-input"
          value={form.name}
          autoComplete="off"
          aria-describedby={`${base}-name-hint${errors.name ? ` ${base}-name-error` : ''}`}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </DrawerField>
      <DrawerField
        label="Other domains"
        htmlFor={`${base}-aliases`}
        wide
        hint="Its other sites: an app domain, a country site, a brand it bought. Enter or a comma adds one."
        error={errors.aliases}
      >
        {({ id, describedBy }) => (
          <ChipInput
            id={id}
            items={form.aliases}
            onItems={(aliases) => onChange({ aliases })}
            draft={form.aliasDraft}
            onDraft={(aliasDraft) => onChange({ aliasDraft })}
            placeholder="app.example.com"
            describedBy={describedBy}
            mono
            domains
          />
        )}
      </DrawerField>
      <div className="ui-drawer-field ui-drawer-field-wide">
        <span className="ui-drawer-label" aria-hidden="true">
          Competes
        </span>
        <SegmentedControl
          label="Competes"
          size="sm"
          options={TIERS}
          value={form.tier}
          onChange={(value) => onChange({ tier: value === 'partial' ? 'partial' : 'direct' })}
        />
      </div>
      {products.length > 0 ? (
        <fieldset className="cmp-checks ui-drawer-field-wide" aria-describedby={`${base}-p-err`}>
          <legend className="ui-drawer-label">Competes with</legend>
          {[{ id: WHOLE_BUSINESS, name: 'The whole business' }, ...products].map((product) => (
            <label key={product.id || 'all'} className="cmp-check">
              <input
                type="checkbox"
                checked={form.products.includes(product.id)}
                onChange={() => toggle(product.id)}
              />
              <span>{product.name}</span>
            </label>
          ))}
          {errors.products ? (
            <p id={`${base}-p-err`} className="ui-drawer-error" role="alert">
              {errors.products}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </DrawerFields>
  )
}

/** Merge: the other saved competitors to fold in, and the name to keep. */
export function MergePicker({
  saved,
  others,
  picked,
  name,
  onPick,
  onName
}: {
  saved: SavedCompetitor
  others: readonly SavedCompetitor[]
  picked: readonly string[]
  name: string
  onPick: (ids: string[]) => void
  onName: (name: string) => void
}): JSX.Element {
  const base = useId()
  const names = [saved, ...others.filter((item) => picked.includes(item.id))].map(
    (item) => item.name
  )
  return (
    <>
      <DrawerSection
        title={`Merge into ${saved.name}`}
        count={picked.length > 0 ? `${picked.length} picked` : undefined}
        description="Pick the competitors that are the same company."
      >
        {others.length === 0 ? (
          <p className="muted">No other saved competitor to merge with.</p>
        ) : (
          <fieldset className="cmp-checks">
            <legend className="sr-only">Competitors to merge</legend>
            {others.map((item) => (
              <label key={item.id} className="cmp-check">
                <input
                  type="checkbox"
                  checked={picked.includes(item.id)}
                  onChange={() =>
                    onPick(
                      picked.includes(item.id)
                        ? picked.filter((id) => id !== item.id)
                        : [...picked, item.id]
                    )
                  }
                />
                {item.domain ? <SiteIcon domain={item.domain} /> : null}
                <span>{item.name}</span>
                {item.domain && item.domain !== item.name ? (
                  <span className="faint mono">{item.domain}</span>
                ) : null}
              </label>
            ))}
          </fieldset>
        )}
      </DrawerSection>
      <DrawerSection title="Name to keep">
        <DrawerFields>
          <DrawerField label="Name" htmlFor={`${base}-name`} hint={`From ${names.join(', ')}`}>
            <input
              id={`${base}-name`}
              className="ui-input"
              list={`${base}-names`}
              value={name}
              autoComplete="off"
              onChange={(event) => onName(event.target.value)}
            />
          </DrawerField>
        </DrawerFields>
        <datalist id={`${base}-names`}>
          {names.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </DrawerSection>
    </>
  )
}
