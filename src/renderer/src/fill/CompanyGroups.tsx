import { createElement, useId, useState, type JSX, type ReactNode } from 'react'
import type { CompanySuggestion, ProductSuggestion } from '@shared/ipc'
import { Badge, Button, UiIcon } from '../ui'
import { CompanyRow } from './CompanyRow'
import { CheapestLine, CompetitorGroup } from './CompetitorRows'
import type { CheckCompanyDomain } from './domain'
import { lowestPrices } from './price'
import { ProductChips } from './ProductChips'

/** One part of the groups, for a tabbed card: competitors, switching-from or integrations. */
export type CompanySection = 'competitors' | 'switching' | 'integrations'

/** What the form already holds, so restored suggestions show as added (batch 2 row 4). */
export interface CompanyPicks {
  competitors: readonly string[]
  switchingFrom: readonly string[]
  integrations: readonly string[]
}

function lowerSet(names: readonly string[]): Set<string> {
  return new Set(names.map((name) => name.trim().toLowerCase()))
}

function allPicked(items: readonly CompanySuggestion[], picked: readonly string[]): boolean {
  const names = lowerSet(picked)
  return items.length > 0 && items.every((item) => names.has(item.name.trim().toLowerCase()))
}

/** An h3–h6 for a nesting level (products sit one level, their sub-lists two, below). */
function Heading({
  level,
  id,
  className,
  children
}: {
  level: number
  id?: string
  className: string
  children: ReactNode
}): JSX.Element {
  const tag = `h${Math.min(6, Math.max(3, level))}`
  return createElement(tag, { id, className }, children)
}

/**
 * What Claude found, in groups (Docs/FEEDBACK.md row 3, batch 2 row 5):
 *
 * - with `products`: "Your products" (chips to rename or remove) and, under each kept
 *   product, its competitors from the web search split into "Direct competitors" and
 *   "Partial overlap". One company may sit under two products; adding it once marks it
 *   added in both places (picks are by domain).
 * - competitors without a known product (an older restored read, topic seed discover):
 *   one flat "Competitors" group, as before.
 * - what buyers switch from (replaced or discontinued options, never competitors) and
 *   integrations and partners, each with one action for the whole group.
 *
 * A competitor domain is found by the search, seen on the site, found by lookup (tagged),
 * or unknown; with `onCheckDomain` an unknown one can be typed in, checked, then added.
 */
