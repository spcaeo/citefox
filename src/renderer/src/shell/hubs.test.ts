import { describe, expect, it } from 'vitest'
import { hubFor, PAGES_HUB, SETTINGS_HUB, visibleHubTabs } from './hubs'

describe('Pages and Settings hubs', () => {
  it('puts each old sidebar screen under its hub, on its own tab', () => {
    expect(hubFor('youtube')).toEqual({ hub: PAGES_HUB, tab: 'youtube' })
    expect(hubFor('communities')).toEqual({ hub: PAGES_HUB, tab: 'communities' })
    expect(hubFor('structure')).toEqual({ hub: PAGES_HUB, tab: 'pages' })
    expect(hubFor('project-settings')).toEqual({ hub: SETTINGS_HUB, tab: 'project-settings' })
    expect(hubFor('connections')).toEqual({ hub: SETTINGS_HUB, tab: 'connections' })
    expect(hubFor('settings')).toEqual({ hub: SETTINGS_HUB, tab: 'settings' })
    expect(hubFor('permissions')).toEqual({ hub: SETTINGS_HUB, tab: 'settings' })
    expect(hubFor('templates')).toEqual({ hub: SETTINGS_HUB, tab: 'project-settings' })
    expect(hubFor('overview')).toBeNull()
    expect(hubFor('alerts')).toBeNull()
  })

  it('shows Playground only in a development build, or while it is open', () => {
    const labels = (dev: boolean, current: 'settings' | 'playground'): string[] =>
      visibleHubTabs(SETTINGS_HUB, current, dev).map((tab) => tab.label)
    expect(labels(false, 'settings')).toEqual(['Project settings', 'Connections', 'App settings'])
    expect(labels(true, 'settings')).toContain('Playground')
    expect(labels(false, 'playground')).toContain('Playground')
  })
})
