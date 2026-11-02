import type { CitationNoiseKind } from '@shared/ipc'

/** FR-20.5. Why a cited own page is probably not worth tracking. */
export function noiseLabel(kind: CitationNoiseKind): string {
  switch (kind) {
    case 'login':
      return 'Probably ignore: login page'
    case 'account':
      return 'Probably ignore: account page'
    case 'legal':
      return 'Probably ignore: legal page'
    case 'cart':
      return 'Probably ignore: cart or checkout'
    case 'search':
      return 'Probably ignore: site search'
  }
}
