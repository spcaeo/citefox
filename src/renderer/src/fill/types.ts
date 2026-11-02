import type {
  CheckCompanyDomainRequest,
  CheckCompanyDomainResult,
  FillFromWebsiteProgress,
  FillFromWebsiteRequest,
  FillFromWebsiteResult,
  ProductCompetitorsRequest,
  ProductCompetitorsResult,
  SuggestedMarket
} from '@shared/ipc'
import type { CompanyPicks } from './CompanyGroups'
import type { CheckCompanyDomain } from './domain'

/** `projects:fillFromWebsite` and its progress push. */
export interface FillClient {
  fillFromWebsite(request: FillFromWebsiteRequest): Promise<FillFromWebsiteResult>
  onFillProgress(listener: (payload: FillFromWebsiteProgress) => void): () => void
  /** DNS-checks a competitor domain the user typed (batch 2 row 3). */
  checkCompanyDomain(request: CheckCompanyDomainRequest): Promise<CheckCompanyDomainResult>
}

/** Setup step 3's read: the fill, plus "Try again" for one product's competitor search. */
export interface SiteReadClient extends FillClient {
  searchProductCompetitors(request: ProductCompetitorsRequest): Promise<ProductCompetitorsResult>
}

/** What the Fill card's buttons do: each adds one pick to the form; nothing is saved. */
export interface FillActions {
  onAddBrand: (name: string) => void
  onAddCompetitor: (domain: string) => void
  onUseSwitchingFrom: (names: string[]) => void
  onNoteIntegrations: (names: string[]) => void
  onUseMarket: (market: SuggestedMarket) => void
  /** Type an unknown competitor domain; it is DNS-checked before it fills in. */
  onCheckDomain?: CheckCompanyDomain
  /** What the form already holds, so a restored read shows its picks as added. */
  picked?: CompanyPicks
}
