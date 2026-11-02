import type { JSX } from 'react'

/** A project name that opens the project, or plain text when it cannot. */
export function ProjectName({
  projectId,
  name,
  onOpenProject
}: {
  projectId: string | null
  name: string
  onOpenProject: ((projectId: string) => void) | null
}): JSX.Element {
  if (projectId === null || onOpenProject === null) return <>{name}</>
  return (
    <button
      type="button"
      className="rpt-text-btn"
      aria-label={`${name}: open project`}
      onClick={() => onOpenProject(projectId)}
    >
      {name}
    </button>
  )
}
