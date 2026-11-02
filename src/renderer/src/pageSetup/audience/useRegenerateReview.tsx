import { useState, type JSX } from 'react'
import type { BuyerProfile } from '@shared/domain'
import type { ShellClient } from '../../projects/client'
import { DrawerLevel } from '../../shell/DrawerLevel'
import { openDrawer, useDrawerEntry } from '../../shell/drawers'
import { pageGenerationRequest } from '../../templates/model'
import { showUndo } from '../../ui'
import { PROFILE_PARTS, partsPatch, type ProfilePatch } from './model'
import { ProfileDiffDrawer, ProfileDiffMissing } from './ProfileDiffDrawer'

export interface RegenerateReviewOptions {
  client: ShellClient
  projectId: string
  pageId: string
  templateId: string
  profile: BuyerProfile | null | undefined
  setProfile: (profile: BuyerProfile) => void
  /** Before the review drawer opens (closes Profile settings). */
  beforeReview: () => void
}

export interface RegenerateReview {
  /**
   * Writes the profile when there is none. Otherwise asks Claude for a new
   * one, keeps the saved profile, and opens the side-by-side review.
   */
  regenerate: () => Promise<void>
  /** The review drawer while `?drawer=profile-diff` is open. */
  drawer: JSX.Element | null
}

/** Regenerate without losing the person's profile: review, apply, Undo. */
export function useRegenerateReview({
  client,
  projectId,
  pageId,
  templateId,
  profile,
  setProfile,
  beforeReview
}: RegenerateReviewOptions): RegenerateReview {
  const [candidate, setCandidate] = useState<{
    before: BuyerProfile
    after: BuyerProfile
  } | null>(null)
  const entry = useDrawerEntry('profile-diff')

  async function write(patch: ProfilePatch): Promise<BuyerProfile> {
    const next = await client.updateBuyerProfile({ projectId, pageId, ...patch })
    setProfile(next)
    return next
  }

  async function regenerate(): Promise<void> {
    const request = pageGenerationRequest(projectId, pageId, templateId)
    if (!profile) {
      setProfile(await client.generateBuyerProfile(request))
      return
    }
    const before = profile
    const after = await client.generateBuyerProfile({ ...request, fresh: true })
    // Generating saved the new profile; the old points stay until the person applies.
    const kept = await write(partsPatch(before, PROFILE_PARTS))
    setCandidate({ before: kept, after })
    beforeReview()
    openDrawer('profile-diff', { pdiff: after.id })
  }

  function close(): void {
    setCandidate(null)
    entry?.close()
  }

  let drawer: JSX.Element | null = null
  if (entry) {
    const shown = candidate !== null && candidate.after.id === entry.entry.params.pdiff
    drawer = (
      <DrawerLevel depth={entry.depth}>
        {shown ? (
          <ProfileDiffDrawer
            before={candidate.before}
            after={candidate.after}
            onClose={close}
            onApply={async (patch) => {
              const previous = candidate.before
              await write(patch)
              close()
              showUndo({
                message: 'Applied the new buyer profile.',
                effect: 'Saved questions stay as they are until you rewrite them.',
                testId: 'profile-diff-toast',
                undo: async () => {
                  await write(partsPatch(previous, PROFILE_PARTS))
                }
              })
            }}
          />
        ) : (
          <ProfileDiffMissing onClose={close} />
        )}
      </DrawerLevel>
    )
  }

  return { regenerate, drawer }
}
