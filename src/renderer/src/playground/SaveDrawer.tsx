import type { JSX } from 'react'
import type { ProjectSummary } from '@shared/domain'
import { PLAYGROUND_SAVE_PARTS, type PlaygroundSavePart } from '@shared/ipc'
import { Drawer, DrawerField, DrawerGrid, DrawerSection } from '../ui'

/**
 * "Save to project" for a playground run, in the kit's Drawer
 * (`drawer=playground-save&pgs.run=<run id>`): the parts to write and the
 * project they go to. Runs live in memory for this session, so a link to a
 * run that is gone says so instead of the form.
 */
export function SaveDrawer({
  labels,
  found,
  parts,
  onTogglePart,
  projectId,
  onProject,
  targets,
  busy,
  error,
  onClose,
  onConfirm
}: {
  labels: Readonly<Record<PlaygroundSavePart, string>>
  /** False when the run in the URL is not in memory any more. */
  found: boolean
  parts: readonly PlaygroundSavePart[]
  onTogglePart: (part: PlaygroundSavePart) => void
  projectId: string
  onProject: (projectId: string) => void
  targets: readonly ProjectSummary[]
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}): JSX.Element {
  const target = targets.find((project) => project.id === projectId) ?? null
  return (
    <Drawer
      id="playground-save"
      title="Save to project"
      subtitle="Only the parts you pick are written. Playground runs aren't saved until you save."
      testId="playground-save-drawer"
      busy={busy}
      closeDisabled={busy}
      {...(found
        ? {}
        : {
            error: {
              message:
                'This run is not in memory any more. Playground runs last for this session only.'
            }
          })}
      onClose={onClose}
      footer={
        found
          ? {
              summary: error ? (
                <span className="ui-drawer-error" role="alert">
                  {error}
                </span>
              ) : (
                `${parts.length} ${parts.length === 1 ? 'part' : 'parts'} selected${
                  target ? ` · to ${target.name}` : ''
                }`
              ),
              primary: {
                label: 'Save to project',
                busy,
                disabled: busy || parts.length === 0 || projectId === '',
                onClick: onConfirm
              }
            }
          : {}
      }
    >
      <DrawerGrid>
        <DrawerSection
          title="Parts"
          count={parts.length}
          description="A part this run does not contain is skipped."
          span={8}
        >
          <fieldset className="tpl-facet">
            <legend className="sr-only">Parts to save</legend>
            {PLAYGROUND_SAVE_PARTS.map((part) => (
              <label key={part} className="tpl-check">
                <input
                  type="checkbox"
                  checked={parts.includes(part)}
                  onChange={() => onTogglePart(part)}
                />
                <span>{labels[part]}</span>
              </label>
            ))}
          </fieldset>
        </DrawerSection>
        <DrawerSection title="Where it goes" span={4}>
          <DrawerField label="Project" hint="Archived projects are not listed.">
            {({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                className="select"
                value={projectId}
                onChange={(event) => onProject(event.target.value)}
              >
                {targets.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            )}
          </DrawerField>
        </DrawerSection>
      </DrawerGrid>
    </Drawer>
  )
}
