import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_ORIGIN: 'https://app.test',
          REGISTRATION_MODE: 'open',
          GENERATION_MODE: 'enabled',
          INITIAL_CREDIT_BALANCE: '3',
          OPENAI_API_KEY: 'test-openai-key',
          TEST_MIGRATIONS: migrations
        }
      }
    })
  ],
  test: {
    restoreMocks: true,
    setupFiles: ['./tests/setup.ts']
  }
})
