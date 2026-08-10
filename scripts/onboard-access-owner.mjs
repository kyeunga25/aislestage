import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const bindingPattern = /^[A-Z][A-Z0-9_]{0,63}$/
const protectedConfigPattern = /^wrangler(?:\.[a-z0-9_-]+)?\.local\.jsonc$/i
const argumentErrorCodes = new Set([
  'unsupported-onboarding-option',
  'duplicate-onboarding-option',
  'mixed-self-test-mode',
  'explicit-onboarding-target-required'
])

function parseArgs(args) {
  const allowed = new Set(['--self-test', '--dry-run', '--local', '--remote'])
  const seen = new Set()
  for (const argument of args) {
    if (!allowed.has(argument)) throw new Error('unsupported-onboarding-option')
    if (seen.has(argument)) throw new Error('duplicate-onboarding-option')
    seen.add(argument)
  }
  const selfTest = seen.has('--self-test')
  if (selfTest && seen.size !== 1) throw new Error('mixed-self-test-mode')
  if (selfTest) return { selfTest: true, dryRun: false, mode: null }
  const local = seen.has('--local')
  const remote = seen.has('--remote')
  if (local === remote) throw new Error('explicit-onboarding-target-required')
  return {
    selfTest: false,
    dryRun: seen.has('--dry-run'),
    mode: local ? '--local' : '--remote'
  }
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function ownerOnboardingSql({ identity, workspaceName, allowance }) {
  const email = sqlString(identity)
  const name = sqlString('AisleStage Owner')
  const workspace = sqlString(workspaceName)
  const userId = sqlString(randomUUID())
  const workspaceId = sqlString(randomUUID())
  const passwordHash = sqlString(randomBytes(32).toString('base64'))
  const passwordSalt = sqlString(randomBytes(16).toString('base64'))

  return `PRAGMA foreign_keys = ON;

INSERT INTO users (
  id, email, name, password_hash, password_salt,
  account_status, account_type, auth_mode
) VALUES (
  ${userId}, ${email}, ${name}, ${passwordHash}, ${passwordSalt},
  'active', 'beta', 'access'
)
ON CONFLICT(email) DO UPDATE SET
  account_status = 'active',
  account_type = 'beta',
  auth_mode = 'access',
  updated_at = CURRENT_TIMESTAMP
WHERE users.access_subject_hash IS NULL OR users.auth_mode = 'access';

INSERT INTO workspaces (id, owner_user_id, name, plan_status, access_status)
SELECT ${workspaceId}, u.id, ${workspace}, 'active', 'active'
FROM users u
WHERE u.email = ${email}
  AND u.account_status = 'active'
  AND u.auth_mode = 'access'
  AND NOT EXISTS (
    SELECT 1 FROM workspaces existing WHERE existing.owner_user_id = u.id
  );

UPDATE workspaces
SET plan_status = 'active', access_status = 'active'
WHERE id = (
  SELECT w.id
  FROM workspaces w
  JOIN users u ON u.id = w.owner_user_id
  WHERE u.email = ${email}
  ORDER BY CASE w.access_status WHEN 'active' THEN 0 ELSE 1 END,
    w.created_at ASC, w.id ASC
  LIMIT 1
);

INSERT INTO workspace_memberships (workspace_id, user_id, role)
SELECT w.id, u.id, 'owner'
FROM users u
JOIN workspaces w ON w.owner_user_id = u.id
WHERE u.email = ${email}
  AND w.id = (
    SELECT selected.id
    FROM workspaces selected
    WHERE selected.owner_user_id = u.id
    ORDER BY CASE selected.access_status WHEN 'active' THEN 0 ELSE 1 END,
      selected.created_at ASC, selected.id ASC
    LIMIT 1
  )
ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = 'owner';

INSERT INTO output_allowances (workspace_id, available, reserved)
SELECT w.id, ${allowance}, 0
FROM users u
JOIN workspaces w ON w.owner_user_id = u.id
WHERE u.email = ${email}
  AND w.access_status = 'active'
  AND EXISTS (
    SELECT 1
    FROM workspace_memberships membership
    WHERE membership.workspace_id = w.id
      AND membership.user_id = u.id
      AND membership.role = 'owner'
  )
ORDER BY w.created_at ASC, w.id ASC
LIMIT 1
ON CONFLICT(workspace_id) DO NOTHING;

SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM users u
  JOIN workspaces w ON w.owner_user_id = u.id
  JOIN workspace_memberships membership
    ON membership.workspace_id = w.id AND membership.user_id = u.id
  JOIN output_allowances allowance ON allowance.workspace_id = w.id
  WHERE u.email = ${email}
    AND u.account_status = 'active'
    AND u.account_type = 'beta'
    AND u.auth_mode = 'access'
    AND w.access_status = 'active'
    AND membership.role = 'owner'
) THEN 'ok' ELSE 'error' END AS onboarding_status;
`
}

function validatedInput() {
  const identity = (process.env.OWNER_LOGIN_IDENTITY || '').trim().toLowerCase()
  const workspaceName = (process.env.OWNER_WORKSPACE_NAME || 'AisleStage 工作區').trim()
  const allowance = Number(process.env.OWNER_INITIAL_OUTPUT_ALLOWANCE || '6')
  const binding = (process.env.AISLESTAGE_D1_BINDING || 'DB').trim()
  const config = resolve((process.env.AISLESTAGE_WRANGLER_CONFIG || 'wrangler.local.jsonc').trim())
  const persistTo = process.env.AISLESTAGE_D1_PERSIST_TO?.trim()
    ? resolve(process.env.AISLESTAGE_D1_PERSIST_TO.trim())
    : null

  if (!emailPattern.test(identity) || identity.length > 254) throw new Error('invalid-owner-identity')
  if (!workspaceName || workspaceName.length > 120) throw new Error('invalid-workspace-name')
  if (!Number.isSafeInteger(allowance) || allowance < 0 || allowance > 99) throw new Error('invalid-owner-allowance')
  if (!bindingPattern.test(binding)) throw new Error('invalid-d1-binding')
  if (!protectedConfigPattern.test(basename(config))) throw new Error('unprotected-wrangler-config')
  return { identity, workspaceName, allowance, binding, config, persistTo }
}

function containsOnboardingSuccess(value) {
  if (Array.isArray(value)) return value.some(containsOnboardingSuccess)
  if (!value || typeof value !== 'object') return false
  if (value.onboarding_status === 'ok') return true
  return Object.values(value).some(containsOnboardingSuccess)
}

function assertSelfCheck(condition, message) {
  if (!condition) throw new Error(`Owner onboarding self-check failed: ${message}`)
}

function assertArgsRejected(args, message) {
  let rejected = false
  try {
    parseArgs(args)
  } catch {
    rejected = true
  }
  assertSelfCheck(rejected, message)
}

async function removeFile(path) {
  await unlink(path).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

async function runSelfCheck() {
  const sql = ownerOnboardingSql({
    identity: 'owner@example.test',
    workspaceName: "Owner's Workspace",
    allowance: 6
  })
  const requiredFragments = [
    "ON CONFLICT(email) DO UPDATE SET",
    "membership.role = 'owner'",
    "w.access_status = 'active'",
    "THEN 'ok' ELSE 'error' END AS onboarding_status",
    "Owner''s Workspace"
  ]
  assertSelfCheck(requiredFragments.every((fragment) => sql.includes(fragment)), 'required SQL safeguards must be present')
  assertArgsRejected(['--unknown'], 'unknown options must be rejected')
  assertArgsRejected(['unexpected-value'], 'positional arguments must be rejected')
  assertArgsRejected(['--local', '--local'], 'duplicate options must be rejected')
  assertArgsRejected(['--dry-run=true'], 'boolean options must reject values')
  assertArgsRejected(['--self-test', '--local'], 'self-test mode must reject operational options')
  assertArgsRejected([], 'operational mode must require an explicit D1 target')
  assertArgsRejected(['--dry-run'], 'dry-run must require an explicit D1 target')
  assertArgsRejected(['--local', '--remote'], 'local and remote targets must be mutually exclusive')

  const localDryRun = parseArgs(['--local', '--dry-run'])
  assertSelfCheck(localDryRun.mode === '--local' && localDryRun.dryRun, 'local dry-run options must be parsed exactly')
  const remote = parseArgs(['--remote'])
  assertSelfCheck(remote.mode === '--remote' && !remote.dryRun, 'remote execution must require an explicit target')
  process.stdout.write('首次 owner 自測通過。 Owner onboarding self-check passed.\n')
}

async function onboardOwner(options) {
  const input = validatedInput()
  if (options.dryRun) {
    process.stdout.write('首次 owner 輸入已通過格式核對；沒有 D1 變更。 Owner onboarding input accepted; no D1 changes were made.\n')
    return
  }

  const [configInfo, wranglerInfo] = await Promise.all([
    lstat(input.config).catch(() => null),
    lstat(resolve('node_modules/wrangler/bin/wrangler.js')).catch(() => null)
  ])
  if (!configInfo?.isFile() || configInfo.isSymbolicLink()) throw new Error('protected-config-unavailable')
  if (!wranglerInfo?.isFile()) throw new Error('wrangler-unavailable')

  const directory = await mkdtemp(join(tmpdir(), 'aislestage-owner-onboarding-'))
  const sqlPath = join(directory, 'owner-onboarding.sql')
  const logPath = join(directory, 'wrangler.log')
  try {
    await writeFile(sqlPath, ownerOnboardingSql(input), { encoding: 'utf8', mode: 0o600 })
    const args = [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1', 'execute', input.binding, options.mode,
      '--file', sqlPath,
      '--config', input.config,
      '--yes', '--json'
    ]
    if (options.mode === '--local' && input.persistTo) args.push('--persist-to', input.persistTo)
    const childEnv = { ...process.env, WRANGLER_LOG_PATH: logPath }
    delete childEnv.OWNER_LOGIN_IDENTITY
    delete childEnv.OWNER_WORKSPACE_NAME
    delete childEnv.OWNER_INITIAL_OUTPUT_ALLOWANCE
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: resolve('.'),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: childEnv
    })
    const result = JSON.parse(stdout)
    if (!containsOnboardingSuccess(result)) throw new Error('onboarding-verification-failed')
    process.stdout.write('首次 owner workspace 建立完成。 Owner workspace onboarding completed.\n')
  } finally {
    await removeFile(sqlPath)
    await removeFile(logPath)
    await rmdir(directory).catch(() => null)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) return runSelfCheck()
  return onboardOwner(options)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    if (error instanceof Error && argumentErrorCodes.has(error.message)) {
      process.stderr.write('首次 owner 指令選項無效；請只選一個 --local 或 --remote，並只在需要時加入 --dry-run。 Invalid owner onboarding options; choose exactly one target and optional dry-run.\n')
    } else {
      process.stderr.write('首次 owner 建立失敗；請核對受保護 identity、Wrangler 設定、migrations 與 D1 權限。 Owner onboarding failed; verify protected inputs and D1 access.\n')
    }
    process.exitCode = 1
  })
}
