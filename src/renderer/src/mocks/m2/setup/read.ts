import type { PageReadResult } from '@shared/ipc'
import { snapshotReused, wordCount } from '../../../pageSetup/model'
import { ALERTS_CONTENT_HASH, ALERTS_PAGE_ID, alertsRead, failedRead } from '../textboltPage'
import type { SetupContext } from './context'
import { channelError, clone, hashText, methodFor } from './helpers'
import type { SetupStore } from './types'

/** `pages:getRead` and `pages:readStart`. */
export function createReadMethods(ctx: SetupContext): Pick<SetupStore, 'getRead' | 'readStart'> {
  const { memory, nextId, now, requirePage, stateFor } = ctx
  return {
    getRead(request) {
      requirePage(request, 'pages:getRead')
      const read = stateFor(request.pageId).read
      return read ? clone(read) : null
    },

    readStart(request, emit) {
      requirePage(request, 'pages:readStart')
      const page = memory.getPage(request.projectId, request.pageId)
      const state = stateFor(request.pageId)
      if (request.reader === 'file' && !request.suppliedText?.trim()) {
        throw channelError('pages:readStart', 'Choose a file that contains the page.')
      }
      const failed = request.reader !== 'file' && request.pageId !== ALERTS_PAGE_ID
      emit({
        pageId: request.pageId,
        phase: 'fetch',
        state: 'running',
        detail: 'Fetching the page…',
        nextStep: null
      })
      emit({
        pageId: request.pageId,
        phase: 'fetch',
        state: failed ? 'warning' : 'ok',
        detail: failed ? 'The fetch did not return a document.' : 'Fetched the page.',
        nextStep: failed ? 'Try reading it again, or supply the page as a file.' : null
      })
      if (!failed) {
        emit({
          pageId: request.pageId,
          phase: 'extract',
          state: 'running',
          detail: 'Extracting the title, outline, and FAQs…',
          nextStep: null
        })
        emit({
          pageId: request.pageId,
          phase: 'extract',
          state: 'ok',
          detail: 'Extracted the title, outline, and FAQs.',
          nextStep: null
        })
        emit({
          pageId: request.pageId,
          phase: 'summary',
          state: 'running',
          detail: 'Summarizing what the page promises…',
          nextStep: null
        })
        emit({
          pageId: request.pageId,
          phase: 'summary',
          state: 'ok',
          detail: 'Summarized what the page promises.',
          nextStep: null
        })
      }

      let result: PageReadResult
      if (request.reader === 'file') {
        const text = request.suppliedText ?? ''
        const title =
          text
            .split('\n')
            .find((line) => line.trim())
            ?.trim() ?? 'Supplied file'
        result = {
          ...failedRead(request.pageId),
          id: nextId('snap'),
          method: 'file',
          httpStatus: null,
          durationMs: 40,
          title,
          titleLength: title.length,
          h1: title,
          titleMatchesH1: true,
          wordCount: wordCount(text),
          contentHash: hashText(text),
          message: 'Page read from the file you supplied.',
          nextStep: null,
          fetchedAt: now()
        }
      } else if (failed) {
        result = failedRead(request.pageId)
        result.method = request.reader === 'jina' ? 'jina' : 'direct'
        result.fetchedAt = now()
        if (request.reader === 'jina') {
          result.message = 'The second read could not open this page either.'
          result.nextStep = 'Supply the page as a file.'
        }
      } else {
        const previous = state.read
        const reused = snapshotReused(previous?.contentHash ?? null, ALERTS_CONTENT_HASH)
        result = alertsRead(
          reused
            ? 'Page read. Same snapshot. The content fingerprint did not change.'
            : 'Page read.'
        )
        result.method = methodFor(request.reader)
        if (reused && previous) {
          result.id = previous.id
          result.snapshotReused =
            result.contentHash === previous.contentHash && result.id === previous.id
        }
      }

      state.read = result
      if (result.nextStep === null) {
        memory.noteSetup(request.projectId, request.pageId, {
          snapshotId: result.id,
          title: page.title ?? result.title,
          setupStep: page.setupStep === 'read' ? 'profile' : page.setupStep
        })
      }
      return clone(result)
    }
  }
}
