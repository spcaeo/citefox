import type { ApiKeyProvider } from '@shared/domain'

/** CiteFox's cloro affiliate code (owner, 2026-10-25), on every link to cloro's site. */
const CLORO_REF = 'fpr=citifox'

/** cloro sign-up, with the affiliate code. The one place the address is written. */
export const CLORO_SIGNUP_URL = `https://cloro.dev?${CLORO_REF}`

/** The providers the 3-step key card guides (helpfill-board panel 6). */
export type GuidedKeyProvider = Extract<ApiKeyProvider, 'cloro' | 'anthropic' | 'serpapi' | 'jina'>

export interface ProviderKeyGuide {
  /** As the provider writes its own name. */
  name: string
  /** Step 1: where to make an account. */
  signupUrl: string
  /** Shown under step 1, with Copy and Open. */
  signupDomain: string
  /** Step 2: the page that lists API keys. */
  dashboardUrl: string
  /** Step 2's trail through that page, such as "Dashboard › API keys › Create key". */
  dashboardPath: string
  /** Step 3: how the key is tested before it is saved. */
  testNote: string
}

export const KEY_GUIDES: Readonly<Record<GuidedKeyProvider, ProviderKeyGuide>> = {
  cloro: {
    name: 'cloro',
    signupUrl: CLORO_SIGNUP_URL,
    signupDomain: 'cloro.dev',
    dashboardUrl: 'https://dashboard.cloro.dev',
    dashboardPath: 'Dashboard › API keys › Create key',
    testNote: 'We test it with one free call (your credit balance) before saving'
  },
  anthropic: {
    name: 'Anthropic',
    signupUrl: 'https://console.anthropic.com',
    signupDomain: 'console.anthropic.com',
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    dashboardPath: 'Console › Settings › API keys › Create key',
    testNote: 'We test it with one very small Claude call before saving'
  },
  serpapi: {
    name: 'SerpApi',
    signupUrl: 'https://serpapi.com/users/sign_up',
    signupDomain: 'serpapi.com',
    dashboardUrl: 'https://serpapi.com/manage-api-key',
    dashboardPath: 'Dashboard › Api Key › Your Private API Key',
    testNote: 'We test it with one free call (your account page) before saving'
  },
  jina: {
    name: 'Jina',
    signupUrl: 'https://jina.ai/reader',
    signupDomain: 'jina.ai',
    dashboardUrl: 'https://jina.ai/api-dashboard/key-manager',
    dashboardPath: 'API dashboard › API keys › Create key',
    testNote: 'We test it with one page read before saving'
  }
}

export function isGuidedKeyProvider(provider: ApiKeyProvider): provider is GuidedKeyProvider {
  return provider in KEY_GUIDES
}

/**
 * What each search provider costs and gives free, for setup step 7's side panel.
 * Read from the providers' pricing pages on 2026-10-25; check them again before a release.
 */
export interface ProviderPlan {
  pricingUrl: string
  pricingDomain: string
  /** "500 credits a month". */
  free: string
  /** Free allowance as a number, in the provider's own unit. */
  freeAmount: number
  /** "from $30 a month for 37,500 credits". */
  paid: string
}

export const PROVIDER_PLANS: Readonly<Record<'cloro' | 'serpapi', ProviderPlan>> = {
  cloro: {
    pricingUrl: `https://cloro.dev/pricing?${CLORO_REF}`,
    pricingDomain: 'cloro.dev/pricing',
    free: '500 credits every month, no card',
    freeAmount: 500,
    paid: 'From $30 a month for 37,500 credits'
  },
  serpapi: {
    pricingUrl: 'https://serpapi.com/pricing',
    pricingDomain: 'serpapi.com/pricing',
    free: '250 searches every month',
    freeAmount: 250,
    paid: 'From $25 a month for 1,000 searches'
  }
}

/** When PROVIDER_PLANS was read, shown under the plans. */
export const PROVIDER_PLANS_CHECKED = '25 Oct 2026'
