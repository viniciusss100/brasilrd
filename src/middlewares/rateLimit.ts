/**
 * rateLimit.ts — Rate limiting diferenciado + proteção básica contra scrapers.
 *
 * Estratégia:
 * - P2P puro (sem Debrid): limites mais restritivos — fácil de abusar, sem autenticação.
 * - Debrid (com API key válida): limites mais generosos — usuário autenticado, perfil diferente.
 * - Configure endpoint: muito restritivo — evita enumeração de API keys.
 * - Padrões de scraper: bloqueio por heurística de comportamento (burst + padrão de ID).
 *
 * Nota sobre multi-instância:
 * express-rate-limit com MemoryStore é por-processo. Em ambientes com múltiplas
 * réplicas (Vercel, Railway scaled), os contadores não são compartilhados.
 * Para uso com Redis, substitua o store por `rate-limit-redis` ou similar,
 * configurando REDIS_URL no ambiente.
 *
 * Para Vercel serverless, o rate limiting em memória ainda é válido por invocação
 * (cada instância tem seu próprio contexto curto). A proteção principal nesses
 * ambientes vem do próprio CDN/Edge da Vercel.
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger.js';

const logger = new Logger('RateLimit');
const isDevelopment = process.env.NODE_ENV === 'development';

// ─── Heurística de scraper ────────────────────────────────────────────────────
// Rastreia padrões suspeitos: muitas IDs distintas num curto intervalo.
// Usuário legítimo busca alguns títulos; scraper varre centenas em segundos.

interface ScraperTrack {
  ids: Set<string>;
  firstSeen: number;
  lastSeen: number;
  blocked: boolean;
  blockUntil: number;
}

const scraperMap = new Map<string, ScraperTrack>();
const SCRAPER_WINDOW_MS = 60_000;         // janela de 1 min para contar IDs únicas
const SCRAPER_ID_THRESHOLD = 40;          // mais de 40 IDs distintas/min → suspeito
const SCRAPER_BLOCK_MS = 15 * 60_000;     // bloqueia por 15 min
const SCRAPER_MAP_MAX = 5_000;            // evita leak de memória

function getClientKey(req: Request): string {
  // Prefere X-Forwarded-For (primeira IP real, não proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first && first !== '::1' && first !== '127.0.0.1') {
      return ipKeyGenerator(first);
    }
  }
  const ip = (req as any).ip || req.socket?.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
}

function cleanupScraperMap(): void {
  const now = Date.now();
  if (scraperMap.size < SCRAPER_MAP_MAX / 2) return;
  for (const [key, track] of scraperMap.entries()) {
    if (now - track.lastSeen > SCRAPER_BLOCK_MS * 2) {
      scraperMap.delete(key);
    }
  }
}

function extractContentId(path: string): string | null {
  // Extrai IDs como tt1234567:1:2 de /stream/movie/tt1234567.json
  const match = path.match(/\/(tt\d+(?::\d+:\d+)?)/i);
  return match ? match[1] : null;
}

/**
 * Middleware de detecção de scrapers.
 * Aplica somente em rotas de stream (onde o abuso é mais custoso).
 * NÃO bloqueia por ASN/host — apenas por comportamento.
 */
export function scraperDetectionMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDevelopment) return next();

    // Só aplica em rotas de stream
    if (!req.path.includes('/stream/')) return next();

    const contentId = extractContentId(req.path);
    if (!contentId) return next();

    const clientKey = getClientKey(req);
    const now = Date.now();

    // Limpeza ocasional (sem setInterval para funcionar bem em serverless)
    if (scraperMap.size > SCRAPER_MAP_MAX * 0.8) cleanupScraperMap();

    let track = scraperMap.get(clientKey);

    if (!track) {
      track = { ids: new Set(), firstSeen: now, lastSeen: now, blocked: false, blockUntil: 0 };
      scraperMap.set(clientKey, track);
    }

    // Verifica bloqueio ativo
    if (track.blocked && now < track.blockUntil) {
      logger.warn('Scraper bloqueado', { ip: clientKey, until: new Date(track.blockUntil).toISOString() });
      res.status(429).json({
        error: 'Acesso temporariamente suspenso por comportamento automatizado.',
        retryAfter: Math.ceil((track.blockUntil - now) / 1000),
      });
      return;
    }

    // Reseta janela se passou o tempo
    if (now - track.firstSeen > SCRAPER_WINDOW_MS) {
      track.ids.clear();
      track.firstSeen = now;
      track.blocked = false;
    }

    track.ids.add(contentId);
    track.lastSeen = now;

    // Verifica threshold
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

