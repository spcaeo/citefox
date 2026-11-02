import type { JSX } from 'react'
import type { BoardWidget, WidgetEngine, WidgetKind } from '@shared/summary-board'
import { WIDGET_INFO } from '../board/catalog'
import { EngineChoice } from './EngineChoice'
import type { WidgetEnv } from './env'
import { CitedRateWidget, CompetitorWidget, EnginesWidget, QuestionWidget } from './MetricWidgets'
import {
  ChangesWidget,
  CitedSitesWidget,
  HeadlineWidget,
  NextFixesWidget,
  ResultsWidget,
  TrendWidget,
  type WidgetProps
} from './SummaryWidgets'
import {
  CreditsWidget,
  FixesWorkingWidget,
  GoogleUpdatesWidget,
  PageChangesWidget
} from './TrackingWidgets'

const COMPONENTS: Readonly<Record<WidgetKind, (props: WidgetProps) => JSX.Element>> = {
  headline: HeadlineWidget,
  results: ResultsWidget,
  trend: TrendWidget,
  'cited-sites': CitedSitesWidget,
  'next-fixes': NextFixesWidget,
  changes: ChangesWidget,
  'cited-rate': CitedRateWidget,
  'fixes-working': FixesWorkingWidget,
  engines: EnginesWidget,
  competitor: CompetitorWidget,
  'google-updates': GoogleUpdatesWidget,
  credits: CreditsWidget,
  'page-changes': PageChangesWidget,
  question: QuestionWidget
}

/**
 * One widget with its own engine filter. `override` is a link's `?engine=` that sets
 * every widget at once (the widget's own pick is kept for later).
 */
export function Widget({
  widget,
  env,
  override,
  onEngine
}: {
  widget: BoardWidget
  env: WidgetEnv
  override: WidgetEngine | null
  onEngine: (engine: WidgetEngine) => void
}): JSX.Element {
  const info = WIDGET_INFO[widget.kind]
  const offered = env.offered
  const picked = override ?? widget.engine
  // An engine the project no longer checks reads as All. With one engine checked, All is
  // that engine (its logo stands fixed), so its own numbers and words show.
  const only = offered.length === 1 ? (offered[0] ?? null) : null
  const known: WidgetEngine = picked === 'all' || offered.includes(picked) ? picked : 'all'
  const engine: WidgetEngine = known === 'all' && only !== null ? only : known
  const shown = engine === widget.engine ? widget : { ...widget, engine }
  const tools = info.engines ? (
    <EngineChoice
      engines={offered}
      value={engine}
      onChange={onEngine}
      title={info.title}
      compact={widget.size === 's'}
    />
  ) : null
  const Component = COMPONENTS[widget.kind]
  return <Component widget={shown} env={env} tools={tools} />
}
