import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

function flag(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function hash(value) {
  return base64Url(createHash('sha256').update(value).digest())
}

const email = (process.env.AISLESTAGE_INVITE_EMAIL || flag('--email') || '').trim().toLowerCase()
const database = (process.env.AISLESTAGE_INVITE_DATABASE || flag('--database') || '').trim()
const config = (process.env.AISLESTAGE_WRANGLER_CONFIG || flag('--config') || 'wrangler.local.jsonc').trim()
const days = Number(flag('--days') || '7')
const accountType = flag('--account-type') === 'test' ? 'test' : 'beta'
const location = process.argv.includes('--local') ? '--local' : '--remote'

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set AISLESTAGE_INVITE_EMAIL to a valid recipient email.')
if (!/^[a-z0-9][a-z0-9._-]{1,127}$/i.test(database)) throw new Error('Set AISLESTAGE_INVITE_DATABASE to the protected D1 database name.')
if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error('--days must be an integer from 1 to 30.')

const inviteCode = base64Url(randomBytes(24))
const inviteId = randomUUID()
const tokenHash = hash(inviteCode)
const recipientHash = hash(`${email}\n${inviteCode}`)
const sql = `INSERT INTO beta_invites (id, token_hash, recipient_hash, account_type, expires_at) VALUES ('${inviteId}', '${tokenHash}', '${recipientHash}', '${accountType}', datetime('now', '+${days} days'));`

const child = spawn('npx', ['--no-install', 'wrangler', 'd1', 'execute', database, location, '--command', sql, '--config', config], {
  stdio: ['ignore', 'ignore', 'ignore']
})

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolve(code))
})

if (exitCode !== 0) throw new Error('Unable to create the invite. Verify the protected Wrangler configuration and D1 access.')

process.stdout.write(`Beta invite created. Share this code through a private channel; it is shown only once.\n${inviteCode}\n`)
