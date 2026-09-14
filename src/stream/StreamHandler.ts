import { TorboxService } from '../debrid/RealDebridService.js';
import { CuratedMagnetService } from '../catalogo/CuratedMagnetService.js';
import { CacheService } from '../debrid/CacheService.js';
import { Logger } from '../utils/logger.js';
import { Stream, StreamRequest, CuratedMagnet } from '../types/index.js';
import { Op } from 'sequelize';
import { Torrent } from '../database/models.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { CatalogProvider } from '../catalogo/catalogProvider.js';
import { StreamFormatter } from '../stream/streamFormatter.js';
import { StaticResponseService, StaticResponse } from './StaticResponseService.js';
import { StreamStatusException } from './StreamStatusException.js';
import { INDICADORES_INTERNACIONAL_TORRENTS } from '../titulos/TechnicalWords.js';
import { isExcludedRelease } from '../lib/releaseFilter.js';

// Legendado indicators da fonte unica (TechnicalWords)
const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

interface DatabaseStreamResult {
  success: boolean;
  streams: Stream[];
  source: 'database' | 'catalog' | 'scraping';
  processingTime: number;
}

export class StreamHandler {
  private static instance: StreamHandler;
  private readonly torboxService: TorboxService;
  private readonly magnetService: CuratedMagnetService;
  private readonly cacheService: CacheService;
  private readonly logger: Logger;
  private staticResponseService: StaticResponseService;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  // Seeds reais do Torbox (v1.6.2) — cache com TTL p/ não custar por request
  private readonly seedsCache = new Map<string, { seeds: number; timestamp: number }>();
  private readonly SEEDS_CACHE_TTL = 5 * 60 * 1000;
  private readonly SEEDS_FETCH_CONCURRENCY = 8;
  private readonly SEEDS_FETCH_TIMEOUT_SEC = 3;
  private readonly MAX_SEEDS_CACHE_SIZE = 2000;

