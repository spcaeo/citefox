import { useState, type JSX } from 'react'
import type { VideoIdea } from '@shared/domain'
import type { VideoExportFile } from '@shared/ipc'
import { DrillButton, DrillFigure, DrillLink } from '../../drill'
import { Drawer, SectionHead, UrlText, type DrawerAction } from '../../ui'
import { useIdeaAction } from '../hooks/useIdeaAction'
import type { VideosSource } from '../source'
import { IDLE, type ActionState } from '../types'
import { evidenceDrill, type VideoDrills } from '../utils/drill'
import {
  FLOW_STEPS,
  flowSteps,
  formatDate,
  plainError,
  stepLabel,
  type FlowStepId
} from '../utils/model'
import { BriefSection, StoryboardSection } from './BriefSection'
import { PageLink, PromptLinks } from './Links'
import { MakeIt } from './MakeIt'
import { PublishSection, TrackSection } from './PublishTrack'

/**
 * FR-18.3. One idea's flow from the buyer's question to tracking, in the
 * shared Drawer over the grid (`?idea=<id>&idea.step=<step>`): a stepper on
 * the left (Question · Brief · Storyboard · Make · Publish · Track), the
 * step on the right, and the step's actions in the footer.
 */
export function IdeaFlow({
  source,
  projectId,
  idea,
  drills,
  step,
  onStep,
  onIdea,
  onClose
}: {
  source: VideosSource
  projectId: string
  idea: VideoIdea
  drills: VideoDrills
  step: FlowStepId
  onStep: (step: FlowStepId) => void
  onIdea: (idea: VideoIdea) => void
  onClose: () => void
}): JSX.Element {
  const evidence = drills.of(evidenceDrill(idea))
  const request = { projectId, ideaId: idea.id }
  const [briefState, runBrief] = useIdeaAction(onIdea)
  const [sendState, runSend] = useIdeaAction(onIdea)
  const [checkState, runCheck] = useIdeaAction(onIdea)
  const [trackState, runTrack] = useIdeaAction(onIdea)
  const [deadlineState, runDeadline] = useIdeaAction(onIdea)
  const [exportState, setExportState] = useState<ActionState>(IDLE)
  const [videoUrl, setVideoUrl] = useState(idea.videoUrl ?? '')
  const [missingUrl, setMissingUrl] = useState(false)
  const steps = flowSteps(idea)
  const index = Math.max(0, FLOW_STEPS.indexOf(step))
  const previous = FLOW_STEPS[index - 1]
  const next = steps[index + 1]
  const trackFormId = `yt-track-${idea.id}`

  async function exportFile(file: VideoExportFile): Promise<void> {
    setExportState({ busy: true, message: null, error: false })
    try {
      const result = await source['videos:export']({ ...request, file })
      setExportState(
        result.ok
          ? { busy: false, message: `Saved ${result.filename}`, error: false }
          : { busy: false, message: result.reason, error: true }
      )
    } catch (cause) {
      setExportState({ busy: false, message: plainError(cause, 'Could not save.'), error: true })
    }
  }

  function writeBrief(force: boolean): void {
    void runBrief(() => source['videos:writeBrief']({ ...request, force }), 'Brief written.')
  }

  function track(): void {
    const url = videoUrl.trim()
    if (url.length === 0) {
      setMissingUrl(true)
      return
    }
    setMissingUrl(false)
    void runTrack(
      () => source['videos:track']({ ...request, videoUrl: url }),
      'Tracking started. The next scheduled check reports whether overviews cite it.'
    )
  }

  function primary(): DrawerAction | undefined {
    if (step === 'brief' && idea.brief === null) {
      return {
        label: briefState.busy ? 'Writing the brief…' : 'Write the brief',
        busy: briefState.busy,
        disabled: briefState.busy,
        onClick: () => writeBrief(false)
      }
    }
    if (step === 'track') {
      return {
        label: idea.step === 'tracking' ? 'Update the video' : 'Start tracking',
        busy: trackState.busy,
        disabled: trackState.busy,
        onClick: track
      }
    }
    if (next === undefined) return undefined
    return {
      label: `Next: ${next.label}`,
      iconEnd: 'arrow-right',
      onClick: () => onStep(next.id)
    }
  }

  const footerPrimary = primary()
  const summary = [
    `Status: ${stepLabel(idea.step)}`,
    idea.deadline ? `due ${formatDate(idea.deadline)}` : null,
    idea.sentToFoxcueAt ? `sent to FoxCue ${formatDate(idea.sentToFoxcueAt)}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      id="yt-idea"
      title={idea.brief?.title ?? idea.question}
      trail={[{ label: 'Ideas', onSelect: onClose }]}
      subtitle={
        <>
          From question to video · Based on <PageLink idea={idea} /> · <PromptLinks idea={idea} />
        </>
      }
      step={{ current: index + 1, total: FLOW_STEPS.length }}
      testId="yt-idea-drawer"
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        summary: <span data-testid="yt-idea-summary">{summary}</span>,
        cancel: 'Close',
        ...(previous
          ? {
              secondary: {
                label: 'Back',
                icon: 'arrow-left' as const,
                onClick: () => onStep(previous)
              }
            }
          : {}),
        ...(footerPrimary ? { primary: footerPrimary } : {})
      }}
    >
      <div className="yt-flow">
        <nav className="yt-flow-nav" aria-label="Steps">
          <ol className="yt-stepper">
            {steps.map((item) => (
              <li
                key={item.id}
                className={[item.done ? 'done' : '', item.id === step ? 'now' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  aria-current={item.id === step ? 'step' : undefined}
                  onClick={() => onStep(item.id)}
                >
                  <span className="yt-step-n" aria-hidden="true">
                    {item.done ? '✓' : item.n}
                  </span>
                  {item.label}
                  <span className="sr-only">{item.done ? ' (done)' : ''}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="yt-flow-body">
          {step === 'question' ? (
            <section className="yt-step" id="yt-step-question" aria-labelledby="yt-q-h">
              <SectionHead level={3} id="yt-q-h" title="1 · The buyer's question and the page" />
              <blockquote className="yt-question">“{idea.question}”</blockquote>
              <p className="yt-muted yt-small">
                <PromptLinks idea={idea} /> ·{' '}
                <DrillButton
                  drill={evidence}
                  className="drill-num"
                  label={`${evidence.items.length} overviews show a video. Show them`}
                >
                  <DrillFigure drill={evidence} />{' '}
                  {evidence.items.length === 1 ? 'overview shows' : 'overviews show'} a video
                </DrillButton>
              </p>
              <div className="yt-item">
                <span className="yt-label">The page that answers it</span>
                <span className="yt-row">
                  <UrlText url={idea.pageUrl} />
                  {idea.pageId !== '' ? (
                    <DrillLink className="yt-link" target={{ kind: 'page', pageId: idea.pageId }}>
                      Open the page in CiteFox
                    </DrillLink>
                  ) : null}
                </span>
              </div>
              <div className="yt-item">
                <label className="yt-label" htmlFor={`yt-deadline-${idea.id}`}>
                  Deadline (optional)
                </label>
                <div className="yt-row">
                  <input
                    id={`yt-deadline-${idea.id}`}
                    className="ui-input ui-input-sm yt-date"
                    type="date"
                    value={idea.deadline ?? ''}
                    disabled={deadlineState.busy}
                    onChange={(event) => {
                      const value = event.target.value
                      void runDeadline(() =>
                        source['videos:update']({
                          ...request,
                          patch: { deadline: value.length === 10 ? value : null }
                        })
                      )
                    }}
                  />
                  {deadlineState.error ? (
                    <span className="yt-error yt-small" role="alert">
                      {deadlineState.message}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}
          {step === 'brief' ? (
            <BriefSection idea={idea} state={briefState} onWrite={writeBrief} />
          ) : null}
          {step === 'storyboard' ? <StoryboardSection idea={idea} /> : null}
          {step === 'make' ? (
            <MakeIt
              idea={idea}
              sendState={sendState}
              exportState={exportState}
              onSent={() =>
                void runSend(
                  () => source['videos:markSent'](request),
                  'Marked sent. foxcue.com opened.'
                )
              }
              onExport={(file) => void exportFile(file)}
            />
          ) : null}
          {step === 'publish' ? (
            <PublishSection
              idea={idea}
              checklistState={checkState}
              onChecklist={(checklist) =>
                void runCheck(() => source['videos:update']({ ...request, patch: { checklist } }))
              }
            />
          ) : null}
          {step === 'track' ? (
            <TrackSection
              idea={idea}
              formId={trackFormId}
              url={videoUrl}
              missing={missingUrl}
              trackState={trackState}
              onUrl={setVideoUrl}
              onSubmit={track}
            />
          ) : null}
        </div>
      </div>
    </Drawer>
  )
}
