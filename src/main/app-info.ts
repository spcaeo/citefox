import type { AppBuild, AppInfo } from '@shared/ipc'
import packageJson from '../../package.json'

/**
 * What `app:getInfo` serves: the version from package.json (bumped on purpose)
 * and the build stamped at bundle time. The footer release line is made from
 * exactly these facts, so the served line always matches the release on disk.
 */
export function makeAppInfo(build: AppBuild, testProfile: boolean): AppInfo & { build: AppBuild } {
  return { name: 'CiteFox', version: packageJson.version, build, testProfile }
}
