import { useCallback, useEffect, useState } from 'react'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import type { SchedulesClient } from '../../schedulesClient'
import type { AccountOption } from '../../scheduleModel'

export interface SchedulesData {
  items: readonly ReportScheduleListItem[]
  deliveries: readonly DeliveryRecord[]
  accounts: readonly AccountOption[]
  loaded: boolean
  reload: () => Promise<void>
}

interface Loaded {
  items: readonly ReportScheduleListItem[]
  deliveries: readonly DeliveryRecord[]
  accounts: readonly AccountOption[]
}

const EMPTY: Loaded = { items: [], deliveries: [], accounts: [] }

async function load(client: SchedulesClient): Promise<Loaded> {
  const [listed, history, senders] = await Promise.all([
    client.listSchedules(),
    client.listDeliveries(),
    client.listAccounts().catch(() => [] as readonly AccountOption[])
  ])
  return { items: listed.rows, deliveries: history.rows, accounts: senders }
}

/**
 * Schedules, deliveries and sending accounts for a schedule drawer opened
 * outside Reports (Export's "Schedule this"). Loads only while `active`.
 */
export function useSchedulesData(client: SchedulesClient | null, active: boolean): SchedulesData {
  const [data, setData] = useState<Loaded>(EMPTY)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!active || loaded || !client) return
    let live = true
    void load(client).then((next) => {
      if (!live) return
      setData(next)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [active, loaded, client])

  const reload = useCallback(async (): Promise<void> => {
    if (!client) return
    setData(await load(client))
    setLoaded(true)
  }, [client])

  return { ...data, loaded, reload }
}
