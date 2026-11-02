import { useMemo, type JSX } from 'react'
import type { GenerationTemplate } from '@shared/domain'
import { templateFile } from '../../templates/copy'
import { KIND_LABEL } from '../../templates/model'
import { EmptyState, ListGrid, type ListColumn } from '../../ui'

/** Room for every template, so the page scrolls, never the list. */
const ROW_PX = 48

/**
 * The templates the playground can run, as the v2 list grid: one row each
 * (name and file, then kind). Opening a row picks that template.
 */
export function TemplateList({
  templates,
  selectedId,
  onPick
}: {
  templates: readonly GenerationTemplate[]
  selectedId: string | null
  onPick: (id: string) => void
}): JSX.Element {
  const columns = useMemo<ListColumn<GenerationTemplate>[]>(
    () => [
      {
        id: 'name',
        label: 'Template',
        width: 'fill',
        minWidth: 180,
        sort: (template) => template.name.toLowerCase(),
        render: (template) => (
          <span className="pg-tpl-cell">
            <span className="pg-tpl-name" title={templateFile(template)}>
              {template.name}
            </span>
          </span>
        )
      },
      {
        id: 'kind',
        label: 'Type',
        width: 132,
        sort: (template) => KIND_LABEL[template.kind],
        render: (template) => <span className="faint">{KIND_LABEL[template.kind]}</span>
      }
    ],
    []
  )
  return (
    <ListGrid<GenerationTemplate>
      label="Choose a template"
      noun={['template', 'templates']}
      rows={templates}
      rowKey={(template) => template.id}
      rowLabel={(template) => template.name}
      columns={columns}
      onActivate={(template) => onPick(template.id)}
      isRowCurrent={(template) => template.id === selectedId}
      pageSize="all"
      maxBodyHeight={Math.max(templates.length, 1) * ROW_PX}
      summary={() => (templates.length === 1 ? '1 template' : `${templates.length} templates`)}
      empty={<EmptyState icon="inbox" title="No templates to run." />}
      className="pg-templates"
    />
  )
}
