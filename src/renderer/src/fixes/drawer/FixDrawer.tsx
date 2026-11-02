import { useMemo, useState, type JSX } from 'react'
import { fixKindLabel, type Market } from '@shared/domain'
import type { ProjectFix, QuestionTarget } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { Markdown } from '../../components/Markdown'
import { FixVerdict } from '../../progress/FixDrills'
import {
  cleanError,
  followUpPhrase,
  outcomeFor,
  resultLabel,
  ruleOption
} from '../../progress/model'
import { notifyChanged } from '../../shell/changes'
import type { DrawerEntry } from '../../shell/drawerUrl'
import { closeDrawer, setDrawerParams } from '../../shell/drawers'
import { marketLabel } from '../../shell/model'
import { runningHash } from '../../shell/routes'
import {
  Confirm,
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  UrlText,
  showUndo,
  type HelpFillSource
} from '../../ui'
import { formatWhen } from '../../utils/dates'
import { costLine, fixStage, stageLabel, targetedQuestions } from '../model'
import { changeRowHash } from '../views'
import { FixFormBody } from './FixFormBody'
import { fixParamsFrom } from './model'
import { createFixDrawerSource, type FixDrawerSource } from './source'
import { useFixDrawerData } from './useFixDrawerData'
import './fix-drawer.css'

/**
 * The `fix` drawer (window-wide). `fix=new` logs a fix (prefilled from `fix.page`,
 * `fix.prompts`, `fix.from`); `fix=<id>` shows one with Edit (`fix.mode=edit`), Run
 * follow-up now and Delete, which acts at once and offers Undo.
 */
export function FixDrawer({
  projectId,
  entry,
  depth,
  source,
  helpSource,
  openLink,
  now
}: {
  projectId: string
  entry: DrawerEntry
  depth: number
  source?: FixDrawerSource
  /** Tests only: ✦ Help write it's channels and the browser opener. */
  helpSource?: HelpFillSource
  openLink?: (url: string) => void
  /** Tests pass a fixed clock. */
  now?: Date
}): JSX.Element {
  const client = useMemo(() => source ?? createFixDrawerSource(), [source])
  const params = fixParamsFrom(entry.params)
  const state = useFixDrawerData(client, projectId)
  const close = (result?: unknown): void => closeDrawer(depth, result)
  const data = state.data

  if (data === null) {
    return (
      <Drawer
        id="fix"
        title={params.mode === 'new' ? 'Log a fix' : 'Fix'}
        loading={state.error === null}
        error={state.error === null ? undefined : { message: state.error, onRetry: state.reload }}
        onClose={() => close()}
      />
    )
  }
  const item =
    params.fixId === null
      ? null
      : (data.list.fixes.find((row) => row.fix.id === params.fixId) ?? null)
  if (params.fixId !== null && item === null) {
    return (
      <Drawer
        id="fix"
        title="Fix"
        onClose={() => close()}
        error={{ message: 'That fix is not in this project any more, or is not available to you.' }}
      />
    )
  }
  if (item !== null && params.mode === 'view') {
    return (
      <FixView
        client={client}
        projectId={projectId}
        depth={depth}
        item={item}
        markets={data.list.markets}
        target={data.targets.targets.find((target) => target.id === item.fix.pageId)}
        onChanged={state.reload}
        onClose={close}
      />
    )
  }
  return (
    <FixFormBody
      key={item?.fix.id ?? 'new'}
      client={client}
      projectId={projectId}
      depth={depth}
      now={now ?? new Date()}
      data={data}
      fix={item?.fix ?? null}
      params={params}
      onTargets={state.reload}
      onClose={close}
      {...(helpSource ? { helpSource } : {})}
      {...(openLink ? { openLink } : {})}
    />
  )
}

