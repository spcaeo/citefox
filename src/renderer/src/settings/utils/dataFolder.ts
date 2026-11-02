import type { DesktopPlatform } from '../../alerts/model'

/** What the Settings → Data reveal button is called on this system. */
export function dataFolderLabel(platform: DesktopPlatform): string {
  if (platform === 'mac') return 'Show in Finder'
  if (platform === 'windows') return 'Show in Explorer'
  return 'Open data folder'
}
