import { useState, type JSX } from 'react'
import type { VideoIdea } from '@shared/domain'
import { copyText } from '../../components/clipboard'
import { pageHash } from '../../shell/routes'
import type { ActionState } from '../types'
import { AiMenu, Chip, IconButton, SectionHead } from '../../ui'
import { briefText } from '../utils/model'

/**
 * FR-18.4. Step 2: the brief, written by Claude from the page and the prompts.
 * Before it exists, "Write the brief" is the step's one action (the drawer
 * footer); afterwards the section's one AI menu rewrites it.
 */
export function BriefSection({
  idea,
  state,
  onWrite
}: {
  idea: VideoIdea
  state: ActionState
  onWrite: (force: boolean) => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const brief = idea.brief
  return (
    <section className="yt-step" id="yt-step-brief" aria-labelledby="yt-brief-h">
      <SectionHead
        level={3}
        id="yt-brief-h"
        title="2 · Brief"
        ai={
          brief === null ? undefined : (
            <AiMenu
              label="AI actions for the brief"
              size="sm"
              actions={[
                {
                  id: 'regenerate',
                  label: state.busy ? 'Writing the brief…' : 'Write the brief again',
                  icon: 'refresh',
                  seconds: 30,
                  disabled: state.busy,
                  onSelect: () => onWrite(true)
                }
              ]}
            />
          )
        }
      />
      {brief === null ? (
        <>
          <p className="yt-muted">No brief yet for this idea.</p>
          <p>
            CiteFox AI reads the page and the questions, then writes the title, hook, chapters, a
            script where every claim points to a page section, the YouTube description, thumbnail
            text and tags.
          </p>
        </>
      ) : (
        <div className="yt-brief">
          <Field label="Video title">
            <p className="yt-brief-title">{brief.title}</p>
          </Field>
          <Field label="Hook · first 10 seconds">
            <p>{brief.hook}</p>
          </Field>
          <Field label="Chapters">
            <ul className="yt-plain">
              {brief.chapters.map((chapter) => (
                <li key={`${chapter.at}-${chapter.name}`}>
                  <span className="mono">{chapter.at}</span> {chapter.name}
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Script">
            <ol className="yt-plain yt-script">
              {brief.script.map((line, index) => (
                <li key={`${line.at}-${index}`}>
                  <span className="mono yt-muted">{line.at}</span> {line.text}
                  {line.source === null ? null : (
                    <sup className="yt-fn" title={`Source ${line.source}`}>
                      <span className="sr-only">Source </span>
                      {line.source}
                    </sup>
                  )}
                </li>
              ))}
            </ol>
          </Field>
          <Field label="Where each claim comes from">
            <ol className="yt-plain yt-sources">
              {brief.sources.map((source) => (
                <li
                  key={source.n}
                  id={`yt-source-${source.n}`}
                  className={source.onPage ? undefined : 'yt-flag'}
                >
                  <span className="mono">{source.n}</span> {source.section}
                  {source.onPage ? null : idea.pageId === '' ? (
                    <Chip size="sm" tone="warn">
                      Not on the page yet
                    </Chip>
                  ) : (
                    <a
                      className="yt-flag-link"
                      href={pageHash(idea.pageId, 'gaps')}
                      aria-label="Not on the page yet: see the page's content gaps"
                    >
                      <Chip size="sm" tone="warn">
                        Not on the page yet
                      </Chip>
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </Field>
          <Field label="YouTube description">
            <pre className="yt-pre">{brief.description}</pre>
          </Field>
          <Field label="Thumbnail text">
            <p>{brief.thumbnailText}</p>
          </Field>
          <Field label="Tags">
            <span className="yt-chips">
              {brief.tags.map((tag) => (
                <Chip key={tag} size="sm">
                  {tag}
                </Chip>
              ))}
            </span>
          </Field>
          <div className="yt-row">
            <IconButton
              icon={copied ? 'check' : 'copy'}
              label={copied ? 'Copied' : 'Copy brief'}
              tip
              onClick={() => {
                void copyText(briefText(brief, idea)).then(setCopied)
              }}
            />
          </div>
        </div>
      )}
      {state.message ? (
        <p
          className={state.error ? 'bridge-alert' : 'yt-muted'}
          role={state.error ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  )
}

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="yt-item">
      <span className="yt-label">{label}</span>
      {children}
    </div>
  )
}

/** Step 3: the storyboard, drawn from the brief's scenes. */
export function StoryboardSection({ idea }: { idea: VideoIdea }): JSX.Element {
  const scenes = idea.brief?.scenes ?? []
  return (
    <section className="yt-step" id="yt-step-storyboard" aria-labelledby="yt-story-h">
      <SectionHead level={3} id="yt-story-h" title="3 · Storyboard" />
      {scenes.length === 0 ? (
        <p className="yt-muted">
          Write the brief first; the storyboard is drawn from its chapters.
        </p>
      ) : (
        <ol className="yt-scenes">
          {scenes.map((scene) => (
            <li key={scene.n} className="yt-scene">
              <span className="yt-label">
                {scene.n} · {scene.name}
              </span>
              <span className="mono yt-muted">{scene.at}</span>
              <span>
                {sceneKind(scene.kind)} · {scene.note}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function sceneKind(kind: 'card' | 'screenshot' | 'demo' | 'slide'): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}