function FixView({
  client,
  projectId,
  depth,
  item,
  markets,
  target,
  onChanged,
  onClose
}: {
  client: FixDrawerSource
  projectId: string
  depth: number
  item: ProjectFix
  markets: readonly Market[]
  target: QuestionTarget | undefined
  onChanged: () => void
  onClose: (result?: unknown) => void
}): JSX.Element {
  const { fix } = item
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState<'run' | 'delete' | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const outcome = outcomeFor(fix, null)
  const questions = targetedQuestions(fix)
  const marketNames = fix.marketIds.map((id) => {
    const market = markets.find((entry) => entry.id === id)
    return market ? marketLabel(market) : 'Removed market'
  })

  async function run(): Promise<void> {
    setBusy('run')
    setMessage(null)
    try {
      await client['fixes:runFollowUp']({ projectId, fixId: fix.id })
      setAsking(false)
      setMessage({ text: `The follow-up check for Fix ${fix.number} started.`, error: false })
      notifyChanged('fixes')
      onChanged()
    } catch (cause) {
      setAsking(false)
      setMessage({ text: cleanError(cause, 'Could not start the follow-up.'), error: true })
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    setBusy('delete')
    setMessage(null)
    try {
      await client['fixes:delete']({ projectId, fixId: fix.id })
      notifyChanged('fixes')
      onClose()
      showUndo({
        message: `Deleted Fix ${fix.number}.`,
        effect: fix.status === 'planned' ? 'Its planned follow-up is dropped too.' : null,
        undo: async () => {
          await client['fixes:restore']({ projectId, fixId: fix.id })
          notifyChanged('fixes')
        }
      })
    } catch (cause) {
      setMessage({ text: cleanError(cause, 'Could not delete the fix.'), error: true })
      setBusy(null)
    }
  }

  return (
    <Drawer
      id="fix"
      title={`Fix ${fix.number}`}
      subtitle={
        target ? `${target.kind === 'topic' ? 'Topic' : 'Page'} · ${target.name}` : undefined
      }
      status={stageLabel(fixStage(fix))}
      focusOnOpen="close"
      busy={busy !== null}
      closeDisabled={busy !== null}
      onClose={() => onClose()}
      footer={{
        summary: message ? (
          <span role={message.error ? 'alert' : 'status'}>
            {message.text}{' '}
            {!message.error ? <a href={runningHash(fix.pageId)}>See it run</a> : null}
          </span>
        ) : fix.status === 'planned' ? (
          `Run now: ${costLine(item).toLowerCase()}`
        ) : undefined,
        danger:
          fix.status === 'started'
            ? undefined
            : {
                label: 'Delete',
                icon: 'trash',
                busy: busy === 'delete',
                disabled: busy !== null,
                ariaLabel: `Delete Fix ${fix.number}`,
                onClick: () => void remove()
              },
        secondary:
          fix.status === 'planned'
            ? {
                label: 'Run follow-up now',
                icon: 'refresh',
                disabled: busy !== null,
                onClick: () => setAsking(true)
              }
            : undefined,
        primary: {
          label: 'Edit',
          icon: 'pencil',
          disabled: busy !== null,
          onClick: () => setDrawerParams(depth, { 'fix.mode': 'edit' }, { push: true })
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DrawerSection title="What changed">
            <div className="fxd-description">
              <Markdown baseLevel={4}>{fix.description}</Markdown>
            </div>
          </DrawerSection>
          <DrawerSection
            title="Questions it should help"
            count={questions.length > 0 ? questions.length : fix.promptIds.length}
          >
            {questions.length === 0 ? (
              <p className="muted">
                {pluralize(fix.promptIds.length, 'question')} picked. Results show after the
                follow-up check.
              </p>
            ) : (
              <ol className="fxd-questions">
                {questions.map((prompt) => (
                  <li key={prompt.promptId}>
                    <span className="fxd-num">{prompt.label || `Q${prompt.promptPosition}`}</span>
                    <span className="fxd-question-text">{prompt.text}</span>
                    {fix.status === 'completed' ? (
                      <span className="faint">{resultLabel(prompt.result)}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this fix">
          <DrawerSection title="Follow-up">
            <DrawerFacts
              label="About this fix"
              items={[
                {
                  label: target?.kind === 'topic' ? 'Topic' : 'Page',
                  value: target?.url ? (
                    <UrlText url={target.url} label={target.name} />
                  ) : (
                    (target?.name ?? 'Removed page')
                  )
                },
                {
                  label: 'Kind',
                  value: (
                    <>
                      {fixKindLabel(fix.kind)} ·{' '}
                      <a href={changeRowHash(fix.id)}>See it on Changes</a>
                    </>
                  )
                },
                { label: 'Goes live', value: formatWhen(fix.goLiveAt) },
                { label: 'Re-check', value: sentence(ruleOption(fix.rule, null)) },
                { label: 'Markets', value: marketNames.join(', ') || '—' },
                {
                  label: 'Result',
                  value:
                    fix.status === 'completed' ? (
                      <FixVerdict fix={fix} outcome={outcome} />
                    ) : (
                      sentence(followUpPhrase(fix))
                    )
                }
              ]}
            />
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
      {asking ? (
        <Confirm
          title={`Run the follow-up for Fix ${fix.number}?`}
          body={`Checks ${pluralize(fix.promptIds.length, 'targeted question')} in ${pluralize(fix.marketIds.length, 'market')} now, as a partial check. ${costLine(item)}.`}
          confirmLabel="Run follow-up"
          tone="default"
          busy={busy === 'run'}
          onConfirm={() => void run()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </Drawer>
  )
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
