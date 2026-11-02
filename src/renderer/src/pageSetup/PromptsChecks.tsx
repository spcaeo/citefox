import type { JSX } from 'react'
import type { BuyerPrompt, CoverageLevel } from '@shared/domain'
import { Icon } from '../components/Icon'
import { DrillNumber, type DrillScope } from '../drill'
import { pageHash } from '../shell/routes'
import { coverageLabel } from './labels'
import { brandDrill, coverageDrills } from './promptsDrills'
import './prompts.css'

/**
 * "Coverage against the page" from the stored Content gaps matrix. Each count
 * opens a drawer of exactly those prompts (NFR-14). Hidden until a matrix exists.
 */
export function PromptCoverageLine({
  prompts,
  coverage,
  scope,
  pageId
}: {
  prompts: readonly BuyerPrompt[]
  coverage: ReadonlyMap<string, CoverageLevel>
  scope: DrillScope
  pageId: string
}): JSX.Element | null {
  const drills = coverageDrills(prompts, coverage, scope)
  if (drills.length === 0) return null
  return (
    <div className="ps-checks" role="group" aria-label="Coverage against the page">
      <span className="faint">Coverage against the page:</span>
      {drills.map(({ level, drill }) => (
        <span key={level}>
          <DrillNumber drill={drill} />
          {coverageLabel(level)}
        </span>
      ))}
      <a href={pageHash(pageId, 'gaps')}>Open Content gaps</a>
    </div>
  )
}

/**
 * The brand check line. When a prompt names a brand, the line offers the
 * prompts that do, as a drawer of exactly that many prompts.
 */
export function BrandLine({
  prompts,
  brandsClear,
  message,
  scope
}: {
  prompts: readonly BuyerPrompt[]
  brandsClear: boolean
  message: string
  scope: DrillScope
}): JSX.Element {
  const drill = brandsClear ? null : brandDrill(prompts, message, scope)
  return (
    <p className={brandsClear ? 'ps-ok' : 'ps-warn'}>
      <Icon name={brandsClear ? 'check' : 'warning'} />
      {message}
      {drill ? (
        <>
          {' '}
          <DrillNumber
            drill={drill}
            suffix={drill.items.length === 1 ? ' question' : ' questions'}
          />
        </>
      ) : null}
    </p>
  )
}
