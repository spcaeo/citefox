import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import type { SetupSectionId } from '@shared/ipc'
import { ClaudeWait, LinkedText, useClaudePause } from '../../components/claudePause'
import { Badge, BusyLine, Button, IconButton, UiIcon } from '../../ui'
import { usualForSection } from '../usualTimes'
import { ChatgptPanel } from './ChatgptPanel'
import { PromptEditor } from './PromptEditor'
import { RedoBox } from './RedoBox'
import { SectionAiMenu, type SectionMenuLine } from './SectionAiMenu'
import type { SectionActions } from './useSectionActions'
import type { SectionAi } from './useSectionAi'
import type { SectionUrl } from './useSectionUrl'

/** A section card's head: title, count, a muted hint, then its buttons on the right. */
export function SectionHead({
  title,
  titleId,
  count,
  countLabel,
  hint,
  children
}: {
  title: string
  titleId: string
  count?: number
  /** "3 products", for screen readers. */
  countLabel?: string
  hint?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="osc-head">
      <h2 className="osc-title" id={titleId}>
        {title}
      </h2>
      {count !== undefined ? (
        <Badge {...(countLabel ? { label: countLabel } : {})}>{count}</Badge>
      ) : null}
      {hint ? <span className="osc-hint osc-head-hint">{hint}</span> : null}
      <span className="osc-grow" />
      {children}
    </div>
  )
}

/** ✦ Find more (or Write more): one small button with the cost as its tooltip. */
export function FindMoreButton({
  label,
  ai,
  onClick
}: {
  label: string
  ai: SectionAi
  onClick: () => void
}): JSX.Element {
  const tip = ai.available ? ai.costText : 'No AI is connected: opens your own ChatGPT'
  return (
    <Button
      size="sm"
      icon="sparkle"
      className="osc-ai-btn"
      busy={ai.busy === 'more'}
      busyLabel="Finding…"
      disabled={ai.busy !== null && ai.busy !== 'more'}
      title={tip}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

export function SectionMenu({
  title,
  lines,
  ai,
  url
}: {
  title: string
  lines: readonly SectionMenuLine[]
  ai: SectionAi
  url: SectionUrl
}): JSX.Element {
  return (
    <SectionAiMenu
      label={`AI actions for ${title}`}
      open={url.panel === 'menu'}
      lines={lines}
      footer={ai.available ? ai.costText : (ai.reason ?? 'No AI is connected.')}
      onToggle={() => url.togglePanel('menu')}
      onClose={url.closePanel}
    />
  )
}

/**
 * The card's live line: what runs now (the kit's busy line, with its timer and
 * usual time), the last result, warnings, an error (with the ChatGPT way out),
 * and Undo after ✕ Remove. The start is announced here; the result is
 * announced by useSectionAi.
 */
export function SectionStatus({
  section,
  ai,
  actions,
  runningText,
  announce
}: {
  section: SetupSectionId
  ai: SectionAi
  actions: SectionActions
  /** "Claude is looking for more competitors." */
  runningText: string
  /** The setup's polite live region. */
  announce: (message: string) => void
}): JSX.Element | null {
  const { removal } = actions
  const running = ai.busy !== null
  const pause = useClaudePause(!running && Boolean(ai.error), null)
  if (!running && !ai.error && !ai.note && ai.warnings.length === 0 && !removal) return null
  return (
    <div className="osc-status">
      <BusyLine
        active={running}
        label={ai.busy === 'read' ? 'CiteFox AI is reading the answer.' : runningText}
        usual={usualForSection(section, ai.busy === 'read')}
        announce={announce}
        note="You can keep working"
        className="osc-running"
      />
      {!running && ai.note ? (
        <p className="osc-hint osc-note">
          <span className="osc-ok" aria-hidden="true">
            <UiIcon name="check" size={14} />
          </span>
          {ai.note}
          <IconButton icon="x" size="sm" label="Dismiss" onClick={ai.dismiss} />
        </p>
      ) : null}
      {!running
        ? ai.warnings.map((warning) => (
            <p key={warning} className="osc-hint osc-warn">
              <UiIcon name="warning" size={14} />
              {warning}
            </p>
          ))
        : null}
      {!running && ai.error ? (
        <p className="osc-hint osc-bad" role="alert">
          <UiIcon name="warning" size={14} />
          <LinkedText text={ai.error} />{' '}
          {pause ? <ClaudeWait pause={pause} look="link" className="osc-link" /> : null}
          <button type="button" className="osc-link" onClick={() => actions.openChatbot('more')}>
            Use my own ChatGPT instead
          </button>
        </p>
      ) : null}
      {removal ? (
        <p className="osc-hint osc-undo" role="status" data-testid="section-undo">
          {removal.message}
          <Button
            size="sm"
            variant="text"
            onClick={() => {
              removal.undo()
              actions.clearUndo()
            }}
          >
            Undo
          </Button>
        </p>
      ) : null}
    </div>
  )
}

/**
 * An open panel, scrolled into view: opened from the ⋯ menu it may sit under
 * a long list, below the window (the focus alone does not scroll, on purpose).
 */
function PanelView({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  return (
    <div ref={ref} className="osc-panel-view">
      {children}
    </div>
  )
}

/** The inline panel open in the URL: Redo, the prompt, or the user's own ChatGPT. */
export function SectionPanels(props: Parameters<typeof panelFor>[0]): JSX.Element | null {
  const panel = panelFor(props)
  return panel === null ? null : <PanelView key={props.url.panel ?? ''}>{panel}</PanelView>
}

function panelFor({
  title,
  redoLabel,
  saved,
  tracked,
  ai,
  actions,
  url
}: {
  title: string
  redoLabel: string
  /** The user's saved prompt edit for this section. */
  saved: string | null
  /** Rows the section holds. */
  tracked: number
  ai: SectionAi
  actions: SectionActions
  url: SectionUrl
}): JSX.Element | null {
  if (url.panel === 'redo') {
    return (
      <RedoBox
        title={title}
        redoLabel={redoLabel}
        value={actions.instruction}
        onChange={actions.setInstruction}
        saveRule={actions.saveRule}
        onSaveRule={actions.setSaveRule}
        costText={ai.costText}
        available={ai.available}
        reason={ai.reason}
        busy={ai.busy === 'redo'}
        onRedo={actions.redo}
        onChatbot={() => actions.openChatbot('redo', actions.instruction)}
        onEditPrompt={() => url.openPanel('prompt')}
        onClose={url.closePanel}
      />
    )
  }
  if (url.panel === 'prompt') {
    return (
      <PromptEditor
        saved={saved}
        costText={ai.costText}
        available={ai.available}
        busy={ai.busy === 'redo'}
        loadPrompt={() => ai.loadPrompt('redo', null)}
        onRun={actions.runPrompt}
        onReset={actions.resetPrompt}
        onChatbot={(text) => actions.openChatbot('redo', null, text)}
        onClose={url.closePanel}
      />
    )
  }
  if (url.panel === 'chatgpt') {
    const spec = actions.chatbot
    return (
      <ChatgptPanel
        key={`${spec.mode}:${spec.instruction ?? ''}:${spec.edited ?? ''}`}
        title={title}
        intro={ai.available ? spec.intro : `${ai.reason ?? 'No AI is connected.'} ${spec.intro}`}
        edited={spec.edited}
        tracked={tracked}
        reading={ai.busy === 'read'}
        loadPrompt={() => ai.loadPrompt(spec.mode, spec.instruction)}
        onRead={actions.readChatbot}
        onClose={url.closePanel}
      />
    )
  }
  return null
}
