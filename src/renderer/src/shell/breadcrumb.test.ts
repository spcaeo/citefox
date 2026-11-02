import { describe, expect, it } from 'vitest'
import { breadcrumbFor } from './breadcrumb'
import { landingHash, sectionHash } from './routes'

describe('top bar breadcrumb', () => {
  it('names the project and the screen', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'structure' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Pages', href: sectionHash('pages') },
      { label: 'Site structure' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'youtube' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Pages', href: sectionHash('pages') },
      { label: 'YouTube' }
    ])
  })

  it('names the Add wizard and a draft in it', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'add' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Add' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'add', focusId: 'd1' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Add', href: sectionHash('add') },
      { label: 'New topic' }
    ])
  })

  it('names Alerts & schedules as a screen of the project, on every tab', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'alerts' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Alerts & schedules' }
    ])
    expect(
      breadcrumbFor({ kind: 'section', section: 'alerts', focusId: 'email' }, 'TextBolt')
    ).toEqual([{ label: 'TextBolt', href: landingHash() }, { label: 'Alerts & schedules' }])
  })

  it('does not link the project from its own landing (Summary)', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'overview' }, 'TextBolt')).toEqual([
      { label: 'TextBolt' },
      { label: 'Summary' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'pages' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Pages' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'history' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Check history' }
    ])
  })

  it('names an unknown address plainly', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'unavailable' }, 'TextBolt')).toEqual([
      { label: 'Not available' }
    ])
  })

  it('puts every settings screen under Settings (the sidebar’s name)', () => {
    const settings = { label: 'Settings', href: sectionHash('project-settings') }
    expect(breadcrumbFor({ kind: 'section', section: 'connections' }, 'TextBolt')).toEqual([
      settings,
      { label: 'Connections' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'settings' }, 'TextBolt')).toEqual([
      settings,
      { label: 'App settings' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'permissions' }, 'TextBolt')).toEqual([
      settings,
      { label: 'App settings', href: sectionHash('settings') },
      { label: 'What CiteFox needs' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'project-settings' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      settings,
      { label: 'Project settings' }
    ])
    expect(breadcrumbFor({ kind: 'section', section: 'templates' }, 'TextBolt')).toEqual([
      { label: 'TextBolt', href: landingHash() },
      settings,
      { label: 'Project settings', href: sectionHash('project-settings') },
      { label: 'Templates' }
    ])
  })

  it('names a page and what is open under it', () => {
    expect(
      breadcrumbFor({ kind: 'page', pageId: 'p1', tab: 'results' }, 'TextBolt', 'Bulk SMS')
    ).toEqual([{ label: 'TextBolt', href: landingHash() }, { label: 'Bulk SMS' }])
    expect(
      breadcrumbFor({ kind: 'prompt', pageId: 'p1', promptId: 'q1' }, 'TextBolt', null)
    ).toEqual([
      { label: 'TextBolt', href: landingHash() },
      { label: 'Page' },
      { label: 'Question' }
    ])
  })

  it('works before a project exists', () => {
    expect(breadcrumbFor({ kind: 'section', section: 'add-page' }, null)).toEqual([
      { label: 'Add a page to track' }
    ])
  })
})
