/**
 * rateLimit.ts — Rate limiting diferenciado + proteção básica contra scrapers.
 *
 * Estratégia:
 * - P2P puro (sem Debrid): limites mais restritivos.
 * - Debrid (com API key): limites mais generosos.
 * - Configure endpoint: muito restritivo — evita enumeração de API keys.
 * - Padrões de scraper: bloqueio por heurística de IDs únicas por IP/min.
 *
 * Store:
 * - REDIS_URL configurado → RedisStore (rate-limit-redis + ioredis),
 *   contadores compartilhados entre todas as instâncias (Vercel, Railway scaled).
 * - Sem REDIS_URL → MemoryStore padrão do express-rate-limit (por processo).
 *   Funciona bem em instância única (Render, local).
 */

import rateLimit, { ipKeyGenerator, Options } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger.js';
import { createRedisStore, isRedisConfigured } from './redisRateLimit.js';

const logger = new Logger('RateLimit');

// Avaliado em runtime — não no carregamento do módulo.
// Garante comportamento correto na Vercel mesmo que NODE_ENV não esteja setado.
function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}

// ─── Heurística de scraper ─────────────────────────────────────────────────────

interface ScraperTrack {
  ids: Set<string>;
  firstSeen: number;
  lastSeen: number;
  blocked: boolean;
  blockUntil: number;
}

const scraperMap = new Map<string, ScraperTrack>();
const SCRAPER_WINDOW_MS = 60_000;
const SCRAPER_ID_THRESHOLD = 40;
const SCRAPER_BLOCK_MS = 15 * 60_000;
const SCRAPER_MAP_MAX = 5_000;

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first && first !== '::1' && first !== '127.0.0.1') return ipKeyGenerator(first);
  }
  const ip = (req as any).ip || req.socket?.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
}

function cleanupScraperMap(): void {
  const now = Date.now();
  if (scraperMap.size < SCRAPER_MAP_MAX / 2) return;
  for (const [key, track] of scraperMap.entries()) {
    if (now - track.lastSeen > SCRAPER_BLOCK_MS * 2) scraperMap.delete(key);
  }
}

function extractContentId(path: string): string | null {
  const match = path.match(/\/(tt\d+(?::\d+:\d+)?)/i);
  return match ? match[1] : null;
}

export function scraperDetectionMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDev()) return next();
    if (!req.path.includes('/stream/')) return next();

    const contentId = extractContentId(req.path);
    if (!contentId) return next();

    const clientKey = getClientKey(req);
    const now = Date.now();

    if (scraperMap.size > SCRAPER_MAP_MAX * 0.8) cleanupScraperMap();

    let track = scraperMap.get(clientKey);
    if (!track) {
      track = { ids: new Set(), firstSeen: now, lastSeen: now, blocked: false, blockUntil: 0 };
      scraperMap.set(clientKey, track);
    }

    if (track.blocked && now < track.blockUntil) {
      logger.warn('Scraper bloqueado', { ip: clientKey, until: new Date(track.blockUntil).toISOString() });
      res.status(429).json({
        error: 'Acesso temporariamente suspenso por comportamento automatizado.',
        retryAfter: Math.ceil((track.blockUntil - now) / 1000),
      });
      return;
    }

    if (now - track.firstSeen > SCRAPER_WINDOW_MS) {
      track.ids.clear();
      track.firstSeen = now;
      track.blocked = false;
    }

    track.ids.add(contentId);
    track.lastSeen = now;

    if (track.ids.size > SCRAPER_ID_THRESHOLD) {
      track.blocked = true;
      track.blockUntil = now + SCRAPER_BLOCK_MS;
      logger.warn('Scraper detectado e bloqueado', {
        ip: clientKey,
        idsNaJanela: track.ids.size,
        blockUntil: new Date(track.blockUntil).toISOString(),
      });
      res.status(429).json({
        error: 'Acesso suspenso por comportamento automatizado.',
        retryAfter: Math.ceil(SCRAPER_BLOCK_MS / 1000),
      });
      return;
    }

    next();
  };
}

// ─── Fábrica de limiter com suporte a Redis ────────────────────────────────────

