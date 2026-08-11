import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const protectedFlags = ['--email', '--database', '--config']
const wranglerConfig = 'wrangler.local.jsonc'

function rejectProtectedArgs(args) {
  const forbidden = protectedFlags.find((name) => args.some((arg) => arg === name || arg.startsWith(`${name}=`)))
  if (forbidden) throw new Error(`${forbidden} is not accepted. Keep protected values out of process arguments.`)
}

function parseArgs(args) {
  rejectProtectedArgs(args)
  const parsed = {
    selfTest: false,
    location: '--remote',
    days: 7,
    accountType: 'beta'
  }
  const seen = new Set()

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const separator = argument.indexOf('=')
    const name = separator >= 0 ? argument.slice(0, separator) : argument
    const inlineValue = separator >= 0 ? argument.slice(separator + 1) : undefined

    if (!['--self-test', '--local', '--days', '--account-type'].includes(name)) {
      throw new Error('Only documented invite options are accepted.')
    }
    if (seen.has(name)) throw new Error(`${name} may be provided only once.`)
    seen.add(name)

    if (name === '--self-test' || name === '--local') {
      if (inlineValue !== undefined) throw new Error(`${name} does not accept a value.`)
      if (name === '--self-test') parsed.selfTest = true
      if (name === '--local') parsed.location = '--local'
      continue
    }

    let value = inlineValue
    if (value === undefined) {
      const nextValue = args[index + 1]
      if (nextValue === undefined || nextValue.startsWith('--')) throw new Error(`${name} requires a value.`)
      value = nextValue
      index += 1
    }
    value = value.trim()
    if (!value) throw new Error(`${name} requires a value.`)

    if (name === '--days') {
      const days = Number(value)
      if (!Number.isSafeInteger(days) || days < 1 || days > 30) {
        throw new Error('--days must be an integer from 1 to 30.')
      }
      parsed.days = days
      continue
    }

    if (value !== 'beta' && value !== 'test') {
      throw new Error('--account-type must be beta or test.')
    }
    parsed.accountType = value
  }

  if (parsed.selfTest && seen.size !== 1) {
    throw new Error('--self-test cannot be combined with operational options.')
  }
  return parsed
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

function assertArgsRejected(args, message) {
  let rejected = false
  try {
    parseArgs(args)
  } catch {
    rejected = true
  }
  assertSelfTest(rejected, message)
}

function selfTest() {
  for (const name of protectedFlags) {
    assertArgsRejected([`${name}=protected-value`], `${name} must be rejected`)
    assertArgsRejected([name, 'protected-value'], `${name} with a separate value must be rejected`)
  }

  assertArgsRejected(['--unknown'], 'unknown options must be rejected')
  assertArgsRejected(['unexpected-value'], 'positional arguments must be rejected')
  assertArgsRejected(['--days'], 'options that require a value must reject missing values')
  assertArgsRejected(['--days='], 'value options must reject empty inline values')
  assertArgsRejected(['--days', '0'], 'invite lifetime must reject values below the minimum')
  assertArgsRejected(['--days', '1.5'], 'invite lifetime must reject non-integers')
  assertArgsRejected(['--days', '31'], 'invite lifetime must reject values above the maximum')
  assertArgsRejected(['--days', '7', '--days=8'], 'duplicate value options must be rejected')
  assertArgsRejected(['--local', '--local'], 'duplicate boolean options must be rejected')
  assertArgsRejected(['--local=true'], 'boolean options must reject inline values')
  assertArgsRejected(['--account-type', 'owner'], 'unsupported account types must be rejected')
  assertArgsRejected(['--self-test', '--local'], 'self-test mode must reject operational options')

  const defaults = parseArgs([])
  assertSelfTest(defaults.location === '--remote', 'remote mode must be the default')
  assertSelfTest(defaults.days === 7, 'seven days must be the default invite lifetime')
  assertSelfTest(defaults.accountType === 'beta', 'beta must be the default account type')

  const parsed = parseArgs(['--local', '--days=3', '--account-type', 'test'])
  assertSelfTest(parsed.location === '--local', 'local mode must be parsed explicitly')
  assertSelfTest(parsed.days === 3, 'invite lifetime must be parsed exactly')
  assertSelfTest(parsed.accountType === 'test', 'account type must be parsed exactly')

  const args = wranglerArgs('--remote', '/tmp/aislestage-invite-test.sql')
  assertSelfTest(args[4] === 'DB', 'the generic D1 binding must be used')
  assertSelfTest(args.includes('--file') && !args.includes('--command'), 'SQL must be supplied through a file')
  assertSelfTest(!args.some((arg) => /recipient@example|private-database|protected-value/.test(arg)), 'child arguments must exclude protected values')
}

async function main() {
  const args = process.argv.slice(2)
  const parsed = parseArgs(args)
  if (parsed.selfTest) {
    selfTest()
    process.stdout.write('Beta invite CLI self-test passed.\n')
    return
  }

  if (process.env.AISLESTAGE_INVITE_DATABASE || process.env.AISLESTAGE_WRANGLER_CONFIG) {
    throw new Error('Use the generic DB binding in the fixed protected Wrangler configuration.')
  }
  const email = (process.env.AISLESTAGE_INVITE_EMAIL || '').trim().toLowerCase()
  const { days, accountType, location } = parsed

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set AISLESTAGE_INVITE_EMAIL to a valid recipient email.')

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