  // Estatísticas globais
  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    duplicatesRemoved: 0,
    servedInformativeStreams: 0
  };

  private constructor(baseUrl?: string) {
    this.torboxService = new TorboxService(baseUrl);
    this.magnetService = new CuratedMagnetService();
    this.cacheService = new CacheService();
    this.logger = new Logger('StreamHandler');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = QualityDetector.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
    this.catalogProvider = new CatalogProvider(this.magnetService);
  }

  /**
   * Retorna a instancia unica do StreamHandler.
   * Em producao, a URL base deve ser fornecida na primeira chamada.
   */
  public static getInstance(baseUrl?: string): StreamHandler {
    if (!StreamHandler.instance) {
      StreamHandler.instance = new StreamHandler(baseUrl);
    }
    // Atualiza URL base se fornecido e necessario
    if (baseUrl && StreamHandler.instance.staticResponseService.getBaseUrl() !== baseUrl) {
      StreamHandler.instance.setStaticResponseBaseUrl(baseUrl);
    }
    return StreamHandler.instance;
  }

  /**
   * Aguarda a inicializacao dos servicos dependentes (ex: carregar magnets).
   * Deve ser chamado uma unica vez na inicializacao do servidor.
   */
  public async initialize(): Promise<void> {
    await this.magnetService.waitForInitialization();
    // Outros servicos podem ser inicializados aqui se necessario
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
    this.torboxService.setStaticResponseBaseUrl(baseUrl);
    this.streamFormatter.setResolveBaseUrl(baseUrl);
  }

  private deduplicateStreamsByInfoHash(streams: Stream[]): Stream[] {
    const seenCombinations = new Set<string>();
    const uniqueStreams: Stream[] = [];

    for (const stream of streams) {
      const infoHash = stream.infoHash?.toLowerCase();
      let quality = 'unknown';
      if (stream.behaviorHints?.streamQuality) {
        quality = stream.behaviorHints.streamQuality;
      } else if (stream.title) {
        const qualityMatch = stream.title.match(/\((\d+p|4K|HD|SD|2160p|1080p|720p|480p)\)/i);
        if (qualityMatch) {
          quality = qualityMatch[1].toLowerCase();
        }
      }

      // Usa infoHash + qualidade como chave. Se nao tem infoHash, usa titulo + qualidade
      // (evita que streams 1080p e 720p do mesmo torrent sejam tratados como duplicatas)
      const uniqueKey = infoHash
        ? `${infoHash}_${quality}`
        : `${stream.title || 'stream'}_${quality}_${stream.fileIdx ?? 0}`;
      if (seenCombinations.has(uniqueKey)) {
        this.stats.duplicatesRemoved++;
        continue;
      }
      seenCombinations.add(uniqueKey);
      uniqueStreams.push(stream);
    }

    return uniqueStreams;
  }

  public async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    this.stats.totalRequests++;

    if (!request.apiKey && !request.config?.p2p) return { streams: [] };

    try {
      // Garantia de que o serviço de magnets está pronto (caso ainda não inicializado)
      await this.magnetService.waitForInitialization();

      const dbResult = await this.getStreamsFromDatabase(request);
      if (dbResult.success && dbResult.streams.length > 0) {
        this.stats.servedFromDatabase++;
        return { streams: this.deduplicateStreamsByInfoHash(dbResult.streams) };
      }

      const catalogResult = await this.getStreamsFromCatalog(request);
      if (catalogResult.success && catalogResult.streams.length > 0) {
        this.stats.servedFromCatalog++;
        return { streams: this.deduplicateStreamsByInfoHash(catalogResult.streams) };
      }

      // Sem streams no DB nem no catálogo → retorna vazio (sem resultado fake de "Baixando")
      return { streams: [] };
    } catch (error) {
      this.logger.error('Falha no processamento', {
        requestId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      if (error instanceof StreamStatusException) {
        const informativeStream = this.createInformativeStreamFromException(error, requestId);
        this.stats.servedInformativeStreams++;
        return { streams: [informativeStream] };
      }

      const errorStream = this.staticResponseService.createInformativeStream(
        StaticResponse.FAILED_UNEXPECTED,
        requestId
      );
      return { streams: [this.convertToStreamFormat(errorStream)] };
    }
  }

  private createInformativeStreamFromException(exception: StreamStatusException, requestId: string): Stream {
    const informativeStream = this.staticResponseService.createInformativeStream(
      exception.staticResponse,
      requestId
    );
    return this.convertToStreamFormat(informativeStream);
  }

  private convertToStreamFormat(informativeStream: any): Stream {
    const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return {
      title: informativeStream.title || 'Brasil RD - Informacao',
      name: informativeStream.name || 'Brasil RD - Mensagem Informativa',
      description: informativeStream.description || 'Mensagem informativa do addon Brasil RD',
      url: informativeStream.url || 'data:text/plain,Brasil%20RD%20-%20Mensagem%20informativa',
      behaviorHints: { notWebReady: true, bingeGroup: 'br-info' },
      status: 'available',
      infoHash: infoHash,
      magnet: `brasilrd://info/${infoHash}`,
      sources: [`brasilrd://info/${infoHash}`]
    };
  }

  // Enriquece os torrents do banco com seeds REAIS do Torbox (cache 5min).
  // Nunca atrasa além do batch: falha silenciosa mantém os seeds atuais.
  private async enrichTorrentsWithSeeders(torrents: any[], apiKey: string): Promise<void> {
    if (torrents.length === 0) return;

    const hashes = [...new Set(
      torrents
        .map(t => (t.infoHash || '').toLowerCase())
        .filter((h): h is string => typeof h === 'string' && h.length >= 32)
    )];
    if (hashes.length === 0) return;

    const seedsByHash = new Map<string, number>();
    const toFetch: string[] = [];

    for (const hash of hashes) {
      const cached = this.seedsCache.get(hash);
      if (cached && (Date.now() - cached.timestamp) < this.SEEDS_CACHE_TTL) {
        seedsByHash.set(hash, cached.seeds);
      } else {
        toFetch.push(hash);
      }
    }

    for (let i = 0; i < toFetch.length; i += this.SEEDS_FETCH_CONCURRENCY) {
      const batch = toFetch.slice(i, i + this.SEEDS_FETCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(hash =>
          this.torboxService.getTorrentInfoByHash(hash, apiKey, this.SEEDS_FETCH_TIMEOUT_SEC).catch(() => 0)
        )
      );
      for (let j = 0; j < batch.length; j++) {
        const seeds = results[j] || 0;
        seedsByHash.set(batch[j], seeds);
        this.seedsCache.set(batch[j], { seeds, timestamp: Date.now() });
      }
    }

    if (toFetch.length > 0) {
      this.logger.debug('SEEDERS_ENRICH', {
        totalHashes: hashes.length,
        fromCache: hashes.length - toFetch.length,
        fetched: toFetch.length,
      });
    }

    if (this.seedsCache.size > this.MAX_SEEDS_CACHE_SIZE) {
      const entries = [...this.seedsCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, Math.floor(this.MAX_SEEDS_CACHE_SIZE / 2));
      for (const [hash] of toRemove) this.seedsCache.delete(hash);
      this.logger.debug('SEEDERS_CACHE_GC', { removed: toRemove.length, remaining: this.seedsCache.size });
    }

    for (const t of torrents) {
      const hash = (t.infoHash || '').toLowerCase();
      if (hash && seedsByHash.has(hash)) {
        t.seeders = seedsByHash.get(hash)!;
      }
    }
  }

  private async getStreamsFromDatabase(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };

      // Query direta no Torrent (sem tabela File)
      const where: any = { imdbId };
      if (request.type === 'series') {
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) {
          const season = parseInt(seasonMatch[1]);
          const episode = parseInt(seasonMatch[2]);
          where[Op.or] = [
            { imdbSeason: season },
            { imdbSeason: null },  // pack multi-temporada
          ];
          // Filtra por range de episódios: só inclui torrents que cobrem este episódio
          // (ou que não têm range = pack completo da temporada)
          where[Op.and] = [
            {
              [Op.or]: [
                { imdbEpisodeStart: null },
                { imdbEpisodeEnd: null },
                {
                  imdbEpisodeStart: { [Op.lte]: episode },
                  imdbEpisodeEnd: { [Op.gte]: episode },
                },
              ],
            },
          ];
        }
      }

      const torrents = await Torrent.findAll({
        where,
        limit: request.type === 'movie' ? 20 : 30,
        order: [['seeders', 'DESC']],
        raw: true
      });

      // Converte direto — validação já foi feita no save (SimilarityCalculator)
      // Filtra idioma: só retorna torrents PT-BR (exclui Legendado/EN)
      const streams: Stream[] = [];

      // ⚡️ Badge de "em cache no debrid": consulta o Torbox em lote pelos hashes dos resultados
      let cachedHashes = new Set<string>();
      const hashesParaChecar = Array.from(new Set(
        torrents
          .map((t: any) => (t.infoHash || '').trim().toLowerCase())
          .filter(Boolean)
      ));
      if (hashesParaChecar.length > 0 && request.apiKey) {
        try {
          cachedHashes = await this.torboxService.checkCachedHashes(hashesParaChecar, request.apiKey);
        } catch (error) {
          this.logger.debug('Badge de cache nao aplicado (Torbox indisponivel)', {
            error: error instanceof Error ? error.message : 'Erro'
          });
        }
      }

      // ⚡️ Seeds reais do Torbox (v1.6.2): enriquece antes de montar os streams
      if (request.apiKey) {
        try {
          await this.enrichTorrentsWithSeeders(torrents, request.apiKey);
        } catch {
          // falha silenciosa: mantém os seeds atuais
        }
      }

      for (const t of torrents) {
        // Pula torrents com idioma explicitamente Legendado ou EN
        const idioma = (t.idioma || '').toLowerCase();
        if (idioma === 'legendado' || idioma === 'en' || idioma === 'es' || idioma === 'fr') continue;
        // Pula títulos que contenham indicadores de Legendado
        const titleLower = (t.title || '').toLowerCase();
        if (LEGENDADO_REGEX.test(titleLower)) continue;
        if (isExcludedRelease(t.title)) continue;

        const stream = await this.convertTorrentToStream(
          t, request,
          !!t.infoHash && cachedHashes.has(String(t.infoHash).trim().toLowerCase())
        );
        if (stream) streams.push(stream);
      }

      return { success: true, streams, source: 'database', processingTime: Date.now() - startTime };
    } catch (error) {
      this.logger.error('Erro na busca no banco', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        tempo: Date.now() - startTime
      });
      return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
    }
  }

  private async convertTorrentToStream(torrent: any, request: StreamRequest, cachedNoDebrid: boolean = false): Promise<Stream | null> {
    try {
      const quality = torrent.qualidade || this.qualityDetector.extractQualityFromFilename(torrent.title);

      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (match) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }
      }

      // Prepara objeto torrent com magnet (StreamFormatter precisa)
      const torrentWithMagnet = {
        ...torrent,
        magnet: `magnet:?xt=urn:btih:${torrent.infoHash}`,
        magnet_link: `magnet:?xt=urn:btih:${torrent.infoHash}`,
      };

      // Delega ao StreamFormatter (formato StremThru com emojis, compatível com Stremio)
      const streams = await this.streamFormatter.createMultipleQualityStreams(
        torrentWithMagnet,
        request,
        null, // sem directLink (vai gerar URL de resolve)
        request.type,
        season,
        episode,
        false, // isAvailableOnRD
        0,     // fileIdx
        cachedNoDebrid
      );

      return streams[0] || null;
    } catch (error) {
      this.logger.error('Erro ao converter torrent para stream', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  private async getStreamsFromCatalog(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();
    try {
      const streams = await this.catalogProvider.getStreamsFromCatalog(request);
      return { success: true, streams, source: 'catalog', processingTime: Date.now() - startTime };
    } catch (error) {
      return { success: false, streams: [], source: 'catalog', processingTime: Date.now() - startTime };
    }
  }

  private extractImdbIdFromRequest(request: StreamRequest): string | null {
    if (request.imdbId) return request.imdbId;
    const imdbMatch = request.id.match(/^(tt\d+)/);
    return imdbMatch ? imdbMatch[1] : null;
  }

  public addCuratedMagnet(magnet: CuratedMagnet): void {
    this.magnetService.addMagnet(magnet);
    this.invalidateRelatedCache(magnet.imdbId);
  }

  public removeCuratedMagnet(imdbId: string, magnetLink: string): boolean {
    const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
    if (removed) this.invalidateRelatedCache(imdbId);
    return removed;
  }

  public clearCache(): void {
    this.cacheService.clear();
    this.catalogProvider.clearTmdbCache();
  }

  private invalidateRelatedCache(imdbId: string): void {
    const cachePatterns = [
      `streams:movie:${imdbId}`,
      `streams:series:${imdbId}`,
      `streams:series:${imdbId}:*`
    ];
    for (const pattern of cachePatterns) this.cacheService.delete(pattern);
  }

  public getStats() {
    return {
      totalRequests: this.stats.totalRequests,
      servedFromDatabase: this.stats.servedFromDatabase,
      servedFromCatalog: this.stats.servedFromCatalog,
      servedInformativeStreams: this.stats.servedInformativeStreams,
      duplicatesRemoved: this.stats.duplicatesRemoved
    };
  }
}
