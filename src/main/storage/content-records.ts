/**
 * Snapshots, buyer profiles, prompt sets, coverage, and generation usage.
 * Returned profiles, prompt sets, and matrices are the shared M2 types.
 * The snapshot row also keeps the body, which `PageReadResult` does not carry.
 */

export {
  getLatestBuyerProfile,
  getLatestSnapshot,
  getStoredSnapshot,
  insertBuyerProfile,
  insertSnapshot,
  setSnapshotEligibility,
  setSnapshotSummary
} from './snapshot-records'
export type { StoredSnapshot } from './snapshot-records'
export {
  activatePromptSet,
  getLatestPromptSet,
  getPromptSetVersion,
  insertPromptSet,
  listSavedPromptSets,
  nextPromptSetVersion
} from './prompt-set-records'
export type { NewPromptSet } from './prompt-set-records'
export {
  getCoverageRun,
  getLatestCoverage,
  insertCoverage,
  listCoverageRuns,
  updateCoverageRow
} from './coverage-records'
export {
  STORED_GENERATION_KINDS,
  getCachedGeneration,
  insertGeneration,
  listGenerations
} from './generation-records'
export type { CachedGeneration, GenerationRecord, StoredGenerationKind } from './generation-records'
