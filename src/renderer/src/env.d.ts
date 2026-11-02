/// <reference types="vite/client" />

import type { CiteFoxApi } from '@shared/ipc'

declare global {
  interface ImportMetaEnv {
    /** `1` in the e2e build, so `citefox.client=mock` works there. Unset in a release build. */
    readonly VITE_CITEFOX_E2E_MOCKS?: string
    /** `1` in the browser demo's recording build (vite.demo.config.ts, Docs/DEMO.md). */
    readonly VITE_CITEFOX_DEMO_RECORD?: string
  }

  interface Window {
    citefox: CiteFoxApi
  }
}

export {}
