import { useEffect, useState } from 'react'
import type { QuestionTarget } from '@shared/ipc'
import { promptOptions, type PromptOption } from '../../progress/model'
import type { FixDrawerSource } from './source'

/** The questions of one other page or topic a fix carries (a page fix's topic questions). */
export interface AlsoGroup {
  id: string
  name: string
  kind: QuestionTarget['kind']
  options: PromptOption[]
}

/**
 * The questions of the other pages and topics a fix carries (`fix.also`, or where an
 * edited fix's searches are asked), each loaded with `prompts:list`. A page or topic
 * that fails to load is left out: its questions stay picked but are not listed.
 */
export function useAlsoQuestions(
  client: FixDrawerSource,
  projectId: string,
  ids: readonly string[],
  targets: readonly QuestionTarget[]
): { groups: AlsoGroup[]; loading: boolean } {
  const key = ids.join(',')
  const [loaded, setLoaded] = useState<{ key: string; groups: AlsoGroup[] } | null>(null)

  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',')
    if (wanted.length === 0) return
    let live = true
    void Promise.all(
      wanted.map((id) =>
        Promise.resolve()
          .then(() => client['prompts:list']({ projectId, pageId: id }))
          .then(
            (view) => {
              const target = targets.find((item) => item.id === id)
              if (target === undefined) return null
              return {
                id,
                name: target.name,
                kind: target.kind,
                options: promptOptions(view, target.marketIds[0] ?? null)
              }
            },
            () => null
          )
      )
    ).then((groups) => {
      if (live) setLoaded({ key, groups: groups.filter((group) => group !== null) })
    })
    return () => {
      live = false
    }
    // Targets only name the groups; a reload of them never re-reads the questions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, key])

  if (key === '') return { groups: [], loading: false }
  if (loaded === null || loaded.key !== key) return { groups: [], loading: true }
  return { groups: loaded.groups, loading: false }
}
