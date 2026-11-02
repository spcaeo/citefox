import { useState, type JSX } from 'react'
import { FAQ_DRAFT_MAX_WORDS, FAQ_DRAFT_MIN_WORDS } from '@shared/domain'
import type { GapStatus } from '@shared/ipc'
import {
  Chip,
  Drawer,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  SegmentedControl
} from '../../ui'
import type { GapListRow } from '../model'
import { brandsNamed, draftWords } from './jsonLd'
import { GAP_STATUS_HINT, GAP_STATUS_LABEL, GAP_STATUS_TONE, readSectionUrl } from './status'

export interface GapDraftSave {
  /** Null: leave the draft as it is. `reset`: back to Claude's draft. */
  draft: { question: string; answer: string } | 'reset' | null
  /** Null: leave the status as it is. */
  status: { status: GapStatus; publishedUrl: string | null } | null
}

export interface GapDraftDrawerProps {
  row: GapListRow
  /** The project's brand names, for the "names your brand" line. */
  brands: readonly string[]
  onClose: () => void
  onSave: (change: GapDraftSave) => Promise<void>
}

/**
 * Edit one content gap's FAQ draft (`?drawer=gap-draft&gap=<row id>`): the
 * question and answer with the 40–70 word band, a brand line, Claude's
 * original kept in the rail with "Reset to Claude's draft", and where the gap
 * stands (open, published at a section URL, verified).
 */
