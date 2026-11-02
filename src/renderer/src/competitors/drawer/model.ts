import { competitorDomainOf, MAX_COMPETITOR_ALIASES } from '@shared/domain'
import type { SaveCompetitorRequest, SavedCompetitor } from '@shared/ipc'
import type { DrawerParamPatch } from '../../shell/drawerUrl'

/**
 * The `competitor` drawer's URL and form, pure. `competitor` is a saved competitor's
 * id (the Competitors row id) or `new`; `competitor.mode=merge` merges it with the
 * ids in `competitor.ids`.
 */

export type CompetitorDrawerMode = 'add' | 'edit' | 'merge'

export interface CompetitorDrawerParams {
  mode: CompetitorDrawerMode
  /** Null when adding. */
  id: string | null
  /** The competitors picked to merge into `id`. */
  ids: string[]
}

export const NEW_COMPETITOR = 'new'

export function competitorParamsFrom(
  params: Readonly<Record<string, string>>
): CompetitorDrawerParams {
  const value = params.competitor ?? NEW_COMPETITOR
  if (value === NEW_COMPETITOR) return { mode: 'add', id: null, ids: [] }
  const ids = (params['competitor.ids'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== value)
  return { mode: params['competitor.mode'] === 'merge' ? 'merge' : 'edit', id: value, ids }
}

export function addCompetitorValues(): DrawerParamPatch {
  return { competitor: NEW_COMPETITOR }
}

export function editCompetitorValues(id: string): DrawerParamPatch {
  return { competitor: id }
}

export function mergeCompetitorValues(id: string, ids: readonly string[] = []): DrawerParamPatch {
  return {
    competitor: id,
    'competitor.mode': 'merge',
    'competitor.ids': ids.length > 0 ? ids.join(',') : null
  }
}

/** The whole business in the products picker (a saved row's null product). */
export const WHOLE_BUSINESS = ''

export interface CompetitorForm {
  name: string
  domain: string
  aliases: string[]
  /** Text still in the other-domains field, counted on save. */
  aliasDraft: string
  tier: 'direct' | 'partial'
  /** Product ids; `WHOLE_BUSINESS` for the whole business. */
  products: string[]
}

export function formFrom(saved: SavedCompetitor | null): CompetitorForm {
  return {
    name: saved?.name ?? '',
    domain: saved?.domain ?? '',
    aliases: [...(saved?.aliases ?? [])],
    aliasDraft: '',
    tier: saved?.tier ?? 'direct',
    products: (saved?.productIds ?? [null]).map((id) => id ?? WHOLE_BUSINESS)
  }
}

export function sameForm(left: CompetitorForm, right: CompetitorForm): boolean {
  return (
    left.name.trim() === right.name.trim() &&
    left.domain.trim() === right.domain.trim() &&
    left.aliasDraft.trim() === right.aliasDraft.trim() &&
    left.tier === right.tier &&
    left.aliases.join('\n') === right.aliases.join('\n') &&
    [...left.products].sort().join('\n') === [...right.products].sort().join('\n')
  )
}

/** The bare host the domain field reads as, for the site icon. Null until it is one. */
export function previewDomain(form: Pick<CompetitorForm, 'domain'>): string | null {
  return form.domain.trim() === '' ? null : competitorDomainOf(form.domain)
}

function aliasList(form: CompetitorForm): string[] {
  return [...form.aliases, form.aliasDraft].map((item) => item.trim()).filter(Boolean)
}

export interface CompetitorFormErrors {
  name?: string
  domain?: string
  aliases?: string
  products?: string
}

export function formErrors(form: CompetitorForm, hasProducts: boolean): CompetitorFormErrors {
  const errors: CompetitorFormErrors = {}
  const domain = previewDomain(form)
  if (form.domain.trim() !== '' && domain === null) {
    errors.domain = 'Use a domain such as competitor.example.com'
  }
  if (form.name.trim() === '' && form.domain.trim() === '') {
    errors.name = 'Give the competitor a name or a domain'
  }
  const aliases = aliasList(form)
  const bad = aliases.find((item) => competitorDomainOf(item) === null)
  if (bad !== undefined) errors.aliases = `${bad} is not a domain`
  else if (aliases.length > MAX_COMPETITOR_ALIASES) {
    errors.aliases = `Keep it to ${MAX_COMPETITOR_ALIASES} other domains`
  }
  if (hasProducts && form.products.length === 0) errors.products = 'Pick what it competes with'
  return errors
}

export function hasErrors(errors: CompetitorFormErrors): boolean {
  return Object.values(errors).some((value) => value !== undefined)
}

/** The save request: a blank name takes the domain. */
export function saveRequest(
  projectId: string,
  id: string | null,
  form: CompetitorForm,
  hasProducts: boolean
): SaveCompetitorRequest {
  const domain = previewDomain(form)
  const name = form.name.trim() || domain || form.domain.trim()
  return {
    projectId,
    id,
    name,
    domain,
    aliases: aliasList(form).map((item) => competitorDomainOf(item) ?? item),
    tier: form.tier,
    ...(hasProducts
      ? { productIds: form.products.map((item) => (item === WHOLE_BUSINESS ? null : item)) }
      : {})
  }
}

/** "Merge 3 competitors". */
export function mergeLabel(picked: number): string {
  return picked === 0 ? 'Merge competitors' : `Merge ${picked + 1} competitors`
}
