import type { JSX } from 'react'
import { pluralize } from '@shared/pluralize'
import {
  SectionCard,
  SetupStepFrame,
  SitePage,
  ManualDetail,
  hasManualDetail,
  useSectionEnv
} from '../sections'
import { StartOverStep } from '../sections/StartOverStep'
import { keptCount } from '../sections/merge'
import { brandName } from '../sections/rowView'
import type { SetupStepProps } from './types'

const PRODUCT_FIELDS = [
  { key: 'name', label: 'Product name', placeholder: 'Product name' },
  { key: 'url', label: 'Page on your site', placeholder: '/page-about-it/', mono: true },
  { key: 'detail', label: 'What it does', placeholder: 'What it does, in a few words' }
] as const

/**
 * Step 4, "Is this right about <Brand>?" (mock-up panel 4): what the brand
 * does (text), its names and spellings (chips) and what it sells (list).
 * Continue needs a summary and at least one kept brand name.
 */
export function BrandStep(props: SetupStepProps): JSX.Element {
  const env = useSectionEnv(props)
  const { draft } = props
  const brand = brandName(draft)
  const site = draft.site.domain.trim()
  const products = keptCount(draft.lists.products)
  const names = keptCount(draft.lists.brands)
  const hasSummary = draft.summary.trim().length > 0
  const ready = hasSummary && names > 0
  const note = !hasSummary
    ? `Add what ${brand} does to continue`
    : names === 0
      ? 'Keep at least one brand name to continue'
      : `${pluralize(products, 'product')} · ${pluralize(names, 'name')}`

  return (
    <SetupStepFrame
      step={4}
      title={`Is this right about ${brand}?`}
      from="✦ From your site"
      sub="Change anything that's wrong, add what's missing, then confirm."
      alert={props.alert}
      onBack={props.onBack}
      note={note}
      primary={{
        label: 'Looks right, continue',
        onClick: props.onContinue,
        disabled: !ready || props.busy,
        busy: props.busy
      }}
      headAction={<StartOverStep step={props} sections={['summary', 'brands', 'products']} />}
    >
      <SectionCard
        variant="text"
        env={env}
        section="summary"
        title={`What ${brand} does`}
        placeholder="One or two sentences: what it does and for whom."
        redoLabel="Rewrite it"
      />
      <SectionCard
        variant="chips"
        env={env}
        list="brands"
        title="Brand names and spellings"
        hint="left out of buyer questions; spotted in AI answers"
        noun={{ one: 'name', many: 'names' }}
        addPlaceholder="A name or spelling"
        redoLabel="Redo names"
      />
      <SectionCard
        variant="list"
        env={env}
        list="products"
        title="What you sell"
        noun={{ one: 'product', many: 'products' }}
        addPlaceholder='+ Add a product, e.g. "Mass texting"'
        fields={PRODUCT_FIELDS}
        aiLabel="✦ found"
        redoLabel="Redo products"
        autoFill="products"
        renderSub={(item) => {
          const page = <SitePage value={item.url} site={site} />
          const hasDetail = hasManualDetail(item)
          if (!hasDetail && !item.url) return null
          return (
            <>
              {hasDetail ? <ManualDetail item={item} /> : null}
              {hasDetail && item.url ? ' · ' : null}
              {page}
            </>
          )
        }}
      />
    </SetupStepFrame>
  )
}
