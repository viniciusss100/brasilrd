import axios from 'axios';
import { Logger } from '../utils/logger.js';

const logger = new Logger('KitsuMapper');

function extractTitleSeason(title: string | null): number | undefined {
    const match = title?.match(/(?:\b(?:season|temporada)\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s+season)\b/i);
    return match ? Number(match[1] || match[2]) : undefined;
}

function cleanAnimeTitle(title: string | null): string | null {
    return title?.replace(/\s+(?:(?:season|temporada)\s*\d+|\d+(?:st|nd|rd|th)\s+season)\s*$/i, '').trim() || null;
}

export interface KitsuMappingResult {
    imdbId: string | null;
    title: string | null;
    animeType: 'movie' | 'series'; // normalizado a partir do animeType do Kitsu
    season?: number;
    episode?: number;
    year?: string;
}

export class KitsuMapper {
    private static instance: KitsuMapper;
    private cache: Map<string, KitsuMappingResult> = new Map();

    private constructor() {}

    public static getInstance(): KitsuMapper {
        if (!KitsuMapper.instance) {
            KitsuMapper.instance = new KitsuMapper();
        }
        return KitsuMapper.instance;
    }

    /**
     * Mapeia um ID do Kitsu para obter metadados (título e imdb_id se existir).
     */
    public async mapKitsuId(kitsuId: string): Promise<KitsuMappingResult | null> {
        if (this.cache.has(kitsuId)) {
            return this.cache.get(kitsuId)!;
        }

        try {
            const parts = kitsuId.split(':');
            const mainAnimeId = `${parts[0]}:${parts[1]}`;
            const isEpisode = parts.length === 3;

            const url = `https://kitsufortheweebs.midnightignite.me/meta/anime/${mainAnimeId}.json`;
            const response = await axios.get(url, { timeout: 5000 });

            if (!response.data || !response.data.meta) {
                return this.mapKitsuEdgeId(kitsuId);
            }

            const meta = response.data.meta;
            const imdbId = meta.imdb_id || null;
            const originalTitle = meta.name || null;
            const title = cleanAnimeTitle(originalTitle);
            const titleSeason = extractTitleSeason(originalTitle);
            const year = meta.releaseInfo || meta.year || null;
            // animeType: 'Movie' -> movie, tudo mais -> series
            const animeType: 'movie' | 'series' =
                (meta.animeType || '').toLowerCase() === 'movie' ? 'movie' : 'series';

            if (!isEpisode) {
                const result = { imdbId, title, animeType, year };
                this.cache.set(kitsuId, result);
                return result;
            }

            const videos = meta.videos || [];
            const video = videos.find((v: any) => v.id === kitsuId);

            if (video) {
                const result = {
                    imdbId: video.imdb_id || imdbId,
                    title: title,
                    animeType,
                    season: titleSeason && (video.imdbSeason || video.season || 1) === 1
                        ? titleSeason
                        : (video.imdbSeason || video.season || 1),
                    episode: video.imdbEpisode || video.episode,
                    year: year
                };
                this.cache.set(kitsuId, result);
                return result;
            }

            const result = { imdbId, title, animeType, year };
            this.cache.set(kitsuId, result);
            return result;

        } catch (error) {
            logger.warn(`Fallback para API Kitsu no ID ${kitsuId}`, {
                error: error instanceof Error ? error.message : 'Desconhecido'
            });
            return this.mapKitsuEdgeId(kitsuId);
        }
    }

