import { describe, expect, it } from 'vitest'
import { evaluateAssistedFixtureSet, evaluateAssistedSample, type AssistedEvaluationSample } from '../src/lib/ai-evaluation'

const passingSample: AssistedEvaluationSample = {
  fixtureId: 'synthetic-product-01',
  productGeometryScore: 0.99,
  productColorScore: 0.98,
  packageTextAccuracy: 1,
  generatedCommercialText: false,
  humanBackgroundScore: 4,
  latencyMs: 12_000,
  budgetUnits: 1
}

describe('assisted evaluation gate', () => {
  it('passes a bounded synthetic fixture only when every quality and cost check passes', () => {
    expect(evaluateAssistedSample(passingSample)).toEqual({ passed: true, failures: [] })
  })

  it('reports stable categories without exposing fixture contents', () => {
    expect(evaluateAssistedSample({
      ...passingSample,
      productGeometryScore: 0.7,
      packageTextAccuracy: 0.9,
      generatedCommercialText: true,
      latencyMs: 31_000,
      budgetUnits: 2
    })).toEqual({
      passed: false,
      failures: ['product-geometry', 'package-text', 'generated-commercial-text', 'latency', 'budget']
    })
  })

  it('fails empty or duplicate fixture sets', () => {
    expect(evaluateAssistedFixtureSet([]).passed).toBe(false)
    expect(evaluateAssistedFixtureSet([passingSample, passingSample])).toMatchObject({ passed: false, duplicateFixtureIds: true })
  })
})
