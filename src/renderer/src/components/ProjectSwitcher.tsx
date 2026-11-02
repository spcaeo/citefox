import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { ProjectSummary } from '@shared/domain'
import { filterProjects, projectMenuDetail, projectMenuLabel } from '../shell/model'
import { sectionHash, type SectionId } from '../shell/routes'
import { SiteIcon } from '../siteIcon/SiteIcon'
import { FoxMark, Icon } from './Icon'
import { useDialog } from './useDialog'

export function ProjectSwitcher({
  projects,
  active,
  onSelect,
  compact = false
}: {
  projects: readonly ProjectSummary[]
  active: ProjectSummary | null
  onSelect: (projectId: string) => void
  /** The collapsed sidebar rail: the button shows the project's initial only. */
  compact?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const matches = filterProjects(projects, query)
  const name = active?.name ?? 'No project'
  const domain = active?.domain ?? 'No website yet'

  const menuRef = useDialog<HTMLDivElement>({
    active: open,
    trap: false,
    restoreFocus: false,
    initialFocus: searchRef,
    onClose: () => {
      setOpen(false)
      buttonRef.current?.focus()
    }
  })

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent): void {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onHash(): void {
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('hashchange', onHash)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('hashchange', onHash)
    }
  }, [open])

  function choose(projectId: string): void {
    onSelect(projectId)
    setOpen(false)
    setQuery('')
    buttonRef.current?.focus()
  }

  return (
    <div className="pm-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="proj"
        aria-label={`Switch project, ${name} ${domain}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        data-tip={compact ? `${name} · ${domain}` : undefined}
      >
        <span className="proj-avatar" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="proj-copy">
          <span className="proj-name">{name}</span>{' '}
          <span className="faint proj-domain">
            {active?.domain ? <SiteIcon domain={active.domain} spaced /> : null}
            {domain}
          </span>
        </span>
        <Icon name="chevrons" faint />
      </button>
      {open ? (
        <div ref={menuRef} className="pm" id={menuId} role="group" aria-label="Projects">
          <div className="pm-head">
            <span>Projects</span>
            <span className="mono">{matches.length}</span>
          </div>
          <label className="pm-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Find project"
              aria-label="Find project"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {matches.map((project) => {
            const current = project.id === active?.id
            return (
              <button
                key={project.id}
                type="button"
                className={current ? 'pm-item cur' : 'pm-item'}
                aria-current={current ? 'true' : undefined}
                onClick={() => choose(project.id)}
              >
                <span
                  className={project.status === 'active' ? 'dot dot-on' : 'dot dot-off'}
                  aria-hidden="true"
                />
                <span className="pm-meta">
                  <span className="pm-meta-name">{projectMenuLabel(project)}</span>
                  <span className="mono faint proj-domain">
                    {project.domain ? <SiteIcon domain={project.domain} spaced /> : null}
                    {projectMenuDetail(project)}
                  </span>
                </span>
                {current ? <Icon name="check" strong /> : null}
              </button>
            )
          })}
          {matches.length === 0 ? (
            <p className="faint pm-empty">No project matches &quot;{query}&quot;.</p>
          ) : null}
          <div className="pm-sep" />
          <MenuLink section="projects" icon={<Icon name="folder" />}>
            All projects
          </MenuLink>
          <MenuLink section="new-project" icon={<Icon name="plus" />} tone="new">
            New project
          </MenuLink>
          <MenuLink section="project-settings" icon={<Icon name="sliders" />}>
            Project settings
          </MenuLink>
        </div>
      ) : null}
    </div>
  )
}

function MenuLink({
  section,
  icon,
  tone,
  children
}: {
  section: SectionId
  icon: JSX.Element
  tone?: 'new'
  children: string
}): JSX.Element {
  const className = tone === 'new' ? 'pm-link pm-link-new' : 'pm-link'
  return (
    <a className={className} href={sectionHash(section)}>
      {icon}
      {children}
    </a>
  )
}

export function BrandLink({ href }: { href: string }): JSX.Element {
  return (
    <a className="brand" href={href}>
      <FoxMark />
      <span className="brand-text">CiteFox</span>
    </a>
  )
}
