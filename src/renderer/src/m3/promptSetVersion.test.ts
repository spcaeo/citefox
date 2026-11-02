import { describe, expect, it } from 'vitest'
import {
  promptSetVersionGroup,
  promptSetVersionLabel,
  readPromptSetVersion,
  samePromptSetVersion
} from './promptSetVersion'

describe('promptSetVersionLabel', () => {
  it('renders null, missing, 0, and non-integers as version unknown', () => {
    expect(promptSetVersionLabel(null)).toBe('version unknown')
    expect(promptSetVersionLabel(undefined)).toBe('version unknown')
    expect(promptSetVersionLabel(0)).toBe('version unknown')
    expect(promptSetVersionLabel(-1)).toBe('version unknown')
    expect(promptSetVersionLabel(1.5)).toBe('version unknown')
    expect(promptSetVersionLabel(Number.NaN)).toBe('version unknown')
    expect(promptSetVersionLabel(Number.POSITIVE_INFINITY)).toBe('version unknown')
  })

  it('renders a saved version as vN', () => {
    expect(promptSetVersionLabel(1)).toBe('v1')
    expect(promptSetVersionLabel(2)).toBe('v2')
  })

  it('groups unknown values together and does not treat null as 0', () => {
    expect(promptSetVersionGroup(null)).toBeNull()
    expect(promptSetVersionGroup(undefined)).toBeNull()
    expect(promptSetVersionGroup(0)).toBeNull()
    expect(promptSetVersionGroup(1.5)).toBeNull()
    expect(promptSetVersionGroup(2)).toBe(2)
    expect(samePromptSetVersion(null, null)).toBe(true)
    expect(samePromptSetVersion(null, undefined)).toBe(true)
    expect(samePromptSetVersion(null, 0)).toBe(true)
    expect(samePromptSetVersion(0, 1.5)).toBe(true)
    expect(samePromptSetVersion(null, 2)).toBe(false)
    expect(samePromptSetVersion(2, 2)).toBe(true)
    expect(samePromptSetVersion(2, 3)).toBe(false)
    expect(readPromptSetVersion(null)).toBeNull()
    expect(readPromptSetVersion(undefined)).toBeNull()
    expect(readPromptSetVersion(0)).toBe(0)
    expect(readPromptSetVersion(2)).toBe(2)
  })
})
