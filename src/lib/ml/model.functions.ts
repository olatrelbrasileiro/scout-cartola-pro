// src/lib/ml/model.functions.ts

import type { MLFeatureValue, RidgeModel } from './model.types';

/**
 * Resolve um sistema linear Ax = b via eliminação gaussiana com
 * pivoteamento parcial. Retorna x.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row) => [...row]);
  const v = [...b];

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    }
    if (maxRow !== i) {
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      [v[i], v[maxRow]] = [v[maxRow], v[i]];
    }

    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / pivot;
      for (let j = i; j < n; j++) {
        M[k][j] -= factor * M[i][j];
      }
      v[k] -= factor * v[i];
    }
  }

  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = v[i];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : sum / M[i][i];
  }
  return x;
}

/**
 * Treina Ridge Regression.
 * X: matriz n×p já padronizada (sem intercepto).
 * y: vetor de targets.
 * lambda: força da regularização L2.
 *
 * Retorna pesos (p) e intercepto.
 */
export function fitRidge(
  X: number[][],
  y: number[],
  lambda: number,
): { weights: number[]; intercept: number } {
  const n = X.length;
  const p = X[0].length;
  const Xb = X.map((row) => [1, ...row]);
  const p1 = p + 1;

  const XtX: number[][] = Array.from({ length: p1 }, () =>
    new Array(p1).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p1; j++) {
      for (let k = 0; k < p1; k++) {
        XtX[j][k] += Xb[i][j] * Xb[i][k];
      }
    }
  }

  const Xty = new Array(p1).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p1; j++) {
      Xty[j] += Xb[i][j] * y[i];
    }
  }

  for (let j = 1; j < p1; j++) {
    XtX[j][j] += lambda;
  }

  const beta = solveLinearSystem(XtX, Xty);
  return { intercept: beta[0], weights: beta.slice(1) };
}

export function predictRidge(
  model: { weights: number[]; intercept: number },
  X: number[][],
): number[] {
  return X.map((row) => {
    let sum = model.intercept;
    for (let i = 0; i < row.length; i++) sum += model.weights[i] * row[i];
    return sum;
  });
}

export function computeMeansAndStds(
  X: MLFeatureValue[][],
): { means: number[]; stds: number[] } {
  const p = X[0].length;
  const means = new Array(p).fill(0);
  const stds = new Array(p).fill(1);

  for (let j = 0; j < p; j++) {
    const vals = X.map((row) => row[j]).filter(
      (v): v is number => v !== null,
    );
    if (vals.length === 0) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    means[j] = mean;
    const variance =
      vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
    stds[j] = Math.sqrt(variance) || 1;
  }
  return { means, stds };
}

export function imputeAndStandardize(
  X: MLFeatureValue[][],
  means: number[],
  stds: number[],
): number[][] {
  return X.map((row) =>
    row.map((v, j) => {
      const val = v ?? means[j];
      return (val - means[j]) / stds[j];
    }),
  );
}
