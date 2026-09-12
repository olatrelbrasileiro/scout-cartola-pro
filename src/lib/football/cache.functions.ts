// src/lib/football/cache.functions.ts

type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * Cache em memória do worker (server-side).
 *
 * A API-Football possui limite de requisições por dia/minuto
 * (free plan: 100/dia, 10/min)[reference:1]. O cache evita gastar
 * quota repetindo a mesma chamada dentro da mesma janela de tempo.
 */
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Executa `fetcher` se a chave não estiver em cache ou estiver expirada.
 * Caso contrário, retorna o valor cacheado.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await fetcher();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Limpa todo o cache de futebol.
 * Útil para testes ou forçar recarga manual.
 */
export function clearFootballCache(): void {
  cache.clear();
}
