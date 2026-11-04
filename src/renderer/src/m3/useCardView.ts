import { useQueryChoice } from '../utils/queryState'

/** The two views of a results card. */
export type CardView = 'chart' | 'table'
const CARD_VIEWS: readonly CardView[] = ['chart', 'table']

/**
 * A results card's chart or table view kept in the route (`?<key>=table`; the chart
 * has none), so a copied link opens the same view and Back undoes a switch.
 */
export function useCardView(key: string): [CardView, (view: CardView) => void] {
  return useQueryChoice(key, CARD_VIEWS, 'chart')
}
