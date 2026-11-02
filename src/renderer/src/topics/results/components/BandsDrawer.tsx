import { useState, type JSX } from 'react'
import type { TopicBands, TopicGoal } from '@shared/domain'
import { errorText } from '../../../components/errorText'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  useResultWords,
  type ResultWords
} from '../../../ui'
import type { TopicResultsSource } from '../source'

type Field = 'qlo' | 'qhi' | 'klo' | 'khi'
type Values = Record<Field, string>

function valuesOf(bands: TopicBands): Values {
  return {
    qlo: String(bands.questions.lo),
    qhi: String(bands.questions.hi),
    klo: String(bands.keywords.lo),
    khi: String(bands.keywords.hi)
  }
}

/** Why a band cannot be saved, or null. */
function bandProblem(lo: string, hi: string): string | null {
  const low = Number(lo)
  const high = Number(hi)
  if (lo.trim() === '' || hi.trim() === '') return 'Fill in both edges.'
  if (!Number.isInteger(low) || !Number.isInteger(high)) return 'Use whole numbers.'
  if (low < 0 || high > 100) return 'Use numbers from 0 to 100.'
  if (low > high) return 'The low edge comes first.'
  return null
}

/** "42% cited" of the prompts that showed an overview, or why there is no share yet. */
function shareText(goal: TopicGoal, words: ResultWords): string {
  if (goal.prompts === 0) return 'None in this topic'
  if (goal.withAio === 0) return words.noneYet
  return `${Math.round((goal.cited / goal.withAio) * 100)}% cited`
}

/**
 * Target bands (`drawer=topic-bands` over a topic's results): the goal band for
 * buyer questions and for keywords, saved with `topics:update`. The rail shows
 * where the topic is now. Unsaved changes ask before the drawer closes.
 */
export function BandsDrawer({
  projectId,
  topicId,
  bands,
  goals,
  source,
  onClose,
  onSaved
}: {
  projectId: string
  topicId: string
  bands: TopicBands
  goals: { questions: TopicGoal; keywords: TopicGoal }
  source: TopicResultsSource
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const words = useResultWords()
  const [saved] = useState<Values>(() => valuesOf(bands))
  const [values, setValues] = useState<Values>(saved)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = (Object.keys(values) as Field[]).some((field) => values[field] !== saved[field])
  const questionsProblem = bandProblem(values.qlo, values.qhi)
  const keywordsProblem = bandProblem(values.klo, values.khi)

  async function save(): Promise<void> {
    if (questionsProblem !== null || keywordsProblem !== null) return
    setSaving(true)
    setError(null)
    try {
      await source.update({
        projectId,
        topicId,
        bands: {
          questions: { lo: Number(values.qlo), hi: Number(values.qhi) },
          keywords: { lo: Number(values.klo), hi: Number(values.khi) }
        }
      })
      onSaved()
      onClose()
    } catch (cause) {
      setError(errorText(cause, 'Could not save the bands.'))
      setSaving(false)
    }
  }

  const input = (field: Field, label: string): JSX.Element => (
    <DrawerField label={label}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          className="ui-input num"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          value={values[field]}
          onChange={(event) =>
            setValues((current) => ({ ...current, [field]: event.target.value }))
          }
        />
      )}
    </DrawerField>
  )

  return (
    <Drawer
      id="topic-bands"
      title="Target bands"
      subtitle={`The goal is cited ÷ questions ${words.withAnswer}. “To reach the band” counts up to the low edge.`}
      dirty={dirty}
      busy={saving}
      closeDisabled={saving}
      onClose={onClose}
      testId="bands-drawer"
      footer={{
        summary: error ? (
          <span className="ui-drawer-error" role="alert">
            {error}
          </span>
        ) : dirty ? (
          'Saving changes no check · the to-do regroups against the new band.'
        ) : (
          'No changes yet.'
        ),
        primary: {
          label: 'Save bands',
          busy: saving,
          disabled: !dirty || questionsProblem !== null || keywordsProblem !== null,
          onClick: () => void save()
        }
      }}
    >
      <DrawerGrid className="tr-bands">
        <DrawerMain>
          <DrawerSection title="Buyer questions" description="Share of buyer questions cited, %.">
            <DrawerFields columns={2}>
              {input('qlo', 'Low edge')}
              {input('qhi', 'High edge')}
            </DrawerFields>
            {questionsProblem ? (
              <p className="ui-drawer-error" role="alert">
                {questionsProblem}
              </p>
            ) : null}
          </DrawerSection>
          <DrawerSection title="Keywords" description="Share of short keyword searches cited, %.">
            <DrawerFields columns={2}>
              {input('klo', 'Low edge')}
              {input('khi', 'High edge')}
            </DrawerFields>
            {keywordsProblem ? (
              <p className="ui-drawer-error" role="alert">
                {keywordsProblem}
              </p>
            ) : null}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="Where you are">
          <DrawerSection title="Where you are" description="From the latest check.">
            <DrawerFacts
              label="Where you are"
              items={[
                {
                  label: 'Buyer questions',
                  value: <span className="num">{shareText(goals.questions, words)}</span>,
                  hint: `band ${values.qlo}–${values.qhi}%`
                },
                {
                  label: 'Keywords',
                  value: <span className="num">{shareText(goals.keywords, words)}</span>,
                  hint: `band ${values.klo}–${values.khi}%`
                }
              ]}
            />
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}
