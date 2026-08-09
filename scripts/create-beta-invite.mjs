import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const protectedFlags = ['--email', '--database', '--config']
const wranglerConfig = 'wrangler.local.jsonc'

function flag(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1]?.trim() : undefined
}

function rejectProtectedArgs(args) {
  const forbidden = protectedFlags.find((name) => args.some((arg) => arg === name || arg.startsWith(`${name}=`)))
  if (forbidden) throw new Error(`${forbidden} is not accepted. Keep protected values out of process arguments.`)
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function hash(value) {
  return base64Url(createHash('sha256').update(value).digest())
}

function wranglerArgs(location, sqlFile) {
  return ['--no-install', 'wrangler', 'd1', 'execute', 'DB', location, '--file', sqlFile, '--config', wranglerConfig]
}

function assertSelfTest(condition, message) {
  if (!condition) throw new Error(`Invite CLI self-test failed: ${message}`)
}

function selfTest() {
  for (const name of protectedFlags) {
    let rejected = false
    try {
      rejectProtectedArgs([`${name}=protected-value`])
    } catch {
      rejected = true
    }
    assertSelfTest(rejected, `${name} must be rejected`)
  }

  const args = wranglerArgs('--remote', '/tmp/aislestage-invite-test.sql')
  assertSelfTest(args[4] === 'DB', 'the generic D1 binding must be used')
  assertSelfTest(args.includes('--file') && !args.includes('--command'), 'SQL must be supplied through a file')
  assertSelfTest(!args.some((arg) => /recipient@example|private-database|protected-value/.test(arg)), 'child arguments must exclude protected values')
}

async function main() {
  const args = process.argv.slice(2)
  rejectProtectedArgs(args)
  if (args.includes('--self-test')) {
    selfTest()
    process.stdout.write('Beta invite CLI self-test passed.\n')
    return
  }

  if (process.env.AISLESTAGE_INVITE_DATABASE || process.env.AISLESTAGE_WRANGLER_CONFIG) {
    throw new Error('Use the generic DB binding in the fixed protected Wrangler configuration.')
  }
  const email = (process.env.AISLESTAGE_INVITE_EMAIL || '').trim().toLowerCase()
  const days = Number(flag(args, '--days') || '7')
  const accountType = flag(args, '--account-type') === 'test' ? 'test' : 'beta'
  const location = args.includes('--local') ? '--local' : '--remote'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set AISLESTAGE_INVITE_EMAIL to a valid recipient email.')
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error('--days must be an integer from 1 to 30.')

  const inviteCode = base64Url(randomBytes(24))
  const inviteId = randomUUID()
  const tokenHash = hash(inviteCode)
  const recipientHash = hash(`${email}\n${inviteCode}`)
  const sql = `INSERT INTO beta_invites (id, token_hash, recipient_hash, account_type, expires_at) VALUES ('${inviteId}', '${tokenHash}', '${recipientHash}', '${accountType}', datetime('now', '+${days} days'));`
  const sqlFile = join(tmpdir(), `aislestage-invite-${randomUUID()}.sql`)
  const { AISLESTAGE_INVITE_EMAIL: _inviteEmail, ...childEnv } = process.env

  try {
    await writeFile(sqlFile, sql, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const child = spawn('npx', wranglerArgs(location, sqlFile), {
      env: childEnv,
      stdio: ['ignore', 'ignore', 'ignore']
    })
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code))
    })
    if (exitCode !== 0) throw new Error('Unable to create the invite. Verify the protected Wrangler configuration and D1 access.')
  } finally {
    await unlink(sqlFile).catch(() => undefined)
  }

  process.stdout.write(`Beta invite created. Share this code through a private channel; it is shown only once.\n${inviteCode}\n`)
}

await main()
