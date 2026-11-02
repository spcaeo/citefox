import type { SearchProvider } from '@shared/domain'
import cloroLogo from '../assets/providers/cloro.png'
import serpapiLogo from '../assets/providers/serpapi.png'

/** The search providers' own marks, beside their names. */
export const PROVIDER_LOGOS: Readonly<Record<SearchProvider, string>> = {
  cloro: cloroLogo,
  serpapi: serpapiLogo
}