export function GapDraftDrawer({ row, brands, onClose, onSave }: GapDraftDrawerProps): JSX.Element {
  const start = row.suggestedFaq
  const [question, setQuestion] = useState(start?.question ?? '')
  const [answer, setAnswer] = useState(start?.answer ?? '')
  const [status, setStatus] = useState<GapStatus>(row.status)
  const [urlText, setUrlText] = useState(row.publishedUrl ?? '')
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const words = draftWords(answer)
  const draftChanged =
    question.trim() !== (start?.question ?? '').trim() ||
    answer.trim() !== (start?.answer ?? '').trim()
  const url = readSectionUrl(urlText)
  const statusChanged =
    status !== row.status || (status !== 'open' && url.url !== (row.publishedUrl ?? null))
  const dirty = draftChanged || statusChanged
  const questionError = tried && draftChanged && !question.trim() ? 'Write the question.' : null
  const answerError = tried && draftChanged && !answer.trim() ? 'Write the answer.' : null
  const named = brandsNamed(`${question} ${answer}`, brands)
  const band =
    words === 0
      ? `Aim for ${FAQ_DRAFT_MIN_WORDS}–${FAQ_DRAFT_MAX_WORDS} words.`
      : words < FAQ_DRAFT_MIN_WORDS
        ? `${FAQ_DRAFT_MIN_WORDS - words} short of the ${FAQ_DRAFT_MIN_WORDS}–${FAQ_DRAFT_MAX_WORDS} words AI answers quote best.`
        : words > FAQ_DRAFT_MAX_WORDS
          ? `${words - FAQ_DRAFT_MAX_WORDS} over the ${FAQ_DRAFT_MIN_WORDS}–${FAQ_DRAFT_MAX_WORDS} words AI answers quote best.`
          : `In the ${FAQ_DRAFT_MIN_WORDS}–${FAQ_DRAFT_MAX_WORDS} word band.`

  async function save(): Promise<void> {
    setTried(true)
    if (draftChanged && (!question.trim() || !answer.trim())) return
    if (status !== 'open' && url.error) return
    setSaving('save')
    setError(null)
    try {
      await onSave({
        draft: draftChanged ? { question: question.trim(), answer: answer.trim() } : null,
        status: statusChanged ? { status, publishedUrl: status === 'open' ? null : url.url } : null
      })
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not save.')
      setSaving(null)
    }
  }

  async function reset(): Promise<void> {
    setSaving('reset')
    setError(null)
    try {
      await onSave({ draft: 'reset', status: null })
    } catch (cause: unknown) {
      setError(cause instanceof Error && cause.message ? cause.message : 'Could not reset.')
      setSaving(null)
    }
  }

  const summary = error ? (
    <span className="gp-drawer-error" role="alert">
      {error}
    </span>
  ) : row.faqEdited ? (
    'Your draft · CiteFox AI’s draft is kept in case you want it back'
  ) : (
    'CiteFox AI’s draft · your changes are kept when the gaps are written again'
  )

  return (
    <Drawer
      id="gap-draft"
      title="Edit FAQ draft"
      heading={`Edit FAQ draft · question ${row.position}`}
      subtitle={row.text ? `“${row.text}”` : row.label}
      testId="gap-draft-drawer"
      dirty={dirty && saving === null}
      guard={{ title: 'Discard your changes?', body: 'The draft and status stay as they were.' }}
      busy={saving !== null}
      closeDisabled={saving !== null}
      onClose={onClose}
      footer={{
        summary,
        ...(row.faqEdited && row.claudeFaq
          ? {
              secondary: {
                label: 'Reset to CiteFox AI’s draft',
                busy: saving === 'reset',
                disabled: saving !== null,
                onClick: () => void reset()
              }
            }
          : {}),
        primary: {
          label: 'Save draft',
          busy: saving === 'save',
          disabled: saving !== null || !dirty,
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="FAQ draft"
            description="The question as a buyer asks it, and a short answer that names you."
          >
            <DrawerFields>
              <DrawerField
                label="Question"
                error={questionError}
                counter={`${question.trim().length} / 300`}
              >
                {(ids) => (
                  <textarea
                    id={ids.id}
                    aria-describedby={ids.describedBy}
                    className="ui-input gp-textarea"
                    rows={2}
                    maxLength={300}
                    value={question}
                    data-autofocus
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                )}
              </DrawerField>
              <DrawerField
                label="Answer"
                hint={band}
                error={answerError}
                counter={`${words} words`}
              >
                {(ids) => (
                  <textarea
                    id={ids.id}
                    aria-describedby={ids.describedBy}
                    className="ui-input gp-textarea"
                    rows={7}
                    maxLength={2000}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                )}
              </DrawerField>
            </DrawerFields>
            <p className="gp-brand-line" data-named={named.length > 0 || undefined}>
              {brands.length === 0
                ? 'Add your brand names in Project settings to check that the answer names you.'
                : named.length > 0
                  ? `Names ${named.join(', ')}: AI answers that quote it name you too.`
                  : `Does not name ${brands[0]}. An answer that names you is quoted with your name.`}
            </p>
          </DrawerSection>
          <DrawerSection
            title="Where it stands"
            description="Mark it published once it is on the page; verified once a check cites the page."
          >
            <SegmentedControl<GapStatus>
              label="Status"
              value={status}
              onChange={setStatus}
              options={(['open', 'published', 'verified'] as const).map((value) => ({
                value,
                label: GAP_STATUS_LABEL[value]
              }))}
            />
            <p className="ui-drawer-hint">{GAP_STATUS_HINT[status]}</p>
            {status !== 'open' ? (
              <DrawerFields>
                <DrawerField
                  label="Section URL (optional)"
                  hint="Where the answer is live, such as the FAQ anchor on the page."
                  error={url.error}
                >
                  {(ids) => (
                    <input
                      id={ids.id}
                      aria-describedby={ids.describedBy}
                      className="ui-input"
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/pricing#faq"
                      value={urlText}
                      onChange={(event) => setUrlText(event.target.value)}
                    />
                  )}
                </DrawerField>
              </DrawerFields>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this gap">
          <DrawerSection title="This gap">
            <dl className="gp-rail-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <Chip tone={GAP_STATUS_TONE[row.status]} size="sm">
                    {GAP_STATUS_LABEL[row.status]}
                  </Chip>
                </dd>
              </div>
              <div>
                <dt>Main gap</dt>
                <dd>{row.mainGap || '—'}</dd>
              </div>
              <div>
                <dt>Where now</dt>
                <dd>
                  {row.whereCovered.length > 0 ? row.whereCovered.join(', ') : 'Not on the page'}
                </dd>
              </div>
            </dl>
          </DrawerSection>
          <DrawerSection
            title="CiteFox AI’s draft"
            description={
              row.faqEdited ? 'Kept as written. Reset brings it back.' : 'What you start from.'
            }
          >
            {row.claudeFaq ? (
              <blockquote className="gp-faq gp-faq-plain">
                <p className="gp-faq-q">{row.claudeFaq.question}</p>
                <p className="gp-muted">{row.claudeFaq.answer}</p>
                <p className="gp-muted num">{row.claudeFaq.wordCount} words</p>
              </blockquote>
            ) : (
              <p className="gp-muted">
                CiteFox AI did not draft an FAQ for this question. Write your own.
              </p>
            )}
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
