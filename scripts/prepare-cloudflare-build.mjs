import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const templatePath = resolve('wrangler.jsonc')
const outputPath = resolve('wrangler.ci.generated.jsonc')

function required(name, validate) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing protected build variable: ${name}`)
  }

  if (!validate(value)) {
    throw new Error(`Invalid protected build variable: ${name}`)
  }

  return value
}

function exact(value) {
  return (candidate) => candidate === value
}

function matches(pattern) {
  return (value) => pattern.test(value)
}

function httpsOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

function assertTemplate(condition, message) {
  if (!condition) {
    throw new Error(`Public Wrangler template mismatch: ${message}`)
  }
}

if (process.env.WORKERS_CI !== '1') {
  throw new Error('This command is restricted to Cloudflare Workers Builds.')
}

const resourceName = matches(/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/i)
const databaseId = matches(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const accessAudience = matches(/^[a-z0-9_-]{16,256}$/i)
const outputAllowance = matches(/^(?:[1-9]|[1-9][0-9])$/)

const templateSource = await readFile(templatePath, 'utf8')
const template = JSON.parse(templateSource.replace(/^\s*\/\/.*$/gm, ''))

assertTemplate(template.name === 'replace-with-worker-name', 'unexpected Worker placeholder')
assertTemplate(template.d1_databases?.length === 1 && template.d1_databases[0].binding === 'DB', 'DB binding')
assertTemplate(template.r2_buckets?.length === 1 && template.r2_buckets[0].binding === 'MEDIA_BUCKET', 'MEDIA_BUCKET binding')
assertTemplate(template.queues?.producers?.length === 1 && template.queues.producers[0].binding === 'GENERATION_QUEUE', 'GENERATION_QUEUE producer')
assertTemplate(template.queues?.consumers?.length === 1, 'GENERATION_QUEUE consumer')
assertTemplate(template.durable_objects?.bindings?.length === 1 && template.durable_objects.bindings[0].name === 'CAMPAIGN_AGENT', 'CAMPAIGN_AGENT binding')

template.name = 'aislestage'
template.d1_databases[0].database_name = required('CLOUDFLARE_D1_DATABASE_NAME', resourceName)
template.d1_databases[0].database_id = required('CLOUDFLARE_D1_DATABASE_ID', databaseId)
template.r2_buckets[0].bucket_name = required('CLOUDFLARE_R2_BUCKET_NAME', resourceName)
template.queues.producers[0].queue = required('CLOUDFLARE_QUEUE_NAME', resourceName)
template.queues.consumers[0].queue = template.queues.producers[0].queue
template.queues.consumers[0].dead_letter_queue = required('CLOUDFLARE_DEAD_LETTER_QUEUE_NAME', resourceName)
template.vars = {
  APP_ORIGIN: required('CLOUDFLARE_APP_ORIGIN', httpsOrigin),
  AUTH_MODE: 'access',
  ACCESS_TEAM_DOMAIN: required('CLOUDFLARE_ACCESS_TEAM_DOMAIN', httpsOrigin),
  ACCESS_AUD: required('CLOUDFLARE_ACCESS_AUD', accessAudience),
  ACCESS_AUTO_PROVISION: 'disabled',
  REGISTRATION_MODE: 'closed',
  GENERATION_MODE: 'disabled',
  AGENT_MODE: 'deterministic',
  ASSISTED_PROVIDER: 'disabled',
  ASSISTED_DATA_POLICY: 'disabled',
  ASSISTED_EVALUATION: 'disabled',
  ASSISTED_BUDGET_MODE: 'disabled',
  MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '3',
  INITIAL_OUTPUT_ALLOWANCE: required('CLOUDFLARE_INITIAL_OUTPUT_ALLOWANCE', outputAllowance)
}

await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})

console.log('Prepared protected Cloudflare build configuration for aislestage.')
