import type { ProjectMemory } from './memory'
import { createSetupContext } from './setup/context'
import { createGapMethods } from './setup/gaps'
import { createProfileMethods } from './setup/profile'
import { createPromptMethods } from './setup/prompts'
import { createReadMethods } from './setup/read'
import type { SetupStore } from './setup/types'

export type { SetupStore } from './setup/types'

/**
 * In-memory page setup for the mock client: page read, buyer profile, prompts,
 * and the coverage matrix. Each part lives in `./setup/` and shares one context.
 */
export function createSetupStore(memory: ProjectMemory): SetupStore {
  const ctx = createSetupContext(memory)
  return {
    ...createReadMethods(ctx),
    ...createProfileMethods(ctx),
    ...createPromptMethods(ctx),
    ...createGapMethods(ctx)
  }
}