    /** Fallback independente do addon Kitsu para não perder o título na busca. */
    private async mapKitsuEdgeId(kitsuId: string): Promise<KitsuMappingResult | null> {
        try {
            const parts = kitsuId.split(':');
            const animeId = parts[1];
            if (!animeId || !/^\d+$/.test(animeId)) return null;

            const { data } = await axios.get(`https://kitsu.io/api/edge/anime/${animeId}`, { timeout: 5000 });
            const attributes = data?.data?.attributes;
            if (!attributes) return null;

            const episode = parts[2] && /^\d+$/.test(parts[2]) ? Number(parts[2]) : undefined;
            const result: KitsuMappingResult = {
                imdbId: null,
                title: attributes.canonicalTitle || attributes.titles?.en || attributes.titles?.en_jp || attributes.titles?.ja_jp || null,
                animeType: attributes.subtype === 'movie' ? 'movie' : 'series',
                season: episode === undefined ? undefined : 1,
                episode,
                year: attributes.startDate?.slice(0, 4),
            };
            this.cache.set(kitsuId, result);
            return result.title ? result : null;
        } catch (error) {
            logger.error(`Erro no fallback Kitsu ID ${kitsuId}`, {
                error: error instanceof Error ? error.message : 'Desconhecido'
            });
            return null;
        }
    }

    /** Resolve os IDs de anime aceitos pelos catálogos do Stremio. */
    public async mapAnimeId(id: string): Promise<KitsuMappingResult | null> {
        const provider = id.split(':', 1)[0].toLowerCase();
        if (provider === 'kitsu') return this.mapKitsuId(id);

        if (!['mal', 'myanimelist', 'anilist', 'tvdb'].includes(provider)) return null;
        if (this.cache.has(id)) return this.cache.get(id)!;

        const match = id.match(/^[^:]+:(\d+)(?::(\d+))?(?::(\d+))?$/);
        if (!match) return null;

        try {
            const mapping = provider === 'anilist'
                ? await this.mapAniListId(match[1])
                : provider === 'tvdb'
                    ? await this.mapTvdbId(match[1])
                    : await this.mapMyAnimeListId(match[1]);

            if (!mapping) return null;

            // IDs não-Kitsu usam :temporada:episódio quando presentes.
            if (match[3] !== undefined) {
                mapping.season = Number(match[2]);
                mapping.episode = Number(match[3]);
            } else if (match[2] !== undefined) {
                mapping.season = 1;
                mapping.episode = Number(match[2]);
            }
            this.cache.set(id, mapping);
            return mapping;
        } catch (error) {
            logger.error(`Erro ao mapear ID de anime ${id}`, {
                error: error instanceof Error ? error.message : 'Desconhecido'
            });
            return null;
        }
    }

    private async mapMyAnimeListId(id: string): Promise<KitsuMappingResult | null> {
        const { data } = await axios.get(`https://api.jikan.moe/v4/anime/${id}/full`, { timeout: 5000 });
        const anime = data?.data;
        if (!anime) return null;

        const imdb = anime.external?.find((link: any) => link.name === 'IMDb')?.url?.match(/tt\d+/)?.[0] || null;
        return {
            imdbId: imdb,
            title: anime.title_english || anime.title || anime.title_japanese || null,
            animeType: anime.type === 'Movie' ? 'movie' : 'series',
            year: anime.year ? String(anime.year) : undefined,
        };
    }

    private async mapAniListId(id: string): Promise<KitsuMappingResult | null> {
        const { data } = await axios.post('https://graphql.anilist.co', {
            query: `query ($id: Int) { Media(id: $id, type: ANIME) { title { english romaji native } format startDate { year } externalLinks { site url } } }`,
            variables: { id: Number(id) },
        }, { timeout: 5000 });
        const anime = data?.data?.Media;
        if (!anime) return null;

        const imdb = anime.externalLinks?.find((link: any) => link.site === 'IMDb')?.url?.match(/tt\d+/)?.[0] || null;
        return {
            imdbId: imdb,
            title: anime.title?.english || anime.title?.romaji || anime.title?.native || null,
            animeType: anime.format === 'MOVIE' ? 'movie' : 'series',
            year: anime.startDate?.year ? String(anime.startDate.year) : undefined,
        };
    }

    private async mapTvdbId(id: string): Promise<KitsuMappingResult | null> {
        const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/series/tvdb:${id}.json`, { timeout: 5000 });
        const meta = data?.meta;
        if (!meta) return null;

        return {
            imdbId: meta.imdb_id || null,
            title: meta.name || null,
            animeType: meta.type === 'movie' ? 'movie' : 'series',
            year: meta.releaseInfo || meta.year || null,
        };
    }
}
