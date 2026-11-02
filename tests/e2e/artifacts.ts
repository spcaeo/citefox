import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Directory for e2e screenshots and JSON dumps.
 * `CITEFOX_E2E_ARTIFACTS` overrides the default, which is git-ignored
 * (`test-results/` in .gitignore).
 */
export function e2eArtifactsDir(): string {
  const configured = process.env.CITEFOX_E2E_ARTIFACTS?.trim()
  if (configured) return path.resolve(configured)
  return path.resolve(process.cwd(), 'test-results', 'e2e')
}

/** Create the artifact directory and return `name` inside it. */
export async function e2eArtifact(name: string): Promise<string> {
  const dir = e2eArtifactsDir()
  await mkdir(dir, { recursive: true })
  return path.join(dir, name)
}
