import { useEffect, useState, type JSX } from 'react'
import type { ContentDiff, DiffLine } from '@shared/domain'
import { useAiContext } from '../assistant/context/useAiContext'
import { formatMoment } from '../utils/dates'
import type { CompareSource } from './client'
import { changeCount, collapseDiff, foldText } from './model'
import { errorText } from '../components/errorText'
import { Drawer, DrawerFacts, DrawerGrid, DrawerSection } from '../ui'

export interface CompareTarget {
  fromSnapshotId: string
  toSnapshotId: string
}

/**
 * "Compare content" (FR-15.1): a readable diff of two page reads, in the shared
 * Drawer (`?drawer=compare&read-from=<snapshot>&read-to=<snapshot>`).
 */
export function CompareDialog({
  source,
  projectId,
  pageId,
  target,
  onClose
}: {
  source: CompareSource
  projectId: string
  pageId: string
  target: CompareTarget
  onClose: () => void
}): JSX.Element {
  const [diff, setDiff] = useState<ContentDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changes = diff === null ? 0 : changeCount(diff)
  useAiContext({
    screen: 'drawer.compare',
    screenLabel: 'Compare content',
    pageId,
    facts: diff
      ? [`Page read ${formatMoment(diff.from.fetchedAt)} → ${formatMoment(diff.to.fetchedAt)}`]
      : [],
    numbers: diff ? [{ label: 'Changes', value: String(changes) }] : []
  })

  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => source['history:compare']({ projectId, pageId, ...target }))
      .then(
        (next) => {
          if (!cancelled) setDiff(next)
        },
        (cause: unknown) => {
          if (!cancelled) {
            setError(errorText(cause, 'Could not compare the content.'))
          }
        }
      )
    return () => {
      cancelled = true
    }
  }, [source, projectId, pageId, target])

  return (
    <Drawer
      id="compare"
      title="Compare content"
      subtitle={
        diff
          ? `What changed: ${formatMoment(diff.from.fetchedAt)} → ${formatMoment(diff.to.fetchedAt)}`
          : 'Two reads of this page, side by side.'
      }
      testId="compare-drawer"
      loading={diff === null && error === null}
      error={error ? { message: error } : undefined}
      onClose={onClose}
      footer={{
        summary: diff ? (
          <>
            <strong>
              {formatMoment(diff.from.fetchedAt)} → {formatMoment(diff.to.fetchedAt)}
            </strong>
            {` · ${changes} ${changes === 1 ? 'change' : 'changes'}`}
          </>
        ) : null
      }}
    >
      {diff ? <DiffBody diff={diff} /> : null}
    </Drawer>
  )
}

/** The diff of two page reads. Also Check history's Compare drawer, "Page content" tab. */
export function DiffBody({ diff }: { diff: ContentDiff }): JSX.Element {
  return (
    <DrawerGrid>
      <DrawerSection title="Summary" span={12}>
        <p className="hist-cmp-summary">{diff.summary}</p>
        <DrawerFacts
          label="Size of the two reads"
          items={[
            {
              label: 'Words',
              value: (
                <span className="num">
                  {diff.from.wordCount.toLocaleString('en-US')} →{' '}
                  {diff.to.wordCount.toLocaleString('en-US')}
                </span>
              )
            },
            {
              label: 'FAQs',
              value: (
                <span className="num">
                  {diff.from.faqCount} → {diff.to.faqCount}
                </span>
              )
            }
          ]}
        />
      </DrawerSection>
      <DrawerSection
        title="Title, meta description and H1"
        description="What Google reads first, before and after."
        span={12}
      >
        <dl
          className="hist-fields"
          aria-label="Before and after for the title, meta description and H1"
        >
          {diff.fields.map((field) => (
            <div key={field.field} className="hist-field">
              <dt>
                {field.label}
                <span className={field.changed ? 'hist-tag-changed' : 'faint'}>
                  {field.changed ? ' · Changed' : ' · Same'}
                </span>
              </dt>
              <dd>
                <span className="hist-field-side">Before</span>
                {field.before ?? '—'}
              </dd>
              <dd>
                <span className="hist-field-side">After</span>
                {field.after ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      </DrawerSection>
      <DiffSection title="Outline" lines={diff.outline} span={6} />
      <DiffSection title="FAQs" lines={diff.faqs} span={6} />
      <DiffSection title="Body text" lines={diff.body} span={12} />
      {diff.bodyTruncated ? (
        <p className="faint hist-cmp-note">The body is long, so only its first part is compared.</p>
      ) : null}
    </DrawerGrid>
  )
}

function DiffSection({
  title,
  lines,
  span
}: {
  title: string
  lines: readonly DiffLine[]
  span: 6 | 12
}): JSX.Element {
  const items = collapseDiff(lines)
  const changes = lines.filter((line) => line.op !== 'same').length
  return (
    <DrawerSection
      title={title}
      span={span}
      description={
        changes === 0 ? 'No changes' : `${changes} ${changes === 1 ? 'change' : 'changes'}`
      }
    >
      {items.length === 0 ? (
        <p className="faint">Nothing on either read.</p>
      ) : (
        <ul className="hist-diff">
          {items.map((item, index) =>
            item.kind === 'fold' ? (
              <li key={index} className="hist-diff-fold">
                {foldText(item.count)}
              </li>
            ) : (
              <li key={index} className={`hist-diff-${item.line.op}`}>
                <span aria-hidden="true" className="hist-diff-sign">
                  {item.line.op === 'added' ? '+' : item.line.op === 'removed' ? '−' : ' '}
                </span>
                {item.line.op === 'same' ? null : (
                  <span className="sr-only">
                    {item.line.op === 'added' ? 'Added: ' : 'Removed: '}
                  </span>
                )}
                <span className="hist-diff-text">{item.line.text}</span>
              </li>
            )
          )}
        </ul>
      )}
    </DrawerSection>
  )
}
