import { useState } from 'react'
import type { ImportCandidate } from '@shared/ipc'
import { EMPTY_SELECTION } from '../constants'
import type { ImportRule, QuickPicks, RuleOp, SelectionState } from '../types'

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export interface SelectionActions {
  toggleFolder: (folder: string) => void
  toggleCluster: (clusterId: string) => void
  addRule: () => void
  updateRule: (id: number, patch: { op?: RuleOp; value?: string }) => void
  removeRule: (id: number) => void
  togglePick: (pick: keyof QuickPicks) => void
  setAiKeys: (keys: readonly string[]) => void
  addPasted: (rows: readonly ImportCandidate[]) => number
  toggleOff: (key: string) => void
  setOff: (keys: readonly string[], off: boolean) => void
  reset: () => void
}

/** Step 2 choices and preview unticks. Everything adds up; a page counts once. */
export function useSelection(): [SelectionState, SelectionActions] {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION)
  const [nextRule, setNextRule] = useState(1)

  const actions: SelectionActions = {
    toggleFolder: (folder) =>
      setState((current) => ({ ...current, folders: toggled(current.folders, folder) })),
    toggleCluster: (clusterId) =>
      setState((current) => ({ ...current, clusters: toggled(current.clusters, clusterId) })),
    addRule: () => {
      const rule: ImportRule = { id: nextRule, op: 'contains', value: '' }
      setNextRule(nextRule + 1)
      setState((current) => ({ ...current, rules: [...current.rules, rule] }))
    },
    updateRule: (id, patch) =>
      setState((current) => ({
        ...current,
        rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
      })),
    removeRule: (id) =>
      setState((current) => ({
        ...current,
        rules: current.rules.filter((rule) => rule.id !== id)
      })),
    togglePick: (pick) =>
      setState((current) => ({
        ...current,
        picks: { ...current.picks, [pick]: !current.picks[pick] }
      })),
    setAiKeys: (keys) => setState((current) => ({ ...current, aiKeys: [...keys] })),
    addPasted: (rows) => {
      const known = new Set(state.pasted.map((row) => row.url))
      const fresh = rows.filter((row) => !known.has(row.url))
      setState((current) => ({ ...current, pasted: [...current.pasted, ...fresh] }))
      return fresh.length
    },
    toggleOff: (key) => setState((current) => ({ ...current, off: toggled(current.off, key) })),
    setOff: (keys, off) =>
      setState((current) => {
        const set = new Set(current.off)
        for (const key of keys) {
          if (off) set.add(key)
          else set.delete(key)
        }
        return { ...current, off: [...set] }
      }),
    reset: () => setState(EMPTY_SELECTION)
  }
  return [state, actions]
}
