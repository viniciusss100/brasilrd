/**
 * redisRateLimit.ts — Rate limiting distribuído via REDIS_URL (ioredis).
 *
 * Ativado automaticamente quando REDIS_URL está configurado.
 * Fallback automático para MemoryStore quando indisponível.
 *
 * Compatível com qualquer Redis acessível por URL:
 *   redis://user:pass@host:6379
 *   rediss://user:pass@host:6380  (TLS)
 */

import { Logger } from '../utils/logger.js';

const logger = new Logger('RedisRateLimit');

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}

let _client: any = null;
let _clientFailed = false;

async function getRedisClient(): Promise<any> {
  if (_client) return _client;
  if (_clientFailed) return null;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const ioredis = await import('ioredis');
    const Redis = (ioredis.default ?? (ioredis as any).Redis) as any;
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    await client.connect();
    await client.ping();

    client.on('error', (err: Error) => {
      // Loga apenas uma vez por sessão para não poluir os logs
      if (!_clientFailed) {
        logger.warn('Redis desconectado — usando rate limiting em memória', { error: err.message });
      }
      _clientFailed = true;
      _client = null;
    });

    _client = client;
    _clientFailed = false;
    logger.info('Redis conectado via REDIS_URL — rate limiting distribuído ativo');
    return client;
  } catch (err) {
    _clientFailed = true;
    logger.warn('Falha ao conectar Redis — usando rate limiting em memória', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Cria uma instância de RedisStore para usar com express-rate-limit.
 * Retorna null se Redis não estiver configurado ou falhar.
 */
export async function createRedisStore(prefix: string): Promise<any | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    const { RedisStore } = await import('rate-limit-redis');
    return new RedisStore({
      prefix: `pjbr:rl:${prefix}:`,
      sendCommand: (...args: string[]) => client.call(...args),
    });
  } catch (err) {
    logger.warn('Falha ao criar RedisStore', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
