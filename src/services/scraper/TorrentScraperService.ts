import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { ImdbScraperService } from '../../catalogo/ImdbScraperService.js';
import { WordPressScraper } from './wordpressScraper.js';
import { BludvScraper } from './bludvScraper.js';
import { searchStarck } from './starckScraper.js';
import { searchHdr } from './hdrScraper.js';
import { EpisodeMatcher } from '../../titulos/episodeMatcher.js';

const logger = new Logger('TorrentScraperService');

const SOURCE_TIMEOUT_MS = 9000;

function withTimeout<T>(promise: Promise<T>, fallback: T, ms: number = SOURCE_TIMEOUT_MS): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))
    ]);
}

export class TorrentScraperService {
    private readonly qualityDetector: QualityDetector;
    private readonly tmdbScraper: ImdbScraperService;
    private readonly wpScraper: WordPressScraper;
    private readonly bludvScraper: BludvScraper;
    private readonly episodeMatcher = EpisodeMatcher.getInstance();
    private readonly version = '6.4.0'; // Melhoria na extração de metadados/tamanho

    constructor(tmdbScraper?: ImdbScraperService) {
        this.qualityDetector = QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService.getInstance();
        this.wpScraper = new WordPressScraper();
        this.bludvScraper = new BludvScraper();
    }

