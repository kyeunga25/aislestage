export type AssistedEvaluationSample = {
  fixtureId: string
  productGeometryScore: number
  productColorScore: number
  packageTextAccuracy: number
  generatedCommercialText: boolean
  humanBackgroundScore: number
  latencyMs: number
  budgetUnits: number
}

export type AssistedEvaluationLimits = {
  minimumProductGeometryScore: number
  minimumProductColorScore: number
  minimumPackageTextAccuracy: number
  minimumHumanBackgroundScore: number
  maximumLatencyMs: number
  maximumBudgetUnits: number
}

export const DEFAULT_ASSISTED_EVALUATION_LIMITS: AssistedEvaluationLimits = {
  minimumProductGeometryScore: 0.98,
  minimumProductColorScore: 0.95,
  minimumPackageTextAccuracy: 1,
  minimumHumanBackgroundScore: 4,
  maximumLatencyMs: 30_000,
  maximumBudgetUnits: 1
}

export type AssistedEvaluationFailure =
  | 'invalid-sample'
  | 'product-geometry'
  | 'product-color'
  | 'package-text'
  | 'generated-commercial-text'
  | 'human-background-score'
  | 'latency'
  | 'budget'

function finiteScore(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

export function evaluateAssistedSample(
  sample: AssistedEvaluationSample,
  limits: AssistedEvaluationLimits = DEFAULT_ASSISTED_EVALUATION_LIMITS
) {
  const failures: AssistedEvaluationFailure[] = []
  const valid = Boolean(sample.fixtureId.trim())
    && finiteScore(sample.productGeometryScore, 0, 1)
    && finiteScore(sample.productColorScore, 0, 1)
    && finiteScore(sample.packageTextAccuracy, 0, 1)
    && finiteScore(sample.humanBackgroundScore, 1, 5)
    && Number.isFinite(sample.latencyMs) && sample.latencyMs >= 0
    && Number.isFinite(sample.budgetUnits) && sample.budgetUnits >= 0

  if (!valid) return { passed: false, failures: ['invalid-sample'] as AssistedEvaluationFailure[] }
  if (sample.productGeometryScore < limits.minimumProductGeometryScore) failures.push('product-geometry')
  if (sample.productColorScore < limits.minimumProductColorScore) failures.push('product-color')
  if (sample.packageTextAccuracy < limits.minimumPackageTextAccuracy) failures.push('package-text')
  if (sample.generatedCommercialText) failures.push('generated-commercial-text')
  if (sample.humanBackgroundScore < limits.minimumHumanBackgroundScore) failures.push('human-background-score')
  if (sample.latencyMs > limits.maximumLatencyMs) failures.push('latency')
  if (sample.budgetUnits > limits.maximumBudgetUnits) failures.push('budget')
  return { passed: failures.length === 0, failures }
}

export function evaluateAssistedFixtureSet(
  samples: AssistedEvaluationSample[],
  limits: AssistedEvaluationLimits = DEFAULT_ASSISTED_EVALUATION_LIMITS
) {
  const fixtureIds = new Set(samples.map((sample) => sample.fixtureId))
  const results = samples.map((sample) => ({ fixtureId: sample.fixtureId, ...evaluateAssistedSample(sample, limits) }))
  const duplicateFixtureIds = fixtureIds.size !== samples.length
  return {
    passed: samples.length > 0 && !duplicateFixtureIds && results.every((result) => result.passed),
    duplicateFixtureIds,
    results
  }
}
