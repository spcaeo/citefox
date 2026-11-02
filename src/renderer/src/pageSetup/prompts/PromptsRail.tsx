import type { JSX, ReactNode } from 'react'
import type { BuyerProfile, BuyerPrompt, CoverageLevel, PromptSetView } from '@shared/domain'
import type { DrillScope } from '../../drill'
import { formatReadStamp } from '../model'
import { pageHash } from '../../shell/routes'
import { UiIcon } from '../../ui'
import { BrandLine, PromptCoverageLine } from '../PromptsChecks'
import { TemplateProvenance } from '../TemplateProvenance'

/**
 * The context strip above the prompt grid, one compact row: who the prompts
 * are written for (the buyer profile, with Edit), the set's version and
 * template, the brand check, coverage against the page, and the screen's
 * controls (`end`: language, set picker, settings) at the right.
 */
export function PromptsRail({
  pageId,
  view,
  profile,
  prompts,
  coverage,
  scope,
  end
}: {
  pageId: string
  view: PromptSetView
  profile: BuyerProfile | null
  prompts: readonly BuyerPrompt[]
  coverage: ReadonlyMap<string, CoverageLevel>
  scope: DrillScope
  /** The screen's controls, at the right end of the strip. */
  end?: ReactNode
}): JSX.Element {
  return (
    <section className="pr-strip" aria-label="About these questions">
      <div className="pr-strip-facts">
        <p className="pr-strip-item">
          <span className="pr-strip-key">Written for</span>
          {profile === null ? (
            <span className="pr-strip-muted">The buyer profile shows here once it is written.</span>
          ) : (
            <span
              className="pr-strip-who"
              title={`${profile.who} · written ${formatReadStamp(profile.createdAt)}`}
            >
              {firstSentence(profile.who)}
            </span>
          )}
          <a
            className="ui-icon-btn ui-icon-btn-sm"
            href={pageHash(pageId, 'audience')}
            aria-label="Edit the buyer profile"
            data-tip="Edit the buyer profile"
          >
            <UiIcon name="pencil" size={16} />
          </a>
        </p>
        <p className="pr-strip-item">
          <span className="pr-strip-key">Set</span>
          <span>
            {view.version === null ? 'Not saved yet' : `v${view.version}`}
            {view.savedAt ? ` · saved ${formatReadStamp(view.savedAt)}` : ''}
            {view.version !== null ? (
              <>
                {' · '}
                <a href={pageHash(pageId, 'history')}>Version history</a>
              </>
            ) : null}
            {view.templateId && view.templateName ? (
              <>
                {' · '}
                <TemplateProvenance
                  templateId={view.templateId}
                  templateName={view.templateName}
                  templateHash={view.templateHash ?? ''}
                  edited={view.templateUpdatedAt !== null}
                />
              </>
            ) : null}
          </span>
        </p>
        <BrandLine
          prompts={prompts}
          brandsClear={view.brandsClear}
          message={view.brandMessage}
          scope={scope}
        />
        <PromptCoverageLine prompts={prompts} coverage={coverage} scope={scope} pageId={pageId} />
      </div>
      {end ? <div className="pr-strip-end">{end}</div> : null}
    </section>
  )
}

function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = trimmed.search(/[.!?](\s|$)/)
  return end > 0 && end < 220 ? trimmed.slice(0, end + 1) : trimmed.slice(0, 220)
}