    async searchTorrents(
        query: string,
        type: 'movie' | 'series' | 'anime' = 'movie',
        targetSeason?: number,
        targetYear?: number,
        imdbId?: string,
        alternativeTitles?: string[]
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        try {
            let tmdbData = null;
            if (imdbId) {
                tmdbData = await this.getTmdbData(imdbId, targetSeason);
                if (tmdbData) {
                    const isLatin = (t: string) => /^[a-z0-9\s\-\.']+$/i.test(t);
                    if (tmdbData.originalTitle && !isLatin(tmdbData.originalTitle)) tmdbData.originalTitle = '';
                    if (tmdbData.portugueseTitleRaw && !isLatin(tmdbData.portugueseTitleRaw)) tmdbData.portugueseTitleRaw = '';
                    if (tmdbData.portugueseTitle && !isLatin(tmdbData.portugueseTitle)) tmdbData.portugueseTitle = '';
                }
            }

            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);

            const qEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const qPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const ptDiferente = qPt !== qEn;

            // Títulos alternativos de anime (romaji/native) — DarkMahou indexa por romaji,
            // que nunca aparece nos títulos EN/PT do TMDB. Limite de 2 buscas extras.
            const latinSafe = (t: string) => /^[a-z0-9\s\-\.':,!]+$/.test(t);
            const seenAlt = new Set([qEn.toLowerCase(), qPt.toLowerCase()]);
            const altQueries = (alternativeTitles || [])
                .map(t => (typeof t === 'string' ? t.trim() : ''))
                .filter(t => t.length > 3 && latinSafe(t) && !seenAlt.has(t.toLowerCase()) && seenAlt.add(t.toLowerCase()))
                .slice(0, 2);

            const [wpResults, starckResults, hdrResults] = await Promise.all([
                // WordPress (Comando/DarkMahou/Starck) + Bludv
                withTimeout(Promise.all([
                    this.bludvScraper.search(qEn, type).catch(() => []),
                    this.bludvScraper.search(qPt, type).catch(() => []),
                    this.wpScraper.search(qEn, type).catch(() => []),
                    ptDiferente ? this.wpScraper.search(qPt, type).catch(() => []) : Promise.resolve([]),
                    ...altQueries.map(q => this.wpScraper.search(q, type).catch(() => []))
                ]).then(all => {
                    const seen = new Set<string>();
                    return all.flat().filter(t => {
                        if (seen.has(t.magnet)) return false;
                        seen.add(t.magnet);
                        return true;
                    });
                }).catch(() => []), []),

                // Starck
                withTimeout(Promise.all([
                    searchStarck(qEn, type),
                    ptDiferente ? searchStarck(qPt, type) : Promise.resolve([])
                ]).then(([en, pt]) => {
                    const seen = new Set<string>();
                    return [...en, ...pt]
                        .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
                        .map(r => this.mapStarckResult(r, type))
                        .filter((r): r is TorrentResult => r !== null);
                }).catch(() => []), []),

                // HDR
                withTimeout(Promise.all([
                    searchHdr(qEn, type),
                    ptDiferente ? searchHdr(qPt, type) : Promise.resolve([])
                ]).then(([en, pt]) => {
                    const seen = new Set<string>();
                    return [...en, ...pt]
                        .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
                        .map(r => this.mapHdrResult(r, type))
                        .filter((r): r is TorrentResult => r !== null);
                }).catch(() => []), [])
            ]);

            const allResults = [...wpResults, ...starckResults, ...hdrResults];

            const duration = Date.now() - startTime;
            if (duration > 5000) {
                logger.warn('Coleta de torrents lenta', {
                    tempo: `${duration}ms`,
                    resultados: allResults.length,
                    queries: searchQueries.length
                });
            }

            return allResults;
        } catch (error) {
            logger.error('Erro na coleta de torrents', {
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${Date.now() - startTime}ms`
            });
            return [];
        }
    }

    private async getTmdbData(imdbId: string, season?: number): Promise<any> {
        try {
            return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
        } catch {
            return null;
        }
    }

    private generateSearchQueries(
        query: string,
        type: 'movie' | 'series' | 'anime',
        targetSeason?: number,
        targetYear?: number,
        tmdbData?: any
    ): string[] {
        const queries: string[] = [];
        if (tmdbData?.allTitles?.length > 0) {
            const yearToUse = targetYear || tmdbData.year;
            const titlesReverse = [...tmdbData.allTitles]
              .filter((t: string) => /^[a-z0-9\s\-\.]+$/i.test(t))
              .reverse();
            for (const title of titlesReverse) {
                queries.push(title);
                if (yearToUse) queries.push(`${title} ${yearToUse}`);
                if ((type === 'series' || type === 'anime') && targetSeason !== undefined) {
                    queries.push(`${title} ${targetSeason}ª temporada`);
                    queries.push(`${title} temporada ${targetSeason}`);
                    queries.push(`${title} season ${targetSeason}`);
                }
                const trimmed = title.replace(/^\d+\s*/, '');
                if (trimmed !== title && trimmed.trim().length > 3) queries.push(trimmed);
            }
        }
        if (queries.length === 0) {
            queries.push(query);
            if (targetYear) queries.push(`${query} ${targetYear}`);
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }

    // ═══════════════════════════════════════════════════════════
    //  MAPEAMENTOS E EXTRAÇÃO DE METADADOS
    // ═══════════════════════════════════════════════════════════

    private mapHdrResult(r: { title: string; magnet: string; infoHash: string; seeders: number; size: string; language: string }, type: 'movie' | 'series' | 'anime'): TorrentResult | null {
        if (!r.magnet) return null;
        
        const magnetName = this.extractDisplayNameFromMagnet(r.magnet, r.title);
        const quality = this.qualityDetector.extractQualityFromFilename(magnetName) || this.detectQualityFromText(magnetName);
        const season = this.episodeMatcher.extractSeasonFromTitle(magnetName);
        const language = r.language ? this.mapHdrLanguage(r.language) : this.detectLanguageFromText(magnetName);
        const { formattedSize, sizeInBytes } = this.parseSize(r.size, magnetName);

        return {
            title: magnetName,
            magnet: r.magnet,
            seeders: r.seeders || 0,
            leechers: 0,
            size: formattedSize,
            quality,
            provider: 'HDR Torrent',
            language,
            type,
            relevanceScore: 0,
            sizeInBytes,
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70
        };
    }

    private mapStarckResult(r: { magnet: string; infoHash: string }, type: 'movie' | 'series' | 'anime'): TorrentResult | null {
        if (!r.magnet) return null;

        const displayName = this.extractDisplayNameFromMagnet(r.magnet);
        const quality = this.qualityDetector.extractQualityFromFilename(displayName) || this.detectQualityFromText(displayName);
        const season = this.episodeMatcher.extractSeasonFromTitle(displayName);
        const language = this.detectLanguageFromText(displayName);
        const { formattedSize, sizeInBytes } = this.parseSize('N/A', displayName);

        return {
            title: displayName,
            magnet: r.magnet,
            seeders: 0,
            leechers: 0,
            size: formattedSize,
            quality,
            provider: 'Starck',
            language,
            type,
            relevanceScore: 0,
            sizeInBytes,
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  MÉTODOS AUXILIARES DE PARSING
    // ═══════════════════════════════════════════════════════════

    /**
     * Extrai o nome de exibição (`dn=`) do link magnet com decodificação segura
     */
    private extractDisplayNameFromMagnet(magnet: string, fallbackTitle?: string): string {
        if (!magnet) return fallbackTitle || '';
        const dnMatch = magnet.match(/dn=([^&]+)/i);
        if (dnMatch) {
            try {
                return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
            } catch {
                return dnMatch[1].replace(/\+/g, ' ');
            }
        }
        return fallbackTitle || magnet;
    }

    /**
     * Extrai e calcula o tamanho em Bytes de forma avançada.
     * Tenta primeiro a string direta do scraper e, se falhar/ausente, procura no título/magnet.
     */
    private parseSize(sizeStr?: string, fallbackText?: string): { formattedSize: string; sizeInBytes: number } {
        const DEFAULT_BYTES = 1.5 * 1024 ** 3; // 1.5 GB default
        let textToSearch = sizeStr && sizeStr !== 'N/A' && sizeStr !== 'Tamanho não especificado' 
            ? sizeStr 
            : fallbackText || '';

        if (!textToSearch) {
            return { formattedSize: 'N/A', sizeInBytes: DEFAULT_BYTES };
        }

        // Regex para capturar números com pontuação BR/US e unidades (TB, GB, MB, KB, TiB, etc)
        const sizeRegex = /(\d+(?:[\.,]\d+)?)\s*(TB|T|GB|G|MB|M|KB|K|TiB|GiB|MiB)\b/i;
        const match = textToSearch.match(sizeRegex);

        if (!match) {
            return { 
                formattedSize: sizeStr && sizeStr !== 'N/A' ? sizeStr : 'N/A', 
                sizeInBytes: DEFAULT_BYTES 
            };
        }

        let rawValue = match[1];
        const unit = match[2].toUpperCase();

        // Tratamento de pontuação BR/US (ex: 1.250,50 MB ou 1,5 GB ou 1.5 GB)
        if (rawValue.includes('.') && rawValue.includes(',')) {
            rawValue = rawValue.replace(/\./g, '').replace(',', '.');
        } else {
            rawValue = rawValue.replace(',', '.');
        }

        const numValue = parseFloat(rawValue);
        if (isNaN(numValue)) {
            return { formattedSize: 'N/A', sizeInBytes: DEFAULT_BYTES };
        }

        let multiplier = 1024 ** 3; // Padrão GB
        if (unit.startsWith('T')) multiplier = 1024 ** 4;
        else if (unit.startsWith('G')) multiplier = 1024 ** 3;
        else if (unit.startsWith('M')) multiplier = 1024 ** 2;
        else if (unit.startsWith('K')) multiplier = 1024;

        const sizeInBytes = Math.round(numValue * multiplier);
        const formattedUnit = unit.replace('I', ''); // Normaliza GiB -> GB
        const formattedSize = `${numValue} ${formattedUnit}`;

        return { formattedSize, sizeInBytes };
    }

    /**
     * Tenta extrair a resolução/qualidade diretamente do nome do arquivo
     */
    private detectQualityFromText(text: string): string {
        const lower = text.toLowerCase();
        if (/2160p|4k|uhd/i.test(lower)) return '4K';
        if (/1080p|fhd/i.test(lower)) return '1080p';
        if (/720p|hd/i.test(lower)) return '720p';
        if (/480p|sd/i.test(lower)) return '480p';
        if (/bluray|bdrip/i.test(lower)) return 'Bluray';
        if (/web-dl|webrip/i.test(lower)) return 'WEB-DL';
        return 'HD';
    }

    /**
     * Identifica o idioma a partir de padrões comuns em releases
     */
    private detectLanguageFromText(text: string): string {
        const lower = text.toLowerCase();
        if (/dual[\s\.-]?áudio|dual|multi/i.test(lower)) return 'Dual Áudio';
        if (/dublado|pt[\s\.-]?br|dub/i.test(lower)) return 'Dublado';
        if (/legendado|subbed|leg/i.test(lower)) return 'Legendado';
        if (/nacional/i.test(lower)) return 'Nacional';
        return 'desconhecido';
    }

    private mapHdrLanguage(label: string): string {
        switch (label) {
            case 'Dual Áudio': return 'Dual Áudio';
            case 'Dublado': return 'Dublado';
            case 'Legendado': return 'Legendado';
            case 'Nacional': return 'Nacional';
            default: return this.detectLanguageFromText(label);
        }
    }

    getStats() {
        return {
            versao: this.version,
            provedoresAtivos: 4 // Bludv, WP Comando, Starck, HDR
        };
    }
}
