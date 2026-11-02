import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { VideoIdea } from '@shared/domain'
import type { VideoExportFile } from '@shared/ipc'
import type { ActionState } from '../types'
import { Button, buttonClass, Chip, ExportMenu, SectionHead } from '../../ui'
import { formatDate } from '../utils/model'
import { Teleprompter } from './Teleprompter'

const FILES: readonly { file: VideoExportFile; label: string }[] = [
  { file: 'script', label: 'Script (.md)' },
  { file: 'captions', label: 'Captions (.srt)' },
  { file: 'shots', label: 'Shot list (.csv)' }
]

/**
 * FR-18.5 step 4. Send to FoxCue (sponsor: only marks the idea sent and opens
 * foxcue.com), record it yourself, or export files. Recording and exporting
 * never depend on FoxCue (FR-18.9).
 */
export function MakeIt({
  idea,
  sendState,
  exportState,
  onSent,
  onExport
}: {
  idea: VideoIdea
  sendState: ActionState
  exportState: ActionState
  onSent: () => void
  onExport: (file: VideoExportFile) => void
}): JSX.Element {
  const [prompter, setPrompter] = useState(false)
  const brief = idea.brief
  return (
    <section className="yt-step" id="yt-step-make" aria-labelledby="yt-make-h">
      <SectionHead level={3} id="yt-make-h" title="4 · Make it" />
      <div className="yt-make">
        <div className="yt-make-card">
          <Chip size="sm">Sponsor</Chip>
          <h4>Send to FoxCue</h4>
          <p className="yt-small">
            FoxCue builds the video from this brief and storyboard. This button only marks the idea
            as sent in CiteFox and opens foxcue.com in your browser. CiteFox sends nothing to
            FoxCue.
          </p>
          <a
            className={buttonClass('secondary', 'sm')}
            href="https://foxcue.com/"
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              if (!sendState.busy) onSent()
            }}
          >
            Send to FoxCue
          </a>
          <span className="yt-muted yt-small" role="status">
            {idea.sentToFoxcueAt
              ? `Marked sent ${formatDate(idea.sentToFoxcueAt)}`
              : (sendState.message ?? 'Not sent yet')}
          </span>
        </div>
        <div className="yt-make-card">
          <h4>Record it yourself</h4>
          <p className="yt-small">
            Read the script from a teleprompter while you record your screen and voice. Chapters and
            scenes stay in order.
          </p>
          <Button size="sm" disabled={brief === null} onClick={() => setPrompter(true)}>
            Open the teleprompter
          </Button>
          {brief === null ? (
            <span className="yt-muted yt-small">Write the brief first.</span>
          ) : null}
        </div>
        <div className="yt-make-card">
          <h4>Export for your editor</h4>
          <p className="yt-small">Hand the files to whoever edits your videos.</p>
          <div className="yt-files">
            <ExportMenu
              label="Download files"
              busy={exportState.busy}
              items={FILES.map((item) => ({
                id: item.file,
                label: item.label,
                disabled: brief === null,
                onSelect: () => onExport(item.file)
              }))}
            />
          </div>
          <span
            className={exportState.error ? 'yt-error yt-small' : 'yt-muted yt-small'}
            role="status"
          >
            {brief === null ? 'Write the brief first.' : (exportState.message ?? '')}
          </span>
        </div>
      </div>
      {prompter && brief !== null
        ? // Full screen over the drawer: out of the drawer's box (it slides in with a transform).
          createPortal(
            <Teleprompter brief={brief} onClose={() => setPrompter(false)} />,
            document.body
          )
        : null}
    </section>
  )
}
