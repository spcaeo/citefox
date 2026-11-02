import type { JSX } from 'react'
import { MenuButton, type MenuItem } from '../../ui/Menu'
import { UiIcon } from '../../ui/UiIcon'
import { currentAiContext } from '../context/store'
import { useAiEnabled } from '../context/useAiContext'
import { openAsk } from '../openAsk'
import { sparkleHeading, sparkleQuestions, type SparkleTarget } from './questions'
import './sparkle.css'

/**
 * The ✦ on a KPI tile, a row, a chart or a section head (deep audit crosscut
 * §3.7, Assistant.dc.html). It shows on hover or focus of the thing it sits
 * in (always on touch screens) and opens a short menu of the questions people
 * ask about that thing. Picking one opens Ask CiteFox with the question and
 * the thing in context. Draws nothing outside the app shell or with no
 * project open.
 */
export function AskSparkle({
  target,
  questions,
  size = 'sm',
  className
}: {
  target: SparkleTarget
  /** Replaces the built-in questions for this kind of thing. */
  questions?: readonly string[]
  size?: 'sm' | 'xs'
  className?: string
}): JSX.Element | null {
  const enabled = useAiEnabled()
  if (!enabled) return null
  const label = `Ask CiteFox about ${shortLabel(target.label)}`
  const lines = questions ?? sparkleQuestions(target, currentAiContext())
  const items: MenuItem[] = lines.map((question, index) => ({
    id: `q${index}`,
    label: question,
    onSelect: () => openAsk({ question, about: plain(target), send: true })
  }))
  items.push({
    id: 'own',
    label: 'Ask something else…',
    icon: 'sparkle',
    tone: 'ai',
    groupStart: true,
    onSelect: () => openAsk({ about: plain(target) })
  })
  return (
    <MenuButton
      label={label}
      items={items}
      width={300}
      header={<span className="ai-spark-head">{sparkleHeading(target)}</span>}
      footer={<span className="ai-spark-foot">Answers from your stored checks · no searches</span>}
      trigger={(props, open) => (
        <button
          {...props}
          type="button"
          aria-label={label}
          title={label}
          data-ai-sparkle={target.kind}
          className={[
            'ai-spark',
            size === 'xs' ? 'ai-spark-xs' : '',
            open ? 'ai-spark-on' : '',
            className ?? ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <UiIcon name="sparkle" size={size === 'xs' ? 12 : 14} />
        </button>
      )}
    />
  )
}

function plain(target: SparkleTarget): SparkleTarget {
  return {
    kind: target.kind,
    ...(target.id ? { id: target.id } : {}),
    label: target.label,
    ...(target.detail ? { detail: target.detail } : {}),
    ...(target.trend ? { trend: target.trend } : {}),
    ...(target.goal ? { goal: true } : {})
  }
}

function shortLabel(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat
}
