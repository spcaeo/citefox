import type { JSX } from 'react'
import type { StartEdit, StartProgress } from '@shared/ipc'
import { ListGrid, Panel, UrlText, type ListColumn } from '../ui'
import type { StartClient } from './client'
import { EditableChips } from './edit/EditableChips'
import { EditableRows } from './edit/EditableRows'
import { PageAdder } from './edit/PageAdder'
import { RivalsEditor } from './edit/RivalsEditor'
import { useStartEdits } from './edit/useStartEdits'
import { ShareBar } from './StartFrame'
import type { StartProject } from './types'

/**
 * The right column while the autopilot runs (journey A2): what CiteFox knows
 * so far, editable as it appears. Rivals, segments, triggers, picked pages and
 * questions each take edits at once; the steps still to run use them. Pause
 * lets the user edit calmly.
 */
export function SetupKnown({
  progress,
  client,
  project,
  onProgress
}: {
  progress: StartProgress | null
  client: StartClient
  project: StartProject
  onProgress: (progress: StartProgress) => void
}): JSX.Element {
  const edits = useStartEdits({ client, projectId: project.id, onProgress })
  const send = (edit: StartEdit): void => {
    void edits.send(edit)
  }
  const known = progress?.known
  const buyers = known?.buyers ?? null
  const rivals = known?.rivals ?? []
  const anything = rivals.length > 0 || buyers !== null
  const site = `https://${project.domain}`

  return (
    <div className="sf-col">
      {edits.error ? (
        <p className="sf-error" role="alert">
          {edits.error}
        </p>
      ) : null}
      {anything && known ? (
        <Panel
          title="What we know"
          padding={0}
          className="sf-flush"
          actions={<span className="su-note">Updates live · edit anything</span>}
        >
          {buyers ? (
            <div className="su-buyers">
              <p className="su-key">Who buys</p>
              {buyers.who ? <p className="su-who">{buyers.who}</p> : null}
              <EditableChips
                label="Segments"
                noun="segment"
                items={buyers.segments}
                onRename={(text, to) => send({ kind: 'segment', op: 'rename', text, to })}
                onRemove={(text) => send({ kind: 'segment', op: 'remove', text })}
                onAdd={(text) => send({ kind: 'segment', op: 'add', text })}
              />
            </div>
          ) : null}
          <div className="ed-facts">
            <RivalsEditor rivals={rivals} onSend={send} layout="facts" />
            {buyers ? (
              <div className="ed-fact">
                <p className="ed-fact-label">Triggers</p>
                <EditableChips
                  label="Triggers"
                  noun="trigger"
                  items={buyers.triggers}
                  onRename={(text, to) => send({ kind: 'trigger', op: 'rename', text, to })}
                  onRemove={(text) => send({ kind: 'trigger', op: 'remove', text })}
                  onAdd={(text) => send({ kind: 'trigger', op: 'add', text })}
                />
              </div>
            ) : null}
          </div>
        </Panel>
      ) : (
        <FoundSoFar progress={progress} />
      )}
      {known && known.picked !== null ? (
        <Panel
          title="Pages picked"
          padding={0}
          className="sf-flush"
          actions={
            <span className="su-note num">
              {known.pickedPages.length}
              {known.pageCount !== null ? ` of ${known.pageCount.toLocaleString('en-US')}` : ''}
            </span>
          }
        >
          <EditableRows
            label="Pages picked"
            noun="page"
            rows={known.pickedPages.map((page) => ({
              id: page.url,
              text: page.path,
              content: <UrlText url={page.url} label={page.path} site={site} />
            }))}
            onRemove={(url) => send({ kind: 'page', op: 'remove', url })}
            addSlot={(close) => (
              <PageAdder
                client={client}
                projectId={project.id}
                domain={project.domain}
                onAdd={(url) => {
                  close()
                  send({ kind: 'page', op: 'add', url })
                }}
                onCancel={close}
              />
            )}
          />
        </Panel>
      ) : null}
      {known && known.upNext.length > 0 ? (
        <Panel
          title="Up next"
          padding={20}
          actions={<span className="su-note">{known.upNext.length} pages queued</span>}
        >
          <ul className="sf-rows">
            {known.upNext.slice(0, 4).map((path, index) => (
              <li key={path}>
                <UrlText url={path} site={site} />
                <span className="sf-faint">{index === 0 ? 'next' : `${index + 1}.`}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {known && known.questions.length > 0 ? (
        <Panel
          title="Questions so far"
          padding={0}
          className="sf-flush"
          actions={<span className="su-note">{known.questions.length} written</span>}
        >
          <EditableRows
            label="Questions so far"
            noun="question"
            rows={known.questions.map((question, index) => ({
              id: question.id,
              text: question.text,
              lead: `Q${index + 1}`
            }))}
            onEdit={(id, text) => send({ kind: 'question', op: 'edit', id, text })}
            onRemove={(id) => send({ kind: 'question', op: 'remove', id })}
            onAdd={(text) => send({ kind: 'question', op: 'add', text })}
          />
        </Panel>
      ) : null}
      {edits.toast}
    </div>
  )
}

interface SectionShare {
  key: string
  label: string
  pageCount: number
  share: number
}

const SECTION_COLUMNS: readonly ListColumn<SectionShare>[] = [
  {
    id: 'section',
    label: 'Section',
    width: 'fill',
    minWidth: 120,
    render: (row) => (
      <span className="su-section">
        {row.label} <span className="sf-mono sf-faint">{row.key}</span>
      </span>
    )
  },
  {
    id: 'share',
    label: 'Share',
    width: 72,
    render: (row) => <ShareBar percent={row.share} />
  },
  {
    id: 'pages',
    label: 'Pages',
    width: 72,
    numeric: true,
    render: (row) => row.pageCount.toLocaleString('en-US')
  }
]

function FoundSoFar({ progress }: { progress: StartProgress | null }): JSX.Element {
  const known = progress?.known
  const sections = known?.sections ?? []
  const top = sections[0]?.pageCount ?? 1
  const rows: SectionShare[] = sections.slice(0, 6).map((section) => ({
    key: section.key,
    label: section.label,
    pageCount: section.pageCount,
    share: (section.pageCount / Math.max(1, top)) * 100
  }))
  return (
    <Panel
      title="Found so far"
      padding={20}
      actions={<span className="su-note">Updates live</span>}
    >
      <dl className="sf-rows">
        <div>
          <dt>Pages</dt>
          <dd className="num">{known?.pageCount?.toLocaleString('en-US') ?? '…'}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd className="num">{sections.length > 0 ? sections.length : '…'}</dd>
        </div>
        <div>
          <dt>Picked</dt>
          <dd className="num">{known?.picked ?? '…'}</dd>
        </div>
      </dl>
      <ListGrid
        label="Sections found so far"
        noun={['section', 'sections']}
        rows={rows}
        rowKey={(row) => row.key}
        rowLabel={(row) => row.label}
        columns={SECTION_COLUMNS}
        empty={<p className="su-empty sf-faint">Reading the sitemap…</p>}
      />
    </Panel>
  )
}
