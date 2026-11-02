import { afterEach } from 'vitest'
import { withDrawersClosed } from './drawerUrl'
import { resetDrawersForTests } from './drawers'
import { resetUndoToastForTests } from '../ui/undoStore'

/*
 * Vitest setup (vitest.config.mts): drawers live on the URL and in a
 * module-level store, so a drawer one test leaves open would reopen in the
 * next test of the same file. After each test in a DOM environment, the
 * drawers leave the URL and the store forgets them. Other URL state is left
 * to the tests that set it.
 */
afterEach(() => {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return
  const hash = window.location.hash
  if (hash.includes('drawer=') || hash.includes('dialog=')) {
    window.history.replaceState(null, '', withDrawersClosed(hash, 0) || '#')
  }
  resetDrawersForTests()
  // The window-wide Undo toast is a module store too.
  resetUndoToastForTests()
})
