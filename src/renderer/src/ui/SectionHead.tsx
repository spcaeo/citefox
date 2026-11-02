import type { JSX, ReactNode } from 'react'
import { AiSectionTitleContext, useAiSlot } from './aiSlot'

export interface SectionHeadProps {
  /** The section's name, such as "Who gets cited". Not the name of the tab it sits in. */
  title: string
  /** A count after the title, as a small pill: "Pages 12". */
  count?: number | string
  /** One helper line under the title. */
  description?: ReactNode
  /** Right-aligned actions, such as one secondary Button. */
  actions?: ReactNode
  /** The section's one AI menu (`<AiMenu …/>`), at the far right after the actions. */
  ai?: ReactNode
  /** Heading level. Default 2. */
  level?: 2 | 3 | 4
  /** Id of the heading, for a section's `aria-labelledby`. */
  id?: string
  className?: string
}

/**
 * The header of a section inside a screen (Theme.dc.html section heads): the
 * title at 16/24 semibold with an optional count, an optional helper line,
 * and the actions and the one AI menu on the right, all on one 32px row.
 */
export function SectionHead({
  title,
  count,
  description,
  actions,
  ai,
  level = 2,
  id,
  className
}: SectionHeadProps): JSX.Element {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4'
  // One AI menu per section: the section's own, else the shell's ✦ questions about it.
  const slot = useAiSlot()
  const menu = ai ? (
    <AiSectionTitleContext.Provider value={title}>{ai}</AiSectionTitleContext.Provider>
  ) : (
    (slot?.section?.({ title }) ?? null)
  )
  return (
    <div className={className ? `ui-sechead ${className}` : 'ui-sechead'}>
      <div className="ui-sechead-text">
        <Heading className="ui-sechead-title" id={id}>
          {title}
          {count !== undefined ? <span className="ui-sechead-count num">{count}</span> : null}
        </Heading>
        {description ? <p className="ui-sechead-desc">{description}</p> : null}
      </div>
      {actions || menu ? (
        <div className="ui-sechead-actions">
          {actions}
          {menu}
        </div>
      ) : null}
    </div>
  )
}
