import { pluralize } from '@shared/pluralize'
import type { BuildTools } from '../buildMenu/buildClient'
import { errorText } from '../components/errorText'
import { drawerHref } from '../shell/drawers'
import { pageHash } from '../shell/routes'
import type { CheckNowSource } from '../checkNow/source'

/**
 * Setup steps after which typed questions can be added: the drafted questions
 * are saved (so the typed ones are carried into every later version), and the
 * last step.
 */
const READY_STEPS = new Set<string>(['prompts', 'coverage'])
const LAST_STEP = 'coverage'

/**
 * Adds the questions typed in Add a page. A page added a moment ago has no
 * buyer profile yet (`prompts:addQuestions` needs one), so this tries once,
 * then again each time the page's setup finishes a step that leaves a
 * profile and drafted questions, until they are added or setup gives up. The toast says how it went.
 * Returns a stop function (the window keeps it running after the drawer closes).
 */
export function addQuestionsWhenReady(
  source: Pick<CheckNowSource, 'prompts:addQuestions' | 'setup:progress'>,
  notify: BuildTools['notify'],
  projectId: string,
  pageId: string,
  questions: readonly string[]
): () => void {
  let done = false
  let trying = false
  let stop: () => void = () => undefined
  const link = { label: 'See questions', href: pageHash(pageId, 'prompts') }

  const finish = (): void => {
    done = true
    stop()
  }

  const attempt = (last: boolean): void => {
    if (done || trying) return
    trying = true
    Promise.resolve()
      .then(() =>
        source['prompts:addQuestions']({
          projectId,
          pageId,
          questions: questions.map((text) => ({ text }))
        })
      )
      .then(
        (result) => {
          trying = false
          finish()
          notify(`Added ${pluralize(result.promptIds.length, 'question')} you typed`, 'ok', link)
        },
        (cause: unknown) => {
          trying = false
          if (!last) return
          finish()
          notify(errorText(cause, 'Your questions were not added.'), 'bad', {
            label: 'Add them',
            href: drawerHref('add-questions', { target: pageId }, pageHash(pageId, 'prompts'))
          })
        }
      )
  }

  stop = source['setup:progress']((event) => {
    if (done || event.projectId !== projectId || event.pageId !== pageId) return
    if (event.state === 'failed') {
      attempt(true)
      return
    }
    if (event.state === 'done' && READY_STEPS.has(event.step)) attempt(event.step === LAST_STEP)
  })
  attempt(false)
  return finish
}
