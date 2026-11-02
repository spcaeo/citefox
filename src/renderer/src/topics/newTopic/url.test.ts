import { describe, expect, it } from 'vitest'
import { clearedNewTopicHash } from './hooks/useNewTopicUrl'
import { parseNewTopicUrl, withNewTopicUrl } from './utils/url'

describe('New topic URL', () => {
  it('reads the dialog values next to dialog=new-topic', () => {
    expect(
      parseNewTopicUrl('#/topics?dialog=new-topic&draft=d1&step=pages&way=competitor')
    ).toEqual({
      draftId: 'd1',
      step: 'pages',
      way: 'competitor',
      questions: [],
      topicId: null,
      help: null,
      bot: null
    })
    expect(parseNewTopicUrl('#/questions?dialog=new-topic&questions=q1,%20q2,,bad id')).toEqual({
      draftId: null,
      step: 'start',
      way: null,
      questions: ['q1', 'q2'],
      topicId: null,
      help: null,
      bot: null
    })
  })

  it('falls back on unknown or malformed values', () => {
    expect(
      parseNewTopicUrl('#/topics?step=nope&way=other&draft=a%20b&topic=&nt.help=x&nt.bot=y')
    ).toEqual({
      draftId: null,
      step: 'start',
      way: null,
      questions: [],
      topicId: null,
      help: null,
      bot: null
    })
  })

  it('writes values and keeps the route and the other keys', () => {
    const hash = withNewTopicUrl('#/p/p1/topics?dialog=new-topic&sort=name', {
      draftId: 'd1',
      step: 'questions',
      way: 'problem'
    })
    expect(hash).toBe(
      '#/p/p1/topics?dialog=new-topic&sort=name&draft=d1&step=questions&way=problem'
    )
    expect(withNewTopicUrl(hash, { step: 'start' })).toBe(
      '#/p/p1/topics?dialog=new-topic&sort=name&draft=d1&way=problem'
    )
    expect(clearedNewTopicHash(hash)).toBe('#/p/p1/topics?dialog=new-topic&sort=name')
  })

  it('keeps the helper way and bot under nt. keys, and clears them on close', () => {
    const hash = withNewTopicUrl('#/topics?drawer=new-topic&help=describe', {
      way: 'problem',
      help: 'chatbot',
      bot: 'perplexity'
    })
    expect(hash).toBe(
      '#/topics?drawer=new-topic&help=describe&way=problem&nt.help=chatbot&nt.bot=perplexity'
    )
    expect(parseNewTopicUrl(hash)).toMatchObject({ help: 'chatbot', bot: 'perplexity' })
    // Add questions' own `help` (under this drawer) is left alone.
    expect(clearedNewTopicHash(hash)).toBe('#/topics?drawer=new-topic&help=describe')
  })
})
