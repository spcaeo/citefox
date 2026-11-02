import { useEffect, useMemo, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { AiSlotContext, type AiSlot } from '../../ui/aiSlot'
import { currentAiContext } from '../context/store'
import { useAiContext, useAiEnabled } from '../context/useAiContext'
import { openAsk } from '../openAsk'
import { AskSparkle } from './AskSparkle'

/**
 * Fills the shared components' ✦ slots (ui/aiSlot): every KPI tile tells the
 * assistant its number and offers questions about it, every section head
 * without an AI menu gets one ✦ menu, and every section AI menu ends with
 * "Ask CiteFox about {section}…". One provider in the shell; no screen edits.
 */
export function AiSlotProvider({ children }: { children: ReactNode }): JSX.Element {
  const enabled = useAiEnabled()
  const slot = useMemo<AiSlot>(
    () => ({
      Kpi: KpiSparkle,
      section: ({ title }) => <AskSparkle target={{ kind: 'section', label: title }} />,
      menuItem: (title) =>
        enabled
          ? {
              id: 'ask-citefox',
              label: title ? `Ask CiteFox about ${title}…` : 'Ask CiteFox about this…',
              icon: 'sparkle',
              tone: 'ai',
              onSelect: () =>
                openAsk({
                  about: { kind: 'section', label: title ?? currentAiContext().screenLabel }
                })
            }
          : null
    }),
    [enabled]
  )
  return <AiSlotContext.Provider value={slot}>{children}</AiSlotContext.Provider>
}

/** A KPI tile's ✦: registers the drawn number with the assistant and offers questions about it. */
function KpiSparkle({
  label,
  valueRef,
  trend,
  goal
}: {
  label: string
  valueRef: RefObject<HTMLElement | null>
  trend: string | null
  goal: boolean
}): JSX.Element {
  const [shown, setShown] = useState<{ value: string; drill: string | null }>({
    value: '',
    drill: null
  })
  // The number is drawn by the tile (often a DrillNumber): read what it shows
  // and opens, now and whenever it is redrawn. A passive effect, not a layout
  // one: this ✦ sits before the number in the tile, so during the layout pass
  // the number's ref is not attached yet and the value would never be read.
  useEffect(() => {
    const node = valueRef.current
    if (!node) return
    const read = (): void => {
      const copy = node.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.sr-only').forEach((item) => item.remove())
      const value = (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
      const drill = node.querySelector('[data-nfr-drill]')?.getAttribute('data-nfr-drill') ?? null
      setShown((before) =>
        before.value === value && before.drill === drill ? before : { value, drill }
      )
    }
    read()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(read)
    observer.observe(node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    })
    return () => observer.disconnect()
  }, [valueRef])
  const { value, drill } = shown
  useAiContext(value ? { numbers: [{ label, value, drill }] } : {})
  return (
    <AskSparkle
      size="xs"
      target={{
        kind: 'kpi',
        label,
        ...(value ? { detail: value } : {}),
        ...(trend ? { trend } : {}),
        ...(goal ? { goal: true } : {})
      }}
    />
  )
}
