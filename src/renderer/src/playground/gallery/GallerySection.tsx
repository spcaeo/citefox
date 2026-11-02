import type { JSX, ReactNode } from 'react'

/** One board section: a 3-column intro on the left, the specimens on the right (Theme.dc.html). */
export function GallerySection({
  id,
  title,
  intro,
  children
}: {
  id: string
  title: string
  intro: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="gl-section" aria-labelledby={`gl-${id}`}>
      <div className="gl-intro">
        <h2 id={`gl-${id}`}>{title}</h2>
        <p>{intro}</p>
      </div>
      <div className="gl-body">{children}</div>
    </section>
  )
}

/** A white specimen card with a small heading. */
export function Specimen({
  title,
  span = 12,
  children,
  inset = false
}: {
  title?: string
  /** Columns of the 12-column body. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 12
  children: ReactNode
  inset?: boolean
}): JSX.Element {
  return (
    <div className={`gl-card gl-span-${span}${inset ? ' gl-card-inset' : ''}`}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </div>
  )
}
