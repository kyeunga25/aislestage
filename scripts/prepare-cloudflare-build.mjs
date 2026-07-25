import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputPath = resolve('wrangler.ci.generated.jsonc')

function required(name, pattern) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing protected build variable: ${name}`)
  }

  if (!pattern.test(value)) {
    throw new Error(`Invalid protected build variable: ${name}`)
  }

  return value
}

if (process.env.WORKERS_CI !== '1') {
  throw new Error('This command is restricted to Cloudflare Workers Builds.')
}

const resourceName = /^[a-z0-9][a-z0-9._-]{1,127}$/i
const databaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const httpsOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i

const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: required('CLOUDFLARE_WORKER_NAME', resourceName),
  main: 'src/worker.ts',
  compatibility_date: '2026-07-22',
  compatibility_flags: ['nodejs_compat'],
  observability: {
    enabled: true,
    head_sampling_rate: 1
  },
  assets: {
    directory: './dist',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*']
  },
  triggers: {
    crons: ['17 3 * * *']
  },
  durable_objects: {
    bindings: [{ name: 'CAMPAIGN_AGENT', class_name: 'CampaignAgent' }]
  },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['CampaignAgent'] }],
  d1_databases: [
    {
      binding: 'DB',
      database_name: required('CLOUDFLARE_D1_DATABASE_NAME', resourceName),
      database_id: required('CLOUDFLARE_D1_DATABASE_ID', databaseId),
      migrations_dir: 'migrations'
    }
  ],
  r2_buckets: [
    {
      binding: 'MEDIA_BUCKET',
      bucket_name: required('CLOUDFLARE_R2_BUCKET_NAME', resourceName)
    }
  ],
  queues: {
    producers: [
      {
        binding: 'GENERATION_QUEUE',
        queue: required('CLOUDFLARE_QUEUE_NAME', resourceName)
      }
    ],
    consumers: [
      {
        queue: required('CLOUDFLARE_QUEUE_NAME', resourceName),
        max_batch_size: 1,
        max_retries: 3,
        retry_delay: 60,
        dead_letter_queue: required('CLOUDFLARE_DEAD_LETTER_QUEUE_NAME', resourceName)
      }
    ]
  },
  vars: {
    APP_ORIGIN: required('CLOUDFLARE_APP_ORIGIN', httpsOrigin),
    REGISTRATION_MODE: 'closed',
    GENERATION_MODE: 'deterministic',
    AGENT_MODE: 'deterministic'
  }
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})

console.log('Prepared protected Cloudflare build configuration.')
