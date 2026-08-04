import 'dotenv/config';

import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import express from 'express';
import cors from 'cors';
import path from 'path';
import { sequelize } from './database/models.js';
import { manifest } from './rotas/manifest.js';
import { configureTemplate } from './rotas/configureTemplate.js';
import { createStremioBuilder, getStremioRouter } from './rotas/streamHandlerBuilder.js';
import { setupBasicRoutes } from './rotas/basicRoutes.js';
import { setupResolveRoutes } from './rotas/resolveRoutes.js';
import { setupStaticRoutes } from './rotas/staticRoutes.js';
import { createServer } from './rotas/serverFunctions.js';
import { CacheService } from './debrid/CacheService.js';
import { Logger } from './utils/logger.js';
import { clientInfoMiddleware } from './middlewares/clientInfo.js';
import { createRateLimiter, torrentioRateLimiter } from './middlewares/rateLimit.js';
import { metricsService } from './catalogo/MetricsService.js';
import { ultraDebugMiddleware, manifestDebugMiddleware, configureDebugMiddleware } from './middlewares/ultraDebug.js';
import { RescrapeService } from './services/RescrapeService.js';
import { encryptConfig, decryptConfig } from './lib/urlCrypto.js';
import { resolveAnimeRequest } from './rotas/animeRequestResolver.js';
import { setupTorznabRoutes } from './rotas/torznabRoutes.js';
import { StreamRequest } from './types/index.js';

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

app.set('trust proxy', 1);

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());
app.use(ultraDebugMiddleware());
app.use(clientInfoMiddleware());
app.use(metricsService.httpMetricsMiddleware());
app.use(createRateLimiter());

// Interceptor Torrentio / rotas encriptadas
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=') || req.path.startsWith('/e/')) {
        req._torrentioHandled = true;
    }
    next();
});

// Gera o token encriptado usado na URL de manifest (chama isso o "configure" antes de instalar)
app.post('/api/encrypt-config', (req: any, res: any) => {
    const { apiKey, p2p } = req.body || {};
    const isP2p = !!p2p;
    
    // apiKey só é obrigatória se o modo P2P NÃO estiver ativado
    if (!isP2p && (!apiKey || typeof apiKey !== 'string')) {
        return res.status(400).json({ success: false, error: 'apiKey é obrigatória quando o modo P2P não está ativo' });
    }
    
    const token = encryptConfig({ apiKey: apiKey || '', p2p: isP2p });
    res.json({ success: true, token });
});

app.get('/metrics', metricsService.metricsRoute());

const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

async function initializeDatabase() {
    try {
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        await sequelize.authenticate();
    } catch (error) {
        logger.error('Falha no banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados em produção');
        } else {
            throw error;
        }
    }
}

// Cache middleware
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    next();
});