/**
 * Cria um limiter express-rate-limit com RedisStore quando REDIS_URL estiver
 * configurado, ou MemoryStore caso contrário.
 * A resolução do store é lazy (primeira requisição) para não bloquear o startup.
 */
function makeLimiter(opts: Omit<Partial<Options>, 'store'> & { windowMs: number; max: number; prefix: string }) {
  const { prefix, ...rlOpts } = opts;

  // Promessa que resolve para o store (Redis ou undefined = MemoryStore)
  let storePromise: Promise<any> | null = null;
  let resolvedStore: any = undefined; // undefined = MemoryStore padrão

  function getStore(): Promise<any> {
    if (!storePromise) {
      storePromise = isRedisConfigured()
        ? createRedisStore(prefix).then(s => { resolvedStore = s ?? undefined; return resolvedStore; })
        : Promise.resolve(undefined);
    }
    return storePromise;
  }

  // Inicia a resolução em background imediatamente
  getStore().catch(() => {});

  // Instância base sem store (usada até o Redis resolver)
  const memLimiter = rateLimit({
    ...rlOpts,
    store: undefined,
    keyGenerator: getClientKey,
  });

  // Instância com Redis (criada assim que o store resolver)
  let redisLimiter: ReturnType<typeof rateLimit> | null = null;
  getStore().then(store => {
    if (!store) return;
    redisLimiter = rateLimit({
      ...rlOpts,
      store,
      keyGenerator: getClientKey,
    });
    logger.info(`Limiter "${prefix}" usando RedisStore`);
  });

  return (req: Request, res: Response, next: NextFunction) => {
    (redisLimiter ?? memLimiter)(req, res, next);
  };
}

// ─── Limiters exportados ───────────────────────────────────────────────────────

export const createRateLimiter = () => {
  if (isDev()) return (_req: Request, _res: Response, next: NextFunction) => next();
  return makeLimiter({
    prefix: 'global',
    windowMs: 15 * 60 * 1000,
    max: 400,
    message: { error: 'Muitas requisições. Tente novamente em 15 minutos.', retryAfter: '15 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
  });
};

export const p2pStreamRateLimiter = (() => {
  if (isDev()) return (_req: Request, _res: Response, next: NextFunction) => next();
  return makeLimiter({
    prefix: 'p2p',
    windowMs: 10 * 60 * 1000,
    max: 60,
    message: { error: 'Limite de buscas P2P excedido. Aguarde 10 minutos.', retryAfter: '10 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
  });
})();

export const debridStreamRateLimiter = (() => {
  if (isDev()) return (_req: Request, _res: Response, next: NextFunction) => next();
  return makeLimiter({
    prefix: 'debrid',
    windowMs: 10 * 60 * 1000,
    max: 200,
    message: { error: 'Limite de buscas excedido. Aguarde 10 minutos.', retryAfter: '10 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
  });
})();

export const torrentioRateLimiter = (() => {
  if (isDev()) return (_req: Request, _res: Response, next: NextFunction) => next();
  return makeLimiter({
    prefix: 'torrentio',
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Limite de requisições excedido. Aguarde 15 minutos.', retryAfter: '15 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
  });
})();

export const configureRateLimiter = (() => {
  if (isDev()) {
    return rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
  }
  return makeLimiter({
    prefix: 'configure',
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Muitas tentativas de configuração. Aguarde 15 minutos.', retryAfter: '15 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
  });
})();

/**
 * Rate limit diferenciado por tipo de stream (P2P vs Debrid).
 * Usa o limiter já configurado com Redis ou memória.
 */
export function streamRateLimiter() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDev()) return next();

    const isP2p = req.query.p2p === '1' ||
      req.query.p2p === 'true' ||
      req.params?.apiKey === 'p2p' ||
      req.params?.apiKey === 'none' ||
      (!req.params?.apiKey && !req.query.apiKey && req.path.includes('/e/'));

    if (isP2p) {
      (p2pStreamRateLimiter as any)(req, res, next);
    } else {
      (debridStreamRateLimiter as any)(req, res, next);
    }
  };
}

// Log de status do Redis na inicialização
logger.info(
  isRedisConfigured()
    ? 'REDIS_URL detectado — rate limiting distribuído será ativado'
    : 'REDIS_URL não configurado — usando rate limiting em memória'
);
