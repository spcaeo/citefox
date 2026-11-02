import type { AppResetResult, OpenTestProfileRequest, OpenTestProfileResult } from '@shared/ipc'

/** What `app:resetKeepKeys` and `app:openTestProfile` call. */
export interface AppTools {
  resetKeepKeys(): AppResetResult
  openTestProfile(request: OpenTestProfileRequest): OpenTestProfileResult
}