// Configure
app.get('/configure', configureDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('CONFIGURE');
    ultraLogger.info(' Servindo página de configuração HTML', {
        requestId: req._ultraDebugId,
        manifestVersion: manifest.version,
        manifestId: manifest.id,
        host: req.get('host'),
        protocol: req.protocol,
    });
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO 1: /torbox=APIKEY/manifest.json
app.get('/torbox=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('TORBOX-MANIFEST');
    const apiKey = req.params.apiKey;
    ultraLogger.info(' MANIFEST via TORBOX solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 80),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// Compatibilidade: /realdebrid=APIKEY/manifest.json
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('RD-MANIFEST');
    const apiKey = req.params.apiKey;
    ultraLogger.info(' MANIFEST via REALDEBRID solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        host: req.get('host'),
        origin: req.get('origin'),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// ROTA ENCRIPTADA: /e/:token/manifest.json (URL não expõe a API key em texto plano)
app.get('/e/:token/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    const cfg = decryptConfig(req.params.token);
    if (!cfg) {
        return res.status(400).json({ err: 'Token inválido ou expirado' });
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// ROTA ENCRIPTADA: /e/:token/stream/:type/:id.json
app.get('/e/:token/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    const { type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const cfg = decryptConfig(req.params.token);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    const isP2p = !!cfg?.p2p;

    // Permite prosseguir se for P2P, mesmo sem apiKey
    if (!cfg || (!isP2p && (!cfg.apiKey || cfg.apiKey.length < 10))) {
        return res.json({ streams: [] });
    }

    try {
        const { StreamHandler } = await import('./stream/StreamHandler.js');
        const streamHandler = StreamHandler.getInstance();

        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host');
        if (host) {
            streamHandler.setStaticResponseBaseUrl(`${protocol}://${host}`);
        }

        const streamRequest: StreamRequest = {
            type: type as 'movie' | 'series',
            id: decodedId,
            apiKey: cfg.apiKey || '',
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25',
                p2p: isP2p
            }
        };

        await resolveAnimeRequest(streamRequest);
        const result = await streamHandler.handleStreamRequest(streamRequest);
        return res.json(result);
    } catch (error) {
        return res.json({ streams: [] });
    }
});

// ROTA TORRENTIO 2: /torbox=APIKEY/stream/:type/:id.json
app.get('/torbox=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    const ultraLogger = new Logger('STREAM-TORBOX');
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const requestId = req._ultraDebugId || 'no-id';

    const isP2p = req.query.p2p === '1' || req.query.p2p === 'true' || apiKey === 'p2p' || apiKey === 'none';

    ultraLogger.info('═══════════════════════════════════════', {});
    ultraLogger.info(' STREAM SOLICITADO (Torbox route)', {
        requestId,
        type,
        id: decodedId,
        apiKeyPresent: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        isP2p,
        host: req.get('host'),
        origin: req.get('origin'),
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    try {
        // Exige apiKey apenas se NÃO for modo P2P
        if (!isP2p && (!apiKey || apiKey.length < 10)) {
            ultraLogger.warn(' API Key inválida ou ausente para stream', {
                requestId,
                apiKeyLength: apiKey?.length || 0,
                reason: !apiKey ? 'API Key ausente' : 'API Key muito curta (< 10 chars)',
            });
            return res.json({ streams: [] });
        }

        const { StreamHandler } = await import('./stream/StreamHandler.js');
        const streamHandler = StreamHandler.getInstance();

        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host');
        if (host) {
            streamHandler.setStaticResponseBaseUrl(`${protocol}://${host}`);
        }

        const streamRequest: StreamRequest = {
            type: type as 'movie' | 'series',
            id: decodedId,
            apiKey: apiKey || '',
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25',
                p2p: isP2p
            }
        };

        await resolveAnimeRequest(streamRequest);
        const result = await streamHandler.handleStreamRequest(streamRequest);

        ultraLogger.info(' STREAM RESULT retornado', {
            requestId,
            totalStreams: result.streams?.length || 0,
            resumo: result.streams?.slice(0, 8).map((s: any) => {
              const provider = (s.title || '').match(/⚙️\s*([^\n]+)/)?.[1] || '?';
              const quality = s.behaviorHints?.streamQuality || '?';
              const name = (s.title || '').split('\n')[0].substring(0, 50);
              return `${provider} ${quality} | ${name}`;
            }),
        });

        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints?.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080')) quality = '1080p';
                else if (stream.title.includes('720p') || stream.title.includes('720')) quality = '720p';
                else if (stream.title.includes('2160p') || stream.title.includes('4K')) quality = '2160p';
                else if (stream.title.includes('HD')) quality = 'HD';
            }
            metricsService.recordStreamReturned(type, quality);
        });

        return res.json(result);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        ultraLogger.error(' ERRO FATAL na rota Torrentio Stream', {
            requestId,
            error: errorMsg,
            stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
            type,
            id: decodedId,
        });
        return res.json({ streams: [] });
    }
});

// Pula Stremio Router se rota já tratada
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        return next('route');
    }
    next();
});

// LOGGER para rotas do Stremio SDK
app.use((req: any, res: any, next: any) => {
    const sdkLogger = new Logger('SDK-Router');
    // Só loga rotas que o SDK vai processar (manifest, stream, configure)
    const sdkPaths = ['/manifest.json', '/stream/', '/configure'];
    const isSdkPath = sdkPaths.some(p => req.path === p || req.path.startsWith(p));
    if (isSdkPath) {
        sdkLogger.info(' Rota caiu no Stremio SDK Router', {
            requestId: req._ultraDebugId,
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl?.substring(0, 200),
            query: req.query,
            params: req.params,
        });
    }
    next();
});

// Detecta ambiente serverless (Vercel)
const isServerless = !!process.env.VERCEL;
let appReadyPromise: Promise<void> | null = null;

/**
 * Inicializa banco + rotas do SDK Stremio (idempotente).
 * Usado tanto pelo startServer() (Railway/local) quanto pelo handler serverless da Vercel.
 */
async function initApp(): Promise<void> {
    await initializeDatabase();

    setupBasicRoutes(app, manifest);
    setupTorznabRoutes(app);
    setupResolveRoutes(app);
    setupStaticRoutes(app);

    const builder = createStremioBuilder(manifest);
    const stremioRouter = getStremioRouter(builder);

    // INTERCEPTOR para /manifest.json do SDK
    app.use((req: any, res: any, next: any) => {
        if (req.path === '/manifest.json' || req.path === '/manifest') {
            const manifestLogger = new Logger('MANIFEST-SDK');
            manifestLogger.info(' STREMIO PEDIU MANIFEST (via SDK router)', {
                requestId: req._ultraDebugId,
                method: req.method,
                host: req.get('host'),
            });
        }
        next();
    });

    app.use(stremioRouter);

    // Job de re-scraping periódico não roda em serverless (sem estado persistente entre invocações)
    if (!isServerless) {
        RescrapeService.getInstance().start();
    }
}

/** Garante que a app está inicializada e a retorna. Usado pelo entrypoint serverless (api/index.js). */
export async function getApp() {
    if (!appReadyPromise) {
        appReadyPromise = initApp();
    }
    await appReadyPromise;
    return app;
}

async function startServer() {
    try {
        const startupLogger = new Logger('Startup');
        startupLogger.info(`BRASIL RD Addon starting on port ${process.env.PORT || 7000}`);

        await getApp();

        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
    } catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

// Na Vercel, quem inicializa a app é o handler serverless (api/index.js) via getApp().
// Fora da Vercel (Railway/local), sobe o servidor HTTP normalmente.
if (!isServerless) {
    startServer();
}

export { app };
