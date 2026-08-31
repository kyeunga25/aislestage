import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { IntegrationReadinessView } from '../src/components/IntegrationReadinessView'
import type { IntegrationReadinessSnapshot } from '../src/lib/types'

const readiness: IntegrationReadinessSnapshot = {
  contractVersion: 'integration-readiness-v1',
  access: { authMode: 'access', registrationMode: 'closed' },
  generation: { requestedMode: 'assisted', effectiveMode: 'disabled', enabled: false, maxActivePerWorkspace: 3 },
  agent: { requestedMode: 'assisted', effectiveMode: 'deterministic' },
  assisted: {
    requested: true,
    executionApproved: false,
    gates: {
      providerAllowlisted: true,
      dataPolicyApproved: true,
      evaluationApproved: false,
      budgetApproved: true,
      credentialConfigured: false
    }
  },
  payment: { enabled: false, checkoutAvailable: false, subscriptionAvailable: false, approvalRequired: true }
}

describe('integration readiness management view', () => {
  it('renders effective modes, gate results, next actions, and the payment boundary', () => {
    const markup = renderToStaticMarkup(<IntegrationReadinessView
      readiness={readiness}
      isRefreshing={false}
      notice=""
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('整合就緒度')
    expect(markup).toContain('Integration readiness')
    expect(markup).toContain('目前不會執行 assisted generation')
    expect(markup).toContain('資料政策已批准')
    expect(markup).toContain('固定評估待批准')
    expect(markup).toContain('Server credential 待設定')
    expect(markup).toContain('付款、checkout 與 subscription 保持停用')
    expect(markup).toContain('這是設定快照，不是 live deployment 或 provider connectivity 驗收')
  })

  it('keeps the previous trusted snapshot visible when refresh is unavailable', () => {
    const markup = renderToStaticMarkup(<IntegrationReadinessView
      readiness={readiness}
      isRefreshing
      notice="整合就緒度暫時無法讀取。 Integration readiness is temporarily unavailable."
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Integration readiness is temporarily unavailable.')
    expect(markup).toContain('固定評估待批准')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
  })

  it('surfaces a requested-mode decision when Agent assistance cannot execute', () => {
    const markup = renderToStaticMarkup(<IntegrationReadinessView
      readiness={{
        ...readiness,
        generation: { requestedMode: 'deterministic', effectiveMode: 'deterministic', enabled: true, maxActivePerWorkspace: 3 },
        assisted: {
          requested: true,
          executionApproved: false,
          gates: {
            providerAllowlisted: true,
            dataPolicyApproved: true,
            evaluationApproved: true,
            budgetApproved: true,
            credentialConfigured: true
          }
        }
      }}
      isRefreshing={false}
      notice=""
      onRefresh={vi.fn()}
      onBack={vi.fn()}
    />)

    expect(markup).toContain('核對並統一 Generation／Agent requested mode')
    expect(markup).toContain('1 項')
  })
})