// ─── Rate limiters ─────────────────────────────────────────────────────────────

/** Rate limit global — cobre todas as rotas */
export const createRateLimiter = () => {
  if (isDevelopment) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 400,
    message: {
      error: 'Muitas requisições. Tente novamente em 15 minutos.',
      retryAfter: '15 minutos',
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: getClientKey,
  });
};

/**
 * Rate limit para streams P2P (sem Debrid).
 * Mais restritivo: sem autenticação, fácil de abusar.
 */
export const p2pStreamRateLimiter = (() => {
  if (isDevelopment) return (_req: Request, _res: Response, next: NextFunction) => next();

  return rateLimit({
    windowMs: 10 * 60 * 1000,  // janela de 10 min
    max: 60,                    // 60 req/10 min por IP (6/min)
    message: {
      error: 'Limite de buscas P2P excedido. Aguarde 10 minutos.',
      retryAfter: '10 minutos',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientKey,
  });
})();

/**
 * Rate limit para streams com Debrid.
 * Mais generoso: usuário com API key tem perfil diferente.
 */
export const debridStreamRateLimiter = (() => {
  if (isDevelopment) return (_req: Request, _res: Response, next: NextFunction) => next();

  return rateLimit({
    windowMs: 10 * 60 * 1000,  // janela de 10 min
    max: 200,                   // 200 req/10 min por IP (20/min)
    message: {
      error: 'Limite de buscas excedido. Aguarde 10 minutos.',
      retryAfter: '10 minutos',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientKey,
  });
})();

/**
 * Rate limit Torrentio (rotas /torbox= e /realdebrid=).
 * Instância única pré-criada (boa prática para Express Rate Limit).
 */
export const torrentioRateLimiter = (() => {
  if (isDevelopment) return (_req: Request, _res: Response, next: NextFunction) => next();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: {
      error: 'Limite de requisições excedido. Aguarde 15 minutos.',
      retryAfter: '15 minutos',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientKey,
  });

  return (req: Request, res: Response, next: NextFunction) => limiter(req, res, next);
})();

/**
 * Rate limit para o endpoint /api/encrypt-config.
 * Muito restritivo — evita enumeração de API keys e abuso de validação.
 */
export const configureRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 15,
  message: {
    error: 'Muitas tentativas de configuração. Aguarde 15 minutos.',
    retryAfter: '15 minutos',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientKey,
});

/**
 * Middleware que aplica rate limit diferenciado por tipo de stream.
 * Detecta P2P pelo path (p2p=1, apiKey="p2p") ou token encriptado.
 * A diferenciação P2P/Debrid é feita pelo servidor, não pelo cliente.
 */
export function streamRateLimiter() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isDevelopment) return next();

    // Detecta P2P pelo path ou query
    const isP2p = req.query.p2p === '1' ||
      req.query.p2p === 'true' ||
      req.params?.apiKey === 'p2p' ||
      req.params?.apiKey === 'none' ||
      // Token encriptado com p2p=true não tem apiKey no path
      (!req.params?.apiKey && !req.query.apiKey && req.path.includes('/e/'));

    if (isP2p) {
      p2pStreamRateLimiter(req, res, next);
    } else {
      debridStreamRateLimiter(req, res, next);
    }
  };
}
