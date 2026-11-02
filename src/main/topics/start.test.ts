import type { TopicProfilePoint } from '@shared/domain'
import { describe, expect, test } from 'vitest'
import { profileBodyFrom } from './start'

function point(section: TopicProfilePoint['section'], text: string): TopicProfilePoint {
  return { id: `${section}-${text}`, section, text, foundIn: null, verify: null, isNew: false }
}

describe('profileBodyFrom', () => {
  test('never writes an empty who or environment when the topic profile has none', () => {
    const body = profileBodyFrom([point('triggers', 'A missed weekend alert')], {
      name: 'Text alerts for teams',
      about: ''
    })
    expect(body.who.length).toBeGreaterThan(0)
    expect(body.who).toContain('Text alerts for teams')
    expect(body.environment.length).toBeGreaterThan(0)
    expect(body.triggers).toEqual(['A missed weekend alert'])
  })

  test('keeps the written who and environment and uses segments before the name', () => {
    expect(
      profileBodyFrom([point('who', 'Office managers'), point('environment', 'Email tools')], {
        name: 'Alerts',
        about: ''
      })
    ).toMatchObject({ who: 'Office managers', environment: 'Email tools' })
    expect(
      profileBodyFrom([point('segments', 'Field teams')], {
        name: 'Alerts',
        about: 'SMS for crews'
      })
    ).toMatchObject({ who: 'Field teams', environment: 'SMS for crews' })
  })
})
