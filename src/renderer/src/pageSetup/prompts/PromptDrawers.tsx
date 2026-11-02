import { useEffect, useState, type JSX } from 'react'
import type { BuyerPrompt } from '@shared/domain'
import type { AssistClient } from '../../assist/client'
import { TemplatePickerField } from '../../generate/TemplatePicker'
import { wordCount } from '../../promptDetail/edit/model'
import type { TemplatesClient } from '../../templates/client'
import {
  Drawer,
  DrawerFacts,
  DrawerField,
  DrawerFields,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  ExpertOptions,
  SuggestionCard,
  useAiSuggestion
} from '../../ui'
import { sourceLabel, stageLabel } from '../labels'

type Undo = () => Promise<void>

function words(text: string): string {
  const count = wordCount(text)
  return `${count} ${count === 1 ? 'word' : 'words'}`
}

/**
 * "Edit wording" from a row's ⋯ menu (`?drawer=pt-edit&pt.edit=<prompt id>`,
 * titled "Edit question"), or "Add my own" (`?drawer=pt-add`). The change goes
 * into the draft; saving the set later writes the next version.
 */
export function PromptEditDrawer({
  prompt,
  initialText,
  nextVersion,
  error,
  onSave,
  onClose
}: {
  /** Null adds a new prompt. */
  prompt: BuyerPrompt | null
  initialText: string
  /** The version Save on the tab writes ("v3"); null before the first set. */
  nextVersion: number | null
  /** Why the last save failed, from the tab's data. */
  error: string | null
  onSave: (text: string) => Promise<boolean>
  onClose: () => void
}): JSX.Element {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const adding = prompt === null
  const changed = text.trim() !== initialText.trim()
  const empty = text.trim().length === 0

  function save(): void {
    if (empty || !changed || busy) return
    setBusy(true)
    setTried(true)
    void onSave(text.trim()).then((ok) => {
      setBusy(false)
      if (ok) onClose()
    })
  }

  return (
    <Drawer
      id={adding ? 'pt-add' : 'pt-edit'}
      title={adding ? 'Add my own question' : 'Edit question'}
      subtitle={`${adding ? 'A question of your own' : `Buyer question ${prompt.position}`} · it joins the draft until you save the set${nextVersion === null ? '' : ` as v${nextVersion}`}`}
      dirty={changed}
      busy={busy}
      closeDisabled={busy}
      onClose={onClose}
      testId="prompt-edit-drawer"
      footer={{
        summary: changed
          ? `${adding ? 'Adds 1 question' : 'Changes 1 question'} in the draft · nothing is searched`
          : 'No changes yet · nothing is searched',
        primary: {
          label: adding ? 'Add question' : 'Save wording',
          busy,
          disabled: empty || !changed,
          onClick: save
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection
            title="Wording"
            description="A real situation in the buyer’s words, without your brand."
            error={tried && !busy && error ? error : null}
          >
            <DrawerFields>
              <DrawerField
                label="Question, as a buyer would type it"
                counter={words(text)}
                hint="Write it as someone who has not found you yet would ask Google."
              >
                {({ id, describedBy }) => (
                  <textarea
                    id={id}
                    aria-describedby={describedBy}
                    className="ui-input pr-textarea"
                    rows={5}
                    data-autofocus
                    value={text}
                    disabled={busy}
                    onChange={(event) => setText(event.currentTarget.value)}
                  />
                )}
              </DrawerField>
            </DrawerFields>
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this question">
          {prompt ? (
            <DrawerSection title="Facts">
              <div className="pr-facts">
                <DrawerFacts
                  label="About this question"
                  items={[
                    { label: 'Number', value: <span className="num">{prompt.position}</span> },
                    { label: 'Stage', value: stageLabel(prompt.intentStage) },
                    { label: 'Source', value: sourceLabel(prompt.source) },
                    { label: 'Checks', value: prompt.enabled ? 'Included' : 'Left out' }
                  ]}
                />
              </div>
            </DrawerSection>
          ) : null}
          <DrawerSection title="What saving does">
            <p className="pr-hint">
              The change waits in the draft. Saving the set creates
              {nextVersion === null ? ' a new version' : ` question set v${nextVersion}`}, so
              before/after comparisons stay fair.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/**
 * "Rephrase like a buyer" from a row's ⋯ menu (`?drawer=pt-rephrase`): Claude
 * suggests wordings for that prompt (no searches); nothing changes until
 * "Use this wording", and Undo puts it back.
 */
export function RephraseDrawer({
  prompt,
  text,
  projectId,
  pageId,
  marketId,
  client,
  onApply,
  onClose
}: {
  prompt: BuyerPrompt
  /** The wording shown in the tab's market and language. */
  text: string
  projectId: string
  pageId: string
  marketId: string
  client?: AssistClient
  onApply: (text: string) => Promise<Undo>
  onClose: () => void
}): JSX.Element {
  const suggestion = useAiSuggestion(
    {
      assistId: 'prompts.rephrase',
      projectId,
      pageId,
      marketId,
      promptId: prompt.id,
      inputs: { promptId: prompt.id },
      ...(client ? { client } : {})
    },
    'Rephrase like a buyer'
  )
  const [undo, setUndo] = useState<Undo | null>(null)
  const { run } = suggestion.assist
  useEffect(() => {
    run()
  }, [run])
  const items = suggestion.assist.result?.items ?? []
  return (
    <Drawer
      id="pt-rephrase"
      title={`Rephrase question ${prompt.position}`}
      subtitle="CiteFox AI suggests wordings · no searches · nothing changes until you use one"
      onClose={onClose}
      testId="prompt-rephrase-drawer"
      footer={{
        summary: undo
          ? 'The new wording is in the draft · Undo puts the old one back'
          : 'Runs on your AI plan · no searches'
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="Wording now">
            <p className="pr-quote">{text}</p>
          </DrawerSection>
          <DrawerSection title="Suggestions" tone="plain">
            <SuggestionCard
              {...suggestion.card}
              title="Rephrase like a buyer"
              applyLabel="Use this wording"
              onApply={(ids) => {
                const chosen = items.find((item) => item.id === ids[0]) ?? items[0]
                if (!chosen) return
                void onApply(chosen.text).then((next) => setUndo(() => next))
              }}
              {...(undo
                ? {
                    onUndo: () => {
                      void undo().then(() => setUndo(null))
                    }
                  }
                : {})}
              onClose={onClose}
            />
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About rephrasing">
          <DrawerSection title="Facts">
            <div className="pr-facts">
              <DrawerFacts
                label="About this question"
                items={[
                  { label: 'Number', value: <span className="num">{prompt.position}</span> },
                  { label: 'Stage', value: stageLabel(prompt.intentStage) },
                  { label: 'Checks', value: prompt.enabled ? 'Included' : 'Left out' }
                ]}
              />
            </div>
          </DrawerSection>
          <DrawerSection title="What using one does">
            <p className="pr-hint">
              The wording goes into the draft. Saving the set later creates a new version.
            </p>
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/**
 * Prompt settings (`?drawer=pt-settings`): how many prompts Claude writes for
 * this page, and Write the prompts again with a template (Expert options).
 * Off the main surface: they matter only when the prompts are written again.
 */
export function PromptSettingsDrawer({
  templatesClient,
  promptCount,
  setHas,
  onSaveCount,
  onRegenerate,
  onClose
}: {
  templatesClient: TemplatesClient
  promptCount: number
  setHas: number
  onSaveCount: (text: string) => Promise<string | null>
  onRegenerate: (templateId: string) => Promise<boolean>
  onClose: () => void
}): JSX.Element {
  const [saved, setSaved] = useState(String(promptCount))
  const [count, setCount] = useState(String(promptCount))
  const [countError, setCountError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [savingCount, setSavingCount] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [writing, setWriting] = useState(false)
  const dirty = count.trim() !== saved.trim()

  function saveCount(): void {
    if (!dirty || savingCount) return
    setSavingCount(true)
    void onSaveCount(count).then((problem) => {
      setSavingCount(false)
      setCountError(problem)
      setJustSaved(problem === null)
      if (problem === null) setSaved(count)
    })
  }

  return (
    <Drawer
      id="pt-settings"
      title="Question settings"
      subtitle="This page · used the next time CiteFox AI writes the questions"
      dirty={dirty}
      busy={savingCount || writing}
      closeDisabled={writing}
      onClose={onClose}
      testId="prompt-settings-drawer"
      status={justSaved && !dirty ? 'Saved' : undefined}
      footer={{
        summary: 'Write again replaces the draft · about 30 s on your AI plan · no searches',
        secondary: {
          label: 'Write the questions again',
          icon: 'refresh',
          busy: writing,
          disabled: savingCount,
          onClick: () => {
            setWriting(true)
            void onRegenerate(templateId).then((ok) => {
              setWriting(false)
              if (ok) onClose()
            })
          }
        },
        primary: {
          label: 'Save count',
          busy: savingCount,
          disabled: !dirty || writing,
          onClick: saveCount
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection title="Question count" span={6}>
          <DrawerFields>
            <DrawerField
              label="Buyer questions to write"
              hint={`The set has ${setHas} ${setHas === 1 ? 'question' : 'questions'}. A whole number from 1 to 1,000.`}
              error={countError}
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  className="ui-input num"
                  inputMode="numeric"
                  value={count}
                  aria-invalid={countError ? true : undefined}
                  data-autofocus
                  onChange={(event) => {
                    setCount(event.currentTarget.value)
                    setJustSaved(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveCount()
                  }}
                />
              )}
            </DrawerField>
          </DrawerFields>
        </DrawerSection>
        <DrawerSection
          title="Write the questions again"
          span={6}
          description="A fresh set from the buyer profile replaces the draft."
        />
        <ExpertOptions summary="Template: the page's default unless you pick one">
          <TemplatePickerField
            client={templatesClient}
            kind="buyer_prompts"
            value={templateId}
            onChange={setTemplateId}
          />
        </ExpertOptions>
      </DrawerGrid>
    </Drawer>
  )
}
