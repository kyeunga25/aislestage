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
  if (!requiredFragments.every((fragment) => sql.includes(fragment))) throw new Error('self-check-failed')
  process.stdout.write('Owner onboarding self-check passed.\n')
}

async function onboardOwner() {
  const input = validatedInput()
  if (process.argv.includes('--dry-run')) {
    process.stdout.write('Owner onboarding input accepted; no remote changes were made.\n')
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
    const mode = process.argv.includes('--local') ? '--local' : '--remote'
    const args = [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1', 'execute', input.binding, mode,
      '--file', sqlPath,
      '--config', input.config,
      '--yes', '--json'
    ]
    if (mode === '--local' && input.persistTo) args.push('--persist-to', input.persistTo)
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
    process.stdout.write('Owner workspace onboarding completed.\n')
  } finally {
    await removeFile(sqlPath)
    await removeFile(logPath)
    await rmdir(directory).catch(() => null)
  }
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfCheck()
  return onboardOwner()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('Owner onboarding failed. Verify the protected identity input, Wrangler configuration, migrations, and D1 permissions.\n')
    process.exitCode = 1
  })
}
