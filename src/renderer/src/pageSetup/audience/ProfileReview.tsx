import { useMemo, useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import type { PageDetail } from '@shared/ipc'
import { marketLabel } from '../../shell/model'
import { pageHash } from '../../shell/routes'
import {
  Button,
  Chip,
  ListGrid,
  ToolButton,
  Panel,
  RightRail,
  type ListColumn,
  type MenuItem
} from '../../ui'
import { useGridQueryState } from '../../utils/queryState'
import { formatDay, formatReadStamp } from '../model'
import type { PromptContext } from '../readContext'
import { PromptCount } from '../readDrills'
import { TemplateProvenance } from '../TemplateProvenance'
import { InlineInput } from './InlineInput'
import {
  NAMED_PARTS,
  PART_HINT,
  PART_LABEL,
  PROFILE_PARTS,
  removable,
  rowsSummary,
  type PartKey,
  type ProfileRow
} from './model'

/** The "+ Add …" button in each section header. */
const ADD_LABEL: Readonly<Record<Exclude<PartKey, 'who'>, string>> = {
  environment: 'Add environment',
  segments: 'Add segment',
  triggers: 'Add trigger',
  values: 'Add value',
  poorFit: 'Add poor fit'
}

export interface ProfileReviewProps {
  page: PageDetail
  profile: BuyerProfile
  rows: readonly ProfileRow[]
  context: PromptContext
  readStamp: string | null
  modified: string | null
  /** Triggers added from a suggestion this visit, marked New. */
  added: ReadonlySet<string>
  /** The section's one AI menu, for the grid toolbar. */
  ai: JSX.Element
  /** The open AI suggestion card, shown at the top of the rail. */
  aiCard: JSX.Element | null
  /** The Profile settings button, at the end of the grid toolbar. */
  settings: JSX.Element
  /** The add or edit form, shown above the grid. */
  editor: JSX.Element | null
  /** ✦ Help me fill this, shown above the grid while it is open. */
  helper?: JSX.Element | null
  onAdd: () => void
  onEdit: (row: ProfileRow) => void
  /** Saves a point's new wording typed in place. True when it saved. */
  onRename: (row: ProfileRow, text: string) => Promise<boolean>
  /** Adds a point typed in a section header. True when it saved. */
  onAddTo: (part: PartKey, text: string) => Promise<boolean>
  onRemove: (rows: readonly ProfileRow[]) => void
  onEditAll: () => void
}

/**
 * The buyer profile review (Seed-Profile.png): every point in one list grid
 * grouped by section (search, ⋯ menu, bulk remove, one AI menu), with the
 * version panel in the right rail.
 */
export function ProfileReview(props: ProfileReviewProps): JSX.Element {
  const { page, profile, rows, context, added, onRename, onAddTo } = props
  // One point or one section's add box is open at a time; the grid may redraw its rows.
  // Search and sort are on the URL (`au.q`, `au.sort`).
  const grid = useGridQueryState('au')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [adding, setAdding] = useState<PartKey | null>(null)
  const columns = useMemo<ListColumn<ProfileRow>[]>(
    () => [
      {
        id: 'point',
        label: 'Point',
        width: 'fill',
        minWidth: 240,
        sort: (row) => row.text,
        render: (row) => (
          <span className="au-point">
            {renaming === row.id ? (
              <InlineInput
                label={`Edit point: ${row.text}`}
                initial={row.text}
                onSave={(text) => onRename(row, text)}
                onDone={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                className="au-point-btn"
                aria-label={`Edit point: ${row.text}`}
                title={row.text}
                onClick={() => setRenaming(row.id)}
              >
                <span className="au-point-text">{row.text}</span>
              </button>
            )}
            {row.reason ? <span className="au-point-reason">{row.reason}</span> : null}
          </span>
        )
      },
      {
        id: 'prompts',
        label: 'Questions',
        width: 120,
        sort: (row) => row.promptIds?.length ?? null,
        render: (row) =>
          row.drillId !== null && row.promptIds !== null ? (
            <PromptCount
              context={context}
              id={row.drillId}
              title={row.drillTitle}
              description={row.drillDescription}
              ids={row.promptIds}
            />
          ) : null
      },
      {
        id: 'new',
        label: 'New',
        hideLabel: true,
        width: 64,
        render: (row) =>
          row.part === 'triggers' && added.has(row.text) ? (
            <Chip tone="fox" size="sm">
              New
            </Chip>
          ) : null
      }
    ],
    [context, added, renaming, onRename]
  )

  function rowMenu(row: ProfileRow): MenuItem[] {
    const items: MenuItem[] = [
      { id: 'edit', label: 'Edit', icon: 'pencil', onSelect: () => props.onEdit(row) }
    ]
    if (removable(row)) {
      items.push({
        id: 'remove',
        label: 'Remove',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => props.onRemove([row])
      })
    }
    return items
  }

  return (
    <div className="au-grid">
      <div className="au-main">
        {props.helper}
        {props.editor}
        <ListGrid
          label="Buyer profile points"
          noun={['point', 'points']}
          rows={rows}
          rowKey={(row) => row.id}
          rowLabel={(row) => row.text}
          columns={columns}
          search={{ text: (row) => `${row.text} ${row.reason ?? ''}` }}
          {...grid.listProps}
          ai={props.ai}
          actions={
            <>
              <Button variant="ghost" icon="plus" onClick={props.onAdd}>
                Add point
              </Button>
              {props.settings}
            </>
          }
          group={{
            key: (row) => ({ key: row.part, label: PART_LABEL[row.part] }),
            order: PROFILE_PARTS,
            meta: (_rows, key) => {
              const part = key as PartKey
              return (
                <span className="au-gmeta-row">
                  <span className="au-gmeta">{PART_HINT[part]}</span>
                  {part === 'who' ? null : adding === part ? (
                    <InlineInput
                      className="au-gadd"
                      label={`New point in ${PART_LABEL[part]}`}
                      initial=""
                      placeholder={NAMED_PARTS.has(part) ? 'Name — why' : 'Type and press Enter'}
                      onSave={(text) => onAddTo(part, text)}
                      onDone={() => setAdding(null)}
                    />
                  ) : (
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(part)}>
                      {ADD_LABEL[part]}
                    </Button>
                  )}
                </span>
              )
            }
          }}
          bulk={({ selected, clear }) => (
            <Button
              size="sm"
              icon="trash"
              disabled={!selected.some(removable)}
              onClick={() => {
                props.onRemove(selected.filter(removable))
                clear()
              }}
            >
              Remove
            </Button>
          )}
          rowMenu={rowMenu}
          summary={() => rowsSummary(rows)}
          empty={<p className="au-note">This profile has no points yet. Use Add point.</p>}
          pageSize="all"
          maxBodyHeight={720}
        />
        <p className="au-note">
          One buyer profile covers{' '}
          <a href={pageHash(page.id, 'markets')}>
            {page.markets.length === 1
              ? 'this page’s market'
              : `all ${page.markets.length} markets`}
          </a>
          : {page.markets.map((market) => marketLabel(market)).join(', ')}.
        </p>
      </div>
      <RightRail label="Profile version and suggestions">
        {props.aiCard}
        <Panel
          title="This version"
          actions={
            <Chip tone="ok" dot>
              Saved
            </Chip>
          }
        >
          <dl className="au-kv">
            <div>
              <dt>Written</dt>
              <dd>{formatReadStamp(profile.createdAt)}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>
                The page
                {props.readStamp ? ` as read ${formatReadStamp(props.readStamp)}` : ''}
                {props.modified ? `, last modified ${formatDay(props.modified)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Template</dt>
              <dd>
                <TemplateProvenance
                  templateId={profile.templateId}
                  templateName={profile.templateName}
                  templateHash={profile.templateHash}
                  edited={profile.templateUpdatedAt !== null}
                />
              </dd>
            </div>
            <div>
              <dt>Markets</dt>
              <dd>
                One profile for {page.markets.map((market) => marketLabel(market)).join(', ')}
              </dd>
            </div>
          </dl>
          {profile.promptsStale ? (
            <p className="au-note" role="status">
              Saved questions were written from an older profile. They stay as they are until you
              rewrite them.
            </p>
          ) : null}
          <div className="au-rail-foot">
            <ToolButton kind="edit" onClick={props.onEditAll} />
          </div>
        </Panel>
      </RightRail>
    </div>
  )
}
