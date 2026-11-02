import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { DomainText, SectionHead } from '../../ui'
import { Icon } from '../../components/Icon'
import type { SaveState } from '../types'

/** One settings card with an `h2` the in-page nav points at (focusable, for deep links). */
export function Section({
  id,
  title,
  intro,
  action,
  children
}: {
  id: string
  title: string
  intro?: ReactNode
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.querySelector(`[id="${id}-h"]`)?.setAttribute('tabindex', '-1')
  }, [id])
  return (
    <section ref={ref} className="card ps-sec" id={id} aria-labelledby={`${id}-h`}>
      <SectionHead id={`${id}-h`} title={title} description={intro} actions={action} />
      {children}
    </section>
  )
}

/** Save outcome line. Errors are alerts; the rest are polite status updates. */
export function SaveStatus({ state }: { state: SaveState }): JSX.Element {
  if (state.kind === 'error') {
    return (
      <p className="field-error" role="alert">
        {state.text}
      </p>
    )
  }
  return (
    <p className="hint ps-status" role="status">
      {state.kind === 'saving' ? 'Saving…' : state.kind === 'saved' ? state.text : ''}
    </p>
  )
}

/** Removable chips for brand names and competitors. */
export function ChipList({
  labelledBy,
  items,
  emptyText,
  onRemove,
  onOpen,
  openLabel,
  domains = false
}: {
  labelledBy: string
  items: readonly string[]
  emptyText: string
  onRemove: (item: string) => void
  /** Makes each chip's text a button that opens its detail (a drill drawer). */
  onOpen?: (item: string) => void
  openLabel?: (item: string) => string
  /** Each chip is a domain: the site icon in front, Copy and Open at the end (UrlText). */
  domains?: boolean
}): JSX.Element {
  return (
    <div className="fchips" role="group" aria-labelledby={labelledBy}>
      {items.length === 0 ? <span className="hint">{emptyText}</span> : null}
      {items.map((item) => {
        const text = onOpen ? (
          <button
            type="button"
            className="drill-num"
            aria-label={openLabel ? openLabel(item) : item}
            onClick={() => onOpen(item)}
          >
            {item}
          </button>
        ) : (
          item
        )
        return (
          <span className={domains ? 'fchip fchip-domain' : 'fchip'} key={item}>
            {domains ? (
              onOpen ? (
                <DomainText domain={item}>{text}</DomainText>
              ) : (
                <DomainText domain={item} />
              )
            ) : (
              text
            )}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onRemove(item)}>
              <Icon name="x" />
            </button>
          </span>
        )
      })}
    </div>
  )
}
