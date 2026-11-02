import { structureChannels, type CiteFoxApi } from '@shared/ipc'

type StructureInvoke = Extract<keyof typeof structureChannels, keyof CiteFoxApi>
type StructureChannel =
  StructureInvoke | 'sitemaps:syncFinished' | 'status:getCapsule' | 'projects:get'

/**
 * The channels Import pages and Site structure call: the structure area, the
 * sync-finished push, the capsule (searches left), and the project.
 * Production forwards to the preload allow-list; tests pass another object.
 */
export type StructureClient = Pick<CiteFoxApi, StructureChannel>

const CHANNELS: readonly StructureChannel[] = [
  ...(Object.keys(structureChannels) as StructureInvoke[]),
  'sitemaps:syncFinished',
  'status:getCapsule',
  'projects:get'
]

export function createStructureClient(): StructureClient {
  const api = (): CiteFoxApi => {
    if (typeof window === 'undefined' || !window.citefox) {
      throw new Error('The preload bridge is missing.')
    }
    return window.citefox
  }
  const client: Partial<Record<StructureChannel, (...args: unknown[]) => unknown>> = {}
  for (const channel of CHANNELS) {
    client[channel] = (...args: unknown[]) =>
      (api()[channel] as (...rest: unknown[]) => unknown)(...args)
  }
  return client as StructureClient
}
