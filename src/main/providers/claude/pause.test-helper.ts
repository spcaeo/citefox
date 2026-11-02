import { afterEach } from 'vitest'
import { clearClaudeCodePause } from './shared-gate'

// A test that hits a Claude Code limit pauses Claude Code for the whole process
// (`pauseClaudeCode`). Lift it after each test so the next one starts unpaused.
afterEach(() => {
  clearClaudeCodePause()
})
