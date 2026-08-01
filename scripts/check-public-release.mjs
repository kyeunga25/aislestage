import { execFileSync } from 'node:child_process'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'

const repositoryRoot = resolve('.')
const findings = new Map()

function report(path, category) {
  const key = `${path}\0${category}`
  findings.set(key, { path, category })
}

function git(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gitBuffer(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] })
}

function repositoryPath(path) {
  const absolute = resolve(repositoryRoot, path)
  const local = relative(repositoryRoot, absolute)
  if (!local || local.startsWith(`..${sep}`) || local === '..') return null
  return { absolute, local: local.split(sep).join('/') }
}

async function collectDirectory(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name)
    const local = `${prefix}/${entry.name}`
    if (entry.isSymbolicLink()) {
      report(local, 'symlink-artifact')
    } else if (entry.isDirectory()) {
      files.push(...await collectDirectory(absolute, local))
    } else if (entry.isFile()) {
      files.push({ absolute, local })
    }
  }
  return files
}

function safePlaceholder(value) {
  const normalized = value.trim().toLowerCase()
  return !normalized
    || normalized.includes('replace-with-')
    || normalized.includes('example.invalid')
    || normalized.includes('example.test')
    || normalized.startsWith('test-')
    || normalized === 'disabled'
    || normalized === 'undefined'
    || normalized === 'null'
    || normalized === 'test-key'
}

const prefixPatterns = [
  ['github-token', new RegExp(`\\b${'gh' + 'p_'}[A-Za-z0-9]{30,}\\b`, 'g')],
  ['github-token', new RegExp(`\\b${'github_' + 'pat_'}[A-Za-z0-9_]{30,}\\b`, 'g')],
  ['provider-secret', new RegExp(`\\b${'s' + 'k-'}[A-Za-z0-9_-]{20,}\\b`, 'g')],
  ['payment-secret', new RegExp(`\\b${'s' + 'k_(?:live|test)_'}[A-Za-z0-9]{16,}\\b`, 'g')],
  ['cloud-key', new RegExp(`\\b${'AK' + 'IA'}[A-Z0-9]{16}\\b`, 'g')]
]

const environmentCredentialPattern = new RegExp(
  '\\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)\\b[ \\t]*[:=][ \\t]*["\']?([^\\s"\',;}{]+)',
  'g'
)
const jsonCredentialPattern = new RegExp(
  '["\'](?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|webhook[_-]?secret|password)["\']\\s*:\\s*["\']([^"\']+)["\']',
  'gi'
)
const clientSecretPattern = new RegExp(`\\b${'VITE_' + '[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)'}\\b`, 'g')
const privateKeyPattern = new RegExp(`${'-'.repeat(5)}BEGIN [A-Z ]*PRIVATE KEY${'-'.repeat(5)}`, 'g')
const jwtPattern = new RegExp('\\beyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{10,}\\b', 'g')
const workersUrlPattern = new RegExp('https?://[a-z0-9.-]+\\.workers\\.dev\\b', 'gi')
const cloudflareMappingPattern = new RegExp(
  `"(?:${['database', 'account', 'zone'].join('|')})_id"\\s*:\\s*"([^"]+)"`,
  'gi'
)

function scanText(path, content, confidentialTerms) {
  if (privateKeyPattern.test(content)) report(path, 'private-key')
  privateKeyPattern.lastIndex = 0
  if (jwtPattern.test(content)) report(path, 'signed-token')
  jwtPattern.lastIndex = 0
  if (clientSecretPattern.test(content)) report(path, 'client-exposed-secret-name')
  clientSecretPattern.lastIndex = 0
  if (workersUrlPattern.test(content)) report(path, 'deployment-url')
  workersUrlPattern.lastIndex = 0

  for (const [category, pattern] of prefixPatterns) {
    if (pattern.test(content)) report(path, category)
    pattern.lastIndex = 0
  }

  for (const match of content.matchAll(environmentCredentialPattern)) {
    if (!safePlaceholder(match[1] || '')) report(path, 'credential-assignment')
  }
  environmentCredentialPattern.lastIndex = 0
  for (const match of content.matchAll(jsonCredentialPattern)) {
    if (!safePlaceholder(match[1] || '')) report(path, 'credential-assignment')
  }
  jsonCredentialPattern.lastIndex = 0

  for (const match of content.matchAll(cloudflareMappingPattern)) {
    if (!safePlaceholder(match[1] || '')) report(path, 'cloudflare-resource-mapping')
  }
  cloudflareMappingPattern.lastIndex = 0

  for (const term of confidentialTerms) {
    if (content.toLocaleLowerCase('en').includes(term)) {
      report(path, 'confidential-term')
      break
    }
  }
}