export function CompanyGroups({
  site,
  products,
  competitors,
  switchingFrom,
  integrations,
  headingLevel = 3,
  onAddCompetitor,
  competitorHint,
  onUseSwitchingFrom,
  onNoteIntegrations,
  onCheckDomain,
  picked,
  only
}: {
  /** The business's own domain: evidence paths open on it. */
  site: string
  /** Products found on the site; competitors point at one by `product`. */
  products?: readonly ProductSuggestion[]
  competitors: readonly CompanySuggestion[]
  switchingFrom: readonly CompanySuggestion[]
  integrations: readonly CompanySuggestion[]
  headingLevel?: 3 | 4
  /** Omitted where competitors cannot be added here (the hint says where). */
  onAddCompetitor?: (domain: string) => void
  competitorHint?: string
  onUseSwitchingFrom: (names: string[]) => void
  onNoteIntegrations: (names: string[]) => void
  /** Lets the user type an unknown competitor domain (`projects:checkCompanyDomain`). */
  onCheckDomain?: CheckCompanyDomain
  /** Picks already in the form when the groups first show (a restored draft). */
  picked?: CompanyPicks
  /** Show one section only (the Fill card's tabs). Omitted: every group, one under another. */
  only?: CompanySection
}): JSX.Element | null {
  const [added, setAdded] = useState<readonly string[]>(() => {
    if (!picked) return []
    const domains = lowerSet(picked.competitors)
    return competitors.flatMap((item) =>
      item.domain !== null && domains.has(item.domain.toLowerCase()) ? [item.domain] : []
    )
  })
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const [names, setNames] = useState<Readonly<Record<string, string>>>({})
  const [removed, setRemoved] = useState<readonly string[]>([])
  const [usedSwitching, setUsedSwitching] = useState(() =>
    picked ? allPicked(switchingFrom, picked.switchingFrom) : false
  )
  const [notedIntegrations, setNotedIntegrations] = useState(() =>
    picked ? allPicked(integrations, picked.integrations) : false
  )
  const showCompetitors = only === undefined || only === 'competitors'
  const showSwitching = only === undefined || only === 'switching'
  const showIntegrations = only === undefined || only === 'integrations'
  const productList = showCompetitors ? (products ?? []) : []
  const total =
    productList.length +
    (showCompetitors ? competitors.length : 0) +
    (showSwitching ? switchingFrom.length : 0) +
    (showIntegrations ? integrations.length : 0)
  if (total === 0) return null
  const integrationLabel =
    integrations.length === 1 ? 'Note as integration' : 'Note as integrations'
  const productIds = new Set(productList.map((product) => product.id))
  const withTyped = (item: CompanySuggestion): CompanySuggestion => {
    const domain = typed[item.id]
    return item.domain === null && domain !== undefined
      ? { ...item, domain, domainSource: 'typed' as const, checkDomain: false }
      : item
  }
  const flat = competitors
    .filter((item) => item.product == null || !productIds.has(item.product))
    .map(withTyped)
  const kept = productList
    .filter((product) => !removed.includes(product.id))
    .map((product) => ({ ...product, name: names[product.id] ?? product.name }))
  const competitorRows = {
    site,
    ...(onCheckDomain ? { onCheckDomain } : {}),
    onDomainSaved: (id: string, domain: string) => setTyped((map) => ({ ...map, [id]: domain })),
    rowAction: (item: CompanySuggestion): JSX.Element | null =>
      onAddCompetitor && item.domain !== null ? (
        added.includes(item.domain) ? (
          <Button size="sm" icon="check" disabled>
            Added
          </Button>
        ) : (
          <Button
            size="sm"
            icon="plus"
            aria-label={`Add competitor ${item.name}`}
            onClick={() => {
              if (item.domain === null) return
              onAddCompetitor(item.domain)
              setAdded((list) => [...list, item.domain as string])
            }}
          >
            {/* Short on screen so the row stays one line in the rail; the name says the rest. */}
            Add
          </Button>
        )
      ) : null
  }

  return (
    <div className="fill-groups">
      {productList.length > 0 ? (
        <ProductsSection
          level={headingLevel}
          chips={
            <ProductChips
              products={kept}
              onRename={(id, name) => setNames((map) => ({ ...map, [id]: name }))}
              onRemove={(id) => setRemoved((list) => [...list, id])}
            />
          }
        >
          {kept.map((product) => {
            const mine = competitors.filter((item) => item.product === product.id).map(withTyped)
            const direct = mine.filter((item) => item.tier !== 'partial')
            const partial = mine.filter((item) => item.tier === 'partial')
            const directLowest = lowestPrices(direct, 'direct competitors')
            const partialLowest = lowestPrices(partial, 'partial-overlap competitors')
            return (
              <section
                className="fill-product"
                key={product.id}
                aria-label={`Competitors for ${product.name}`}
              >
                <Heading level={headingLevel + 1} className="fill-product-title">
                  {product.name}
                </Heading>
                {product.searchNote ? (
                  <p className="fill-group-hint">{product.searchNote}</p>
                ) : null}
                {mine.length === 0 ? (
                  <p className="fill-group-hint">No competitors found for this product.</p>
                ) : null}
                <CheapestLine items={direct} lowest={directLowest} label="Cheapest direct rivals" />
                {direct.length > 0 ? (
                  <CompetitorGroup
                    title="Direct competitors"
                    hint="Sell the same thing to the same buyer for the same job."
                    level={headingLevel + 2}
                    items={direct}
                    lowest={directLowest}
                    {...competitorRows}
                  />
                ) : null}
                {partial.length > 0 ? (
                  <CompetitorGroup
                    title="Partial overlap"
                    hint="Do the job as a side feature, or for a nearby buyer."
                    level={headingLevel + 2}
                    items={partial}
                    lowest={partialLowest}
                    {...competitorRows}
                  />
                ) : null}
              </section>
            )
          })}
        </ProductsSection>
      ) : null}
      {showCompetitors && flat.length > 0 ? (
        <CompetitorGroup
          title="Competitors"
          hint={competitorHint ?? 'Live products a buyer could choose instead of you today.'}
          level={headingLevel}
          items={flat}
          lowest={lowestPrices(flat, 'competitors')}
          {...competitorRows}
        />
      ) : null}
      {showSwitching && switchingFrom.length > 0 ? (
        <Group
          title="What buyers switch from"
          hint="Not competitors: replaced or discontinued options buyers move to you from. They make good trigger events."
          level={headingLevel}
          items={switchingFrom}
          site={site}
          action={
            usedSwitching ? (
              <p className="fill-done" role="status">
                <UiIcon name="check" size={14} />
                Used in buyer questions
              </p>
            ) : (
              <Button
                size="sm"
                icon="plus"
                onClick={() => {
                  onUseSwitchingFrom(switchingFrom.map((item) => item.name))
                  setUsedSwitching(true)
                }}
              >
                Use in buyer questions
              </Button>
            )
          }
        />
      ) : null}
      {showIntegrations && integrations.length > 0 ? (
        <Group
          title="Integrations & partners"
          hint="Not competitors: tools buyers connect or send from with you."
          level={headingLevel}
          items={integrations}
          site={site}
          action={
            notedIntegrations ? (
              <p className="fill-done" role="status">
                <UiIcon name="check" size={14} />
                Noted as {integrations.length === 1 ? 'an integration' : 'integrations'}
              </p>
            ) : (
              <Button
                size="sm"
                icon="plus"
                onClick={() => {
                  onNoteIntegrations(integrations.map((item) => item.name))
                  setNotedIntegrations(true)
                }}
              >
                {integrationLabel}
              </Button>
            )
          }
        />
      ) : null}
    </div>
  )
}

