import type { BuyerProfile, BuyerPrompt, CoverageMatrix, PromptSetView } from '@shared/domain'
import type {
  AddPromptRequest,
  CoverageRunList,
  CoverageRunRequest,
  EditPromptRequest,
  GenerateBuyerProfileRequest,
  GenerateCoverageRequest,
  GeneratePromptsRequest,
  PageIdRequest,
  PageReadProgress,
  PageReadResult,
  PromptIdRequest,
  ReorderPromptsRequest,
  GapStates,
  SetGapDoneRequest,
  SetGapStatusRequest,
  SetPromptEnabledRequest,
  StartPageReadRequest,
  UpdateBuyerProfileRequest,
  UpdateGapDraftRequest
} from '@shared/ipc'

export interface SetupStore {
  getRead(request: PageIdRequest): PageReadResult | null
  readStart(
    request: StartPageReadRequest,
    emit: (progress: PageReadProgress) => void
  ): PageReadResult
  getProfile(request: PageIdRequest): BuyerProfile | null
  generateProfile(request: GenerateBuyerProfileRequest): Promise<BuyerProfile>
  updateProfile(request: UpdateBuyerProfileRequest): BuyerProfile
  listPrompts(request: PageIdRequest): PromptSetView
  generatePrompts(request: GeneratePromptsRequest): Promise<PromptSetView>
  addPrompt(request: AddPromptRequest): PromptSetView
  editPrompt(request: EditPromptRequest): PromptSetView
  removePrompt(request: PromptIdRequest): PromptSetView
  setPromptEnabled(request: SetPromptEnabledRequest): PromptSetView
  reorderPrompts(request: ReorderPromptsRequest): PromptSetView
  savePrompts(request: PageIdRequest): PromptSetView
  discardPrompts(request: PageIdRequest): PromptSetView
  getGaps(request: PageIdRequest): CoverageMatrix | null
  generateGaps(request: GenerateCoverageRequest): Promise<CoverageMatrix>
  setGapDone(request: SetGapDoneRequest): CoverageMatrix
  redoGap(request: PromptIdRequest): CoverageMatrix
  getGapStates(request: PageIdRequest): GapStates
  updateGapDraft(request: UpdateGapDraftRequest): GapStates
  setGapStatus(request: SetGapStatusRequest): GapStates
  listCoverage(request: PageIdRequest): CoverageRunList
  getCoverage(request: CoverageRunRequest): CoverageMatrix
}

export interface PromptState {
  promptSetId: string | null
  version: number | null
  savedAt: string | null
  templateId: string | null
  templateName: string | null
  templateHash: string | null
  templateUpdatedAt: string | null
  dirty: boolean
  saved: BuyerPrompt[]
  working: BuyerPrompt[]
  /** Kept until the wording changes, so the reference sentence can name an alias. */
  brandMessage: string | null
}

export interface PageState {
  read: PageReadResult | null
  profile: BuyerProfile | null
  prompts: PromptState
  gaps: CoverageMatrix | null
}
