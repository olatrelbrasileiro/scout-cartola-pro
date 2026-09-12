// src/lib/backtest/metrics.ts

/**
 * Lança erro se os arrays tiverem tamanhos diferentes.
 */
function assertSameLength(predicted: number[], actual: number[]): void {
  if (predicted.length !== actual.length) {
    throw new Error(
      `predicted and actual must have the same length (got ${predicted.length} and ${actual.length})`,
    );
  }
}

/**
 * Mean Absolute Error.
 * Retorna null para arrays vazios.
 */
export function mae(predicted: number[], actual: number[]): number | null {
  assertSameLength(predicted, actual);
  if (predicted.length === 0) return null;

  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    sum += Math.abs(predicted[i] - actual[i]);
  }
  return sum / predicted.length;
}

/**
 * Root Mean Squared Error.
 * Retorna null para arrays vazios.
 */
export function rmse(predicted: number[], actual: number[]): number | null {
  assertSameLength(predicted, actual);
  if (predicted.length === 0) return null;

  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    const diff = predicted[i] - actual[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum / predicted.length);
}

/**
 * Coeficiente de correlação de Pearson.
 * Retorna null se:
 * - os arrays estiverem vazios;
 * - houver menos de 2 pontos;
 * - alguma das séries tiver variância zero.
 */
export function pearson(predicted: number[], actual: number[]): number | null {
  assertSameLength(predicted, actual);

  const n = predicted.length;
  if (n < 2) return null;

  let sumP = 0;
  let sumA = 0;
  for (let i = 0; i < n; i++) {
    sumP += predicted[i];
    sumA += actual[i];
  }
  const meanP = sumP / n;
  const meanA = sumA / n;

  let cov = 0;
  let varP = 0;
  let varA = 0;
  for (let i = 0; i < n; i++) {
    const dp = predicted[i] - meanP;
    const da = actual[i] - meanA;
    cov += dp * da;
    varP += dp * dp;
    varA += da * da;
  }

  if (varP === 0 || varA === 0) return null;

  return cov / Math.sqrt(varP * varA);
}
