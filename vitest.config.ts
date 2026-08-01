import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import agents from 'agents/vite'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    agents(),
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_ORIGIN: 'https://app.test',
          AUTH_MODE: 'password',
          ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
          ACCESS_AUD: 'test-access-audience',
          ACCESS_AUTO_PROVISION: 'disabled',
          REGISTRATION_MODE: 'open',
          GENERATION_MODE: 'deterministic',
          AGENT_MODE: 'deterministic',
          ASSISTED_PROVIDER: 'disabled',
          ASSISTED_DATA_POLICY: 'disabled',
          ASSISTED_EVALUATION: 'disabled',
          ASSISTED_BUDGET_MODE: 'disabled',
          MAX_ACTIVE_GENERATIONS_PER_WORKSPACE: '3',
          INITIAL_OUTPUT_ALLOWANCE: '3',
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