/** "Your products": the heading, one hint line, the chips, then one block per product. */
function ProductsSection({
  level,
  chips,
  children
}: {
  level: 3 | 4
  chips: JSX.Element
  children: JSX.Element[]
}): JSX.Element {
  const id = useId()
  return (
    <section className="fill-group" aria-labelledby={`${id}-title`}>
      <div className="fill-group-head">
        <Heading level={level} id={`${id}-title`} className="fill-group-title">
          Your products
        </Heading>
      </div>
      <p className="fill-group-hint">
        Competitors are searched per product. Rename or remove a product to tidy the list.
      </p>
      {chips}
      {children}
    </section>
  )
}

/** What buyers switch from, or integrations: list rows and one action for the whole group. */
function Group({
  title,
  hint,
  level,
  items,
  site,
  action
}: {
  title: string
  hint?: string
  level: number
  items: readonly CompanySuggestion[]
  site: string
  action?: JSX.Element
}): JSX.Element {
  const id = useId()
  return (
    <section
      className={level > 4 ? 'fill-group fill-subgroup' : 'fill-group'}
      aria-labelledby={`${id}-title`}
    >
      <div className="fill-group-head">
        <Heading level={level} id={`${id}-title`} className="fill-group-title">
          {title}
        </Heading>
        <Badge className="fill-group-count" label={`${items.length} found`}>
          {items.length}
        </Badge>
      </div>
      {hint ? (
        <p className="fill-group-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <ul className="fill-items">
        {items.map((item) => (
          <CompanyRow
            key={item.id}
            item={item}
            site={site}
            showUnknownDomain={false}
            onDomainSaved={() => undefined}
            action={null}
          />
        ))}
      </ul>
      {action ? <div className="fill-group-foot">{action}</div> : null}
    </section>
  )
}
