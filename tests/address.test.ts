// Which addresses, branch names and repository paths the plugin accepts.
import { describe, expect, it } from 'vitest'
import { addressPermission, addressProblem, branchFor, isSsh, safeTreePath, validBranch } from '../plugins/repository/src/address'

describe('repository addresses', () => {
  it('asks for the https address instead of an SSH one', () => {
    for (const ssh of ['git@github.com:me/books.git', 'ssh://git@example.com/me/books.git', 'git+ssh://example.com/x', 'me@host.example:books']) {
      expect(isSsh(ssh), ssh).toBe(true)
      expect(addressProblem(ssh), ssh).toBe('ssh')
    }
    expect(isSsh('https://github.com/me/books.git')).toBe(false)
  })

  it('takes https anywhere and plain http only to this computer', () => {
    expect(addressProblem('https://github.com/me/books.git')).toBeNull()
    expect(addressProblem('http://localhost:5276/books.git')).toBeNull()
    expect(addressProblem('http://127.0.0.1:5276/books.git')).toBeNull()
    expect(addressProblem('http://git.example.com/books.git')).toBe('http')
  })

  it('refuses what isn’t an address, and a token written into one', () => {
    for (const bad of ['/home/me/books.git', '../books.git', 'file:///home/me/books.git', 'ext::sh -c id', '--upload-pack=evil', 'https://example.com/x?y=1', 'not an address', ''])
      expect(addressProblem(bad), bad).toBe('other')
    expect(addressProblem('https://me:secret@github.com/me/books.git')).toBe('login')
  })

  it('names the permission for an address the way the app does', () => {
    expect(addressPermission('https://github.com/me/books.git/')).toBe('address:https://github.com/me/books.git')
    expect(addressPermission('http://localhost:5276/books.git')).toBe('address:http://localhost:5276/books.git')
  })
})

describe('branch names', () => {
  it('takes plain branch names and nothing that could be an option or a range', () => {
    for (const ok of ['main', 'saga', 'books/one', 'b-2026.10', 'A_b']) expect(validBranch(ok)).toBe(true)
    for (const bad of [
      '--output=/tmp/x', '-b', '', 'a..b', '.hidden', 'a/.b', 'a.lock', 'a/b.lock/c', 'a/', 'a.', 'a//b', 'a b', 'a:b', 'a~1', 'a^', 'a\\b', 'HEAD@{1}', 'x'.repeat(300),
      undefined as unknown as string, 7 as unknown as string,
    ])
      expect(validBranch(bad)).toBe(false)
  })

  it('makes a git-safe branch from a title, with a random tail', () => {
    expect(branchFor('Fyrvaktarens dotter')).toMatch(/^fyrvaktarens-dotter-[a-z0-9]{6}$/)
    expect(branchFor('Åsa & Örjan: del två!')).toMatch(/^asa-orjan-del-tva-[a-z0-9]{6}$/)
    expect(branchFor('???')).toMatch(/^project-[a-z0-9]{6}$/)
    expect(branchFor('Same')).not.toBe(branchFor('Same'))
  })
})

describe('paths in a commit’s tree', () => {
  it('go only where a file of the project may be', () => {
    expect(safeTreePath('docs/s1.html')).toBe(true)
    expect(safeTreePath('project.json')).toBe(true)
    for (const bad of [
      '', '../x', 'docs/../../x', '/etc/passwd', 'docs//x', './x', '.git/config', '.GIT/config', '.Git/hooks/pre-commit', 'git~1/config',
      'GIT~12/x', '.git./config', '.git /config', 'docs/x.', 'docs\\..\\x', '.git\\hooks\\pre-commit', 'C:x', 'docs/x:stream', 'a\0b', 'a\nb',
      '.g​it/config', 'x'.repeat(5000), 'books/one/.sync/link.json', 'books/one/.git/config',
    ])
      expect(safeTreePath(bad), bad).toBe(false)
  })
})
