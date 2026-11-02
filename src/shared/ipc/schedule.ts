/** Re-check schedules and the due list. */

import type { AppSchedule, DueList, IntervalDays, ProjectSchedule } from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** `schedule:listDue`. Null `projectId` is every project (the tray and the headless pass). */
export interface DueListRequest {
  projectId: string | null
}

/** Fields of {@link AppSchedule}. Omitted fields stay as they are. */
export type AppSchedulePatch = Partial<{
  startAtLogin: boolean
  catchUpAfterSleep: boolean
  checkWhenClosed: boolean
  dailyCheckTime: string
}>

/**
 * `schedule:updateProject`. Omitted fields stay as they are. `paused` is pause and resume for the project.
 * Pausing leaves `nextCheckAt` set (the next check after resume) and sets `pagesDueToday` to 0.
 */
export interface UpdateProjectScheduleRequest {
  projectId: string
  defaultIntervalDays?: IntervalDays
  dailyCheckTime?: string
  quietFrom?: string | null
  quietUntil?: string | null
  spreadAcrossDay?: boolean
  catchUp?: boolean
  paused?: boolean
}

/** Invoke channels for this area. Each one is declared here only. */
export const scheduleChannels = {
  'schedule:getApp': invoke<AppSchedule>(),
  'schedule:updateApp': invokeWith<AppSchedulePatch, AppSchedule>(),
  'schedule:getProject': invokeWith<ProjectIdRequest, ProjectSchedule>(),
  'schedule:updateProject': invokeWith<UpdateProjectScheduleRequest, ProjectSchedule>(),
  'schedule:listDue': invokeWith<DueListRequest, DueList>()
} as const satisfies InvokeChannelSpecs