async function confidentialTerms() {
  const configured = process.env.AISLESTAGE_EGRESS_TERMS_FILE?.trim()
  if (!configured) return []
  const absolute = resolve(configured)
  const local = relative(repositoryRoot, absolute)
  if (!local || (!local.startsWith(`..${sep}`) && local !== '..')) {
    report('[release-check]', 'protected-terms-file-inside-repository')
    return []
  }
  const file = await lstat(absolute).catch(() => null)
  if (!file?.isFile() || file.isSymbolicLink()) {
    report('[release-check]', 'protected-terms-file-unavailable')
    return []
  }
  if ((file.mode & 0o077) !== 0) {
    report('[release-check]', 'protected-terms-file-permissions')
    return []
  }
  const content = await readFile(absolute, 'utf8').catch(() => null)
  if (content === null) {
    report('[release-check]', 'protected-terms-file-unreadable')
    return []
  }
  return [...new Set(content.split(/\r?\n/).map((term) => term.trim().toLocaleLowerCase('en')).filter((term) => term.length >= 3))]
}

async function scanFile(file, terms) {
  const extension = extname(file.local).toLowerCase()
  const forbiddenExtensions = new Set(['.env', '.key', '.pem', '.p12', '.pfx', '.log', '.map', '.sqlite', '.sqlite3', '.db', '.dump', '.bak', '.backup'])
  if (forbiddenExtensions.has(extension) && file.local !== '.env.example') report(file.local, 'private-or-generated-artifact')
  if (/^(?:wrangler\..*\.local\.jsonc|wrangler\.local\.jsonc|wrangler\.ci\.generated\.jsonc)$/i.test(file.local)) report(file.local, 'protected-deployment-config')

  const info = await lstat(file.absolute).catch(() => null)
  if (!info) {
    report(file.local, 'unreadable-file')
    return
  }
  if (info.isSymbolicLink()) {
    report(file.local, 'symlink-file')
    return
  }
  if (!info.isFile()) return
  if (info.size > 12 * 1024 * 1024) {
    report(file.local, 'oversized-unreviewed-artifact')
    return
  }
  const content = await readFile(file.absolute)
  scanText(file.local, content.toString('utf8'), terms)
}

async function scanProposedReleaseText(terms) {
  const configured = process.env.AISLESTAGE_EGRESS_TEXT_FILE?.trim()
  if (!configured) return
  const absolute = resolve(configured)
  const info = await lstat(absolute).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
    report('[release-text]', 'release-text-file-unavailable')
    return
  }
  const content = await readFile(absolute).catch(() => null)
  if (!content) {
    report('[release-text]', 'release-text-file-unreadable')
    return
  }
  scanText('[release-text]', content.toString('utf8'), terms)
}

let gitFiles = []
try {
  gitFiles = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean)
} catch {
  report('[release-check]', 'git-inventory-unavailable')
}

const files = []
for (const path of gitFiles) {
  const resolved = repositoryPath(path)
  if (!resolved) report('[release-check]', 'invalid-repository-path')
  else files.push(resolved)
}
files.push(...await collectDirectory(resolve(repositoryRoot, 'dist'), 'dist'))

const terms = await confidentialTerms()
for (const file of files) await scanFile(file, terms)

try {
  const stagedFiles = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean)
  for (const path of stagedFiles) {
    const content = gitBuffer(['show', `:${path}`])
    if (content.byteLength > 12 * 1024 * 1024) report(`[git:index] ${path}`, 'oversized-unreviewed-artifact')
    else scanText(`[git:index] ${path}`, content.toString('utf8'), terms)
  }
} catch {
  report('[git:index]', 'staged-content-unavailable')
}

await scanProposedReleaseText(terms)

try {
  scanText('[git:HEAD]', git(['log', '-1', '--format=%B']), terms)
} catch {
  report('[git:HEAD]', 'commit-metadata-unavailable')
}

if (process.argv.includes('--history')) {
  try {
    scanText('[git:history]', git(['log', '--format=%B']), terms)
  } catch {
    report('[git:history]', 'history-metadata-unavailable')
  }
}

if (findings.size) {
  console.error(`Public release check failed with ${findings.size} finding(s):`)
  for (const finding of [...findings.values()].sort((left, right) => left.path.localeCompare(right.path) || left.category.localeCompare(right.category))) {
    console.error(`${finding.path}: ${finding.category}`)
  }
  process.exitCode = 1
} else {
  console.log(`Public release check passed for ${files.length} repository and build file(s).`)
}
