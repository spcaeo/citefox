import { describe, expect, it } from 'vitest'
import { addQuestionsToTopicHash, settingsPatch } from './model'

const topic = { name: 'Gateway shutdowns', status: 'tracked' as const, intervalDays: 14 }

describe('settingsPatch', () => {
  it('is empty when nothing changed (spacing in the name does not count)', () => {
    expect(
      settingsPatch(topic, { name: '  Gateway   shutdowns ', paused: false, intervalDays: 14 })
    ).toEqual({})
  })

  it('carries only the changed fields', () => {
    expect(settingsPatch(topic, { name: 'Gateways', paused: true, intervalDays: 30 })).toEqual({
      name: 'Gateways',
      status: 'paused',
      intervalDays: 30
    })
    expect(
      settingsPatch(
        { ...topic, status: 'paused' },
        { name: 'Gateway shutdowns', paused: false, intervalDays: 14 }
      )
    ).toEqual({ status: 'tracked' })
  })

  it('never sends a blank name', () => {
    expect(settingsPatch(topic, { name: '   ', paused: false, intervalDays: 14 })).toEqual({})
  })
})

describe('addQuestionsToTopicHash', () => {
  it('opens the topic with Add questions aimed at it', () => {
    expect(addQuestionsToTopicHash('topic a')).toBe(
      '#/topics/topic%20a?drawer=add-questions&target=topic%20a'
    )
  })
})
