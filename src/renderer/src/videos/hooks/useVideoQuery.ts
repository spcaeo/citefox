import { useRef } from 'react'
import { VIDEO_STEPS, type VideoStep } from '@shared/domain'
import { useHashQuery } from '../../utils/hashQuery'
import { isFlowStep, type FlowStepId } from '../utils/model'

export type VideoTab = 'ideas' | 'yours' | 'channel'

const KEYS = ['tab', 'market', 'scope', 'step', 'idea', 'idea.step'] as const

export interface VideoQuery {
  tab: VideoTab
  /** Market id, or null for every market. */
  marketId: string | null
  /** Page id the screen is narrowed to, or null for every tracked page. */
  pageId: string | null
  step: VideoStep | 'all'
  /** The idea open in the drawer. */
  ideaId: string | null
  /** The idea drawer's step; null opens the idea on its default step. */
  ideaStep: FlowStepId | null
}

export interface VideoQuerySetters {
  setTab: (tab: VideoTab) => void
  setMarket: (marketId: string | null) => void
  setScope: (pageId: string | null) => void
  setStep: (step: VideoStep | 'all') => void
  /** Opens an idea's drawer (a new history entry, so Back closes it). */
  openIdea: (ideaId: string) => void
  /** Closes it: back over the entry `openIdea` pushed, else the URL is rewritten. */
  closeIdea: () => void
  /** Moves the drawer to another step, in place (Back still closes the drawer). */
  setIdeaStep: (step: FlowStepId) => void
}

function isTab(value: string | null): value is VideoTab {
  return value === 'ideas' || value === 'yours' || value === 'channel'
}

function isStep(value: string | null): value is VideoStep {
  return VIDEO_STEPS.some((step) => step === value)
}

/**
 * The YouTube screen's state in the route (`#/youtube?tab=yours&market=…&idea=…&idea.step=…`),
 * so every tab, filter, open idea and its step has a URL and Back steps through them.
 */
export function useVideoQuery(): VideoQuery & VideoQuerySetters {
  const [query, setQuery] = useHashQuery(KEYS)
  /** True when this screen pushed the open idea's entry. */
  const openedHere = useRef(false)
  return {
    tab: isTab(query.tab) ? query.tab : 'ideas',
    marketId: query.market,
    pageId: query.scope,
    step: isStep(query.step) ? query.step : 'all',
    ideaId: query.idea,
    ideaStep: isFlowStep(query['idea.step']) ? query['idea.step'] : null,
    setTab: (tab) => setQuery({ tab: tab === 'ideas' ? null : tab, idea: null, 'idea.step': null }),
    setMarket: (marketId) => setQuery({ market: marketId }),
    setScope: (pageId) => setQuery({ scope: pageId }),
    setStep: (step) => setQuery({ step: step === 'all' ? null : step }),
    openIdea: (ideaId) => {
      openedHere.current = true
      setQuery({ idea: ideaId, 'idea.step': null })
    },
    closeIdea: () => {
      if (openedHere.current) {
        openedHere.current = false
        window.history.back()
      } else {
        setQuery({ idea: null, 'idea.step': null }, { replace: true })
      }
    },
    setIdeaStep: (step) => setQuery({ 'idea.step': step }, { replace: true })
  }
}
