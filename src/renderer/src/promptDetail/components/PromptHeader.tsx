import type { JSX, ReactNode } from 'react'
import type { Market, PromptCheckRow } from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { HeaderField, ScreenHeader, type HeaderPrimary } from '../../components/Header'
import { Markdown } from '../../components/Markdown'
import { DrillButton, type PromptDrill } from '../../drill'
import { stageLabel } from '../../m3/model'
import { marketLabel } from '../../shell/model'
import { Chip, type PageNavProps } from '../../ui'
import { promptSourceLabel } from '../utils/model'

/**
 * FR-13.1 on the shared v2 `ScreenHeader`: the PageNav row, then one title row
 * with the prompt (its inline Markdown kept, so the title is rich content) and
 * its Edit pencil, and at the right the Market field, the one AI menu, the ⋯
 * and the one green Copy fix brief; under it one line with the prompt's source, its stage and the
 * samples. Status, position and movement are the KPI tiles below.
 */
export function PromptHeader({
  nav,
  row,
  fallbackText,
  markets,
  marketId,
  stageDrill = null,
  onMarketChange,
  onSamples,
  actions,
  primary,
  titleAction
}: {
  /** Back to Results, the path and the prompt pager. */
  nav: PageNavProps
  row: PromptCheckRow | null
  /** Shown as the heading when this market has no result for the prompt. */
  fallbackText: string
  markets: readonly Market[]
  marketId: string
  /** The other prompts in this buyer stage. Null: the stage tag is plain. */
  stageDrill?: PromptDrill | null
  onMarketChange: (marketId: string) => void
  /** Moves to the AI Overview and its sample picker. */
  onSamples: () => void
  /** The one AI menu and the ⋯, after the Market field. */
  actions?: ReactNode
  /** The screen's one green button: Copy fix brief. */
  primary?: HeaderPrimary
  /** A small control after the heading: the Edit question pencil. */
  titleAction?: ReactNode
}): JSX.Element {
  return (
    <ScreenHeader
      className="pd2-head"
      nav={nav}
      title={
        <Markdown inline baseLevel={2}>
          {row?.text ?? fallbackText}
        </Markdown>
      }
      titleAction={titleAction}
      primary={primary}
      actions={
        <>
          {markets.length > 0 ? (
            <HeaderField label="Market">
              <select
                className="select"
                value={marketId}
                onChange={(event) => onMarketChange(event.target.value)}
              >
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {marketLabel(market)}
                  </option>
                ))}
              </select>
            </HeaderField>
          ) : null}
          {actions}
        </>
      }
      subtitle={
        <div className="pd2-meta">
          <span>
            {row
              ? `Buyer question ${row.promptPosition} · ${promptSourceLabel(row.source)}`
              : 'Question'}
          </span>
          {row ? (
            stageDrill ? (
              <DrillButton
                drill={stageDrill}
                untracked
                className="pd2-chip-btn"
                label={`${stageLabel(row.intentStage)} stage: the questions in this stage`}
              >
                {stageLabel(row.intentStage)} stage
              </DrillButton>
            ) : (
              <Chip size="sm">{stageLabel(row.intentStage)} stage</Chip>
            )
          ) : (
            <Chip size="sm">Not checked</Chip>
          )}
          {row && row.frequency.samples > 1 ? (
            <button
              type="button"
              className="pd2-chip-btn"
              aria-label={`${row.frequency.matching} of ${pluralize(row.frequency.samples, 'sample')}: go to the samples`}
              onClick={onSamples}
            >
              {row.frequency.matching} of {pluralize(row.frequency.samples, 'sample')}
            </button>
          ) : null}
        </div>
      }
    />
  )
}
