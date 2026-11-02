import { useCallback, useEffect, useState } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import { explainReportsError, type AccountOption, type Explained } from './scheduleModel'
import type { SchedulesClient } from './schedulesClient'

/** What could not be loaded. The lists it covers hide their "none yet" lines. */
export interface LoadProblem {
  title: string
  message: string
  schedules: boolean
  deliveries: boolean
}

export interface ReportsData {
  items: readonly ReportScheduleListItem[]
  deliveries: readonly DeliveryRecord[]
  accounts: readonly AccountOption[]
  problem: LoadProblem | null
  loaded: boolean
  reload: () => Promise<void>
  /** Drops a deleted schedule before the reload lands. */
  setItems: (
    update: (items: readonly ReportScheduleListItem[]) => readonly ReportScheduleListItem[]
  ) => void
}

interface Loaded {
  items: readonly ReportScheduleListItem[]
  deliveries: readonly DeliveryRecord[]
  accounts: readonly AccountOption[]
  problem: LoadProblem | null
}

function explainedText(explained: Explained): string {
  return explained.nextStep ? `${explained.reason} ${explained.nextStep}` : explained.reason
}

async function load(client: SchedulesClient): Promise<Loaded> {
  const [listed, history, accounts] = await Promise.all([
    client.listSchedules(),
    client.listDeliveries(),
    client.listAccounts().then(
      (rows) => ({ rows, unavailable: null }),
      (error: unknown) => ({ rows: [], unavailable: explainReportsError(error) })
    )
  ])
  const listFailure = listed.unavailable ?? history.unavailable
  const problem: LoadProblem | null = listFailure
    ? {
        title: 'Could not load your scheduled reports.',
        message: explainedText(listFailure),
        schedules: listed.unavailable !== null,
        deliveries: history.unavailable !== null
      }
    : accounts.unavailable
      ? {
          title: 'Could not load your email accounts.',
          message: `${explainedText(accounts.unavailable)} New schedules use the default sender until they load.`,
          schedules: false,
          deliveries: false
        }
      : null
  return { items: listed.rows, deliveries: history.rows, accounts: accounts.rows, problem }
}

/** Reports' schedules, deliveries and sending accounts, loaded once and on `reload`. */
export function useReportsData(client: SchedulesClient): ReportsData {
  const [data, setData] = useState<Loaded>({
    items: [],
    deliveries: [],
    accounts: [],
    problem: null
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void load(client).then((next) => {
      if (cancelled) return
      setData(next)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [client])

  const reload = useCallback(async (): Promise<void> => {
    const next = await load(client)
    setData(next)
    setLoaded(true)
  }, [client])

  const setItems = useCallback(
    (update: (items: readonly ReportScheduleListItem[]) => readonly ReportScheduleListItem[]) =>
      setData((current) => ({ ...current, items: update(current.items) })),
    []
  )

  return { ...data, loaded, reload, setItems }
}
