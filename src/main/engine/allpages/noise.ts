import type { CitationNoiseKind } from '@shared/ipc'

/**
 * FR-20.5. Own pages that AI Overviews cite but that are rarely worth tracking:
 * sign-in and account pages, legal pages, carts, and site search. Matched on
 * whole path segments, so `/blog/login-alerts/` is not noise.
 */
const SEGMENTS: readonly [CitationNoiseKind, readonly string[]][] = [
  [
    'login',
    [
      'login',
      'log-in',
      'signin',
      'sign-in',
      'logout',
      'log-out',
      'signout',
      'sign-out',
      'auth',
      'sso',
      'password',
      'forgot-password',
      'reset-password'
    ]
  ],
  [
    'account',
    ['account', 'my-account', 'accounts', 'signup', 'sign-up', 'register', 'dashboard', 'profile']
  ],
  [
    'legal',
    [
      'privacy',
      'privacy-policy',
      'terms',
      'terms-of-service',
      'terms-of-use',
      'terms-and-conditions',
      'tos',
      'legal',
      'cookies',
      'cookie-policy',
      'gdpr',
      'dpa',
      'imprint',
      'disclaimer',
      'acceptable-use'
    ]
  ],
  ['cart', ['cart', 'checkout', 'basket']],
  ['search', ['search']]
]

export function citationNoise(url: string): CitationNoiseKind | null {
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return null
  }
  const segments = path
    .split('/')
    .map((segment) => segment.replace(/\.(html?|php|aspx?)$/, ''))
    .filter((segment) => segment.length > 0)
  for (const [kind, names] of SEGMENTS) {
    if (segments.some((segment) => names.includes(segment))) return kind
  }
  return null
}
