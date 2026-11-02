import { describe, expect, it } from 'vitest'
import {
  changelogFromCommits,
  changelogSection,
  insertRelease,
  nextVersion,
  parseCommit,
  releaseNotes,
  setLockVersion,
  setPackageVersion,
  torontoDate,
  unreleasedBody
} from '../../scripts/release'

describe('nextVersion', () => {
  it('bumps a stable version', () => {
    expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4')
    expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
    expect(nextVersion('0.12.0', 'minor')).toBe('0.13.0')
  })

  it('starts and counts up a beta line', () => {
    expect(nextVersion('1.2.3', 'minor', true)).toBe('1.3.0-beta.1')
    expect(nextVersion('1.3.0-beta.1', 'minor', true)).toBe('1.3.0-beta.2')
    expect(nextVersion('1.3.0-beta.2', 'patch', true)).toBe('1.3.0-beta.3')
    expect(nextVersion('1.2.3', 'patch', true)).toBe('1.2.4-beta.1')
  })

  it('graduates a beta to its stable version', () => {
    expect(nextVersion('1.3.0-beta.4', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.3.0-beta.4', 'patch')).toBe('1.3.0')
    expect(nextVersion('2.0.0-beta.1', 'major')).toBe('2.0.0')
  })

  it('starts a new line when the bump is bigger than the beta', () => {
    expect(nextVersion('1.2.4-beta.1', 'minor')).toBe('1.3.0')
    expect(nextVersion('1.3.0-beta.2', 'major')).toBe('2.0.0')
    expect(nextVersion('1.3.0-beta.2', 'major', true)).toBe('2.0.0-beta.1')
  })

  it('rejects versions it cannot read', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow(/Not a version/)
    expect(() => nextVersion('1.2.3-rc', 'patch')).toThrow(/Not a version/)
  })
})

describe('parseCommit', () => {
  it('reads type, scope and breaking marks', () => {
    expect(parseCommit({ subject: 'feat(reports): add a share link', body: '' })).toEqual({
      type: 'feat',
      scope: 'reports',
      breaking: false,
      subject: 'add a share link'
    })
    expect(parseCommit({ subject: 'fix!: drop old exports', body: '' }).breaking).toBe(true)
    expect(
      parseCommit({ subject: 'feat: new store', body: 'BREAKING CHANGE: old data is moved' })
        .breaking
    ).toBe(true)
  })

  it('keeps a commit without a type as other', () => {
    expect(parseCommit({ subject: 'Summary fits one row', body: '' })).toEqual({
      type: 'other',
      scope: null,
      breaking: false,
      subject: 'Summary fits one row'
    })
  })
})

describe('changelogFromCommits', () => {
  it('groups user-facing changes and leaves chores out', () => {
    const text = changelogFromCommits([
      { subject: 'feat(reports): add a share link.', body: '' },
      { subject: 'fix: chart labels overlap', body: '' },
      { subject: 'fix: chart labels overlap', body: '' },
      { subject: 'perf: open big projects faster', body: '' },
      { subject: 'chore: bump deps', body: '' },
      { subject: 'ci: cache npm', body: '' },
      { subject: 'docs: typo', body: '' },
      { subject: "Merge branch 'x' into main", body: '' },
      { subject: 'feat!: projects move to a new folder', body: '' },
      { subject: 'Tidy the header', body: '' }
    ])
    expect(text).toBe(
      [
        '### Important',
        '',
        '- Projects move to a new folder',
        '',
        '### New',
        '',
        '- Add a share link',
        '',
        '### Fixed',
        '',
        '- Chart labels overlap',
        '',
        '### Faster',
        '',
        '- Open big projects faster',
        '',
        '### Other changes',
        '',
        '- Tidy the header'
      ].join('\n')
    )
  })

  it('is empty when nothing is user-facing', () => {
    expect(changelogFromCommits([{ subject: 'chore: x', body: '' }])).toBe('')
  })
})

const CHANGELOG = `# Changelog

## Unreleased

### Changed

- Hand-written note.

## 0.12.0 — 2026-10-23

- Older entry.
`

describe('insertRelease', () => {
  it('moves the Unreleased notes and the commit lines under the new version', () => {
    const out = insertRelease(CHANGELOG, '0.13.0', '2026-11-02', '### Fixed\n\n- A fix')
    expect(out).toBe(`# Changelog

## Unreleased

## 0.13.0 — 2026-11-02

### Changed

- Hand-written note.

### Fixed

- A fix

## 0.12.0 — 2026-10-23

- Older entry.
`)
    expect(unreleasedBody(out)).toBe('')
  })

  it('writes a plain line when there is nothing to say', () => {
    const empty = '# Changelog\n\n## Unreleased\n\n## 0.12.0 — 2026-10-23\n\n- Older.\n'
    expect(changelogSection(insertRelease(empty, '0.12.1', '2026-11-02', ''), '0.12.1')).toBe(
      '- Small fixes and improvements.'
    )
  })

  it('adds an Unreleased heading when the file has none', () => {
    const out = insertRelease(
      '# Changelog\n\n## 0.1.0 — 2026-01-01\n\n- First.\n',
      '0.2.0',
      '2026-11-02',
      '### New\n\n- X'
    )
    expect(out).toBe(
      '# Changelog\n\n## Unreleased\n\n## 0.2.0 — 2026-11-02\n\n### New\n\n- X\n\n## 0.1.0 — 2026-01-01\n\n- First.\n'
    )
  })

  it('refuses a version that already has a section', () => {
    expect(() => insertRelease(CHANGELOG, '0.12.0', '2026-11-02', '')).toThrow(/already has/)
  })
})

describe('release notes', () => {
  const released = insertRelease(CHANGELOG, '0.13.0-beta.1', '2026-11-02', '')

  it('takes one version section, not the next one', () => {
    expect(changelogSection(released, '0.13.0-beta.1')).toBe('### Changed\n\n- Hand-written note.')
    expect(changelogSection(released, 'v0.12.0')).toBe('- Older entry.')
    expect(changelogSection(released, '0.12')).toBeNull()
  })

  it('adds the beta warning, the file guide and the unsigned-build steps', () => {
    const notes = releaseNotes(released, '0.13.0-beta.1')
    expect(notes.startsWith('> **Beta.**')).toBe(true)
    expect(notes).toContain('- Hand-written note.')
    expect(notes).toContain('CiteFox-0.13.0-beta.1-mac-universal.dmg')
    expect(notes).toContain('Open Anyway')
    expect(notes).toContain('More info › Run anyway')
    expect(notes).not.toContain('Older entry')
    expect(releaseNotes(released, '0.12.0').startsWith('- Older entry.')).toBe(true)
  })

  it('fails when the version has no section', () => {
    expect(() => releaseNotes(CHANGELOG, '9.9.9')).toThrow(/no "## 9.9.9" section/)
  })
})

describe('version files', () => {
  it('changes only the top-level version in package.json', () => {
    const pkg =
      '{\n  "name": "citefox",\n  "version": "0.12.0",\n  "dependencies": {\n    "x": "1.0.0"\n  },\n  "files": ["a", "b"]\n}\n'
    expect(setPackageVersion(pkg, '0.13.0')).toBe(pkg.replace('"0.12.0"', '"0.13.0"'))
  })

  it('changes the root versions in package-lock.json', () => {
    const lock = JSON.stringify(
      {
        name: 'citefox',
        version: '0.12.0',
        lockfileVersion: 3,
        packages: {
          '': { name: 'citefox', version: '0.12.0' },
          'node_modules/x': { version: '0.12.0' }
        }
      },
      null,
      2
    )
    const out = JSON.parse(setLockVersion(lock, '0.13.0'))
    expect(out.version).toBe('0.13.0')
    expect(out.packages[''].version).toBe('0.13.0')
    expect(out.packages['node_modules/x'].version).toBe('0.12.0')
  })

  it('dates a release in Toronto time', () => {
    // 03:30 UTC on Nov 3 is still Nov 2 in Toronto.
    expect(torontoDate(new Date('2026-11-03T03:30:00Z'))).toBe('2026-11-02')
  })
})
