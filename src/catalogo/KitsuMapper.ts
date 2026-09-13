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
    /** Títulos alternativos (romaji, native, sinônimos) — essenciais p/ DarkMahou */
    altTitles?: string[];
    animeType: 'movie' | 'series'; // normalizado a partir do animeType do Kitsu
    season?: number;
    episode?: number;
    year?: string;
}

/** Coleta títulos alternativos únicos, descartando o título principal. */
function coletarAltTitles(candidatos: Array<string | null | undefined>, tituloPrincipal: string | null): string[] {
    const vistos = new Set([tituloPrincipal?.toLowerCase().trim(), '']);
    const alt: string[] = [];
    for (const c of candidatos) {
        const t = typeof c === 'string' ? c.trim() : '';
        if (t.length < 2 || vistos.has(t.toLowerCase())) continue;
        vistos.add(t.toLowerCase());
        alt.push(t);
    }
    return alt.slice(0, 8);
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
     *
     * NOTA: a API 3rd-party antiga (kitsufortheweebs.midnightignite.me) está
     * FORA DO AR — vamos direto à API oficial do Kitsu (edge), que entrega
     * canonicalTitle (romaji), en_jp/ja_jp e subtype.
     */
    public async mapKitsuId(kitsuId: string): Promise<KitsuMappingResult | null> {
        if (this.cache.has(kitsuId)) {
            return this.cache.get(kitsuId)!;
        }
        return this.mapKitsuEdgeId(kitsuId);
    }

    /** Busca atributos do anime na API edge oficial do Kitsu. */
    private async fetchKitsuEdgeAttributes(animeId: string): Promise<any | null> {
        try {
            if (!animeId || !/^\d+$/.test(animeId)) return null;
            const { data } = await axios.get(`https://kitsu.io/api/edge/anime/${animeId}`, { timeout: 5000 });
            return data?.data?.attributes || null;
        } catch {
            return null;
        }
    }

    /** Fallback independente do addon Kitsu para não perder o título na busca. */
    private async mapKitsuEdgeId(kitsuId: string): Promise<KitsuMappingResult | null> {
        try {
            const parts = kitsuId.split(':');
            const animeId = parts[1];
            if (!animeId || !/^\d+$/.test(animeId)) return null;

            const attributes = await this.fetchKitsuEdgeAttributes(animeId);
            if (!attributes) return null;

            const episode = parts[2] && /^\d+$/.test(parts[2]) ? Number(parts[2]) : undefined;
            const titles = attributes.titles || {};
            const title = attributes.canonicalTitle || titles.en || titles.en_jp || titles.ja_jp || null;
            // en_jp = romaji, ja_jp = kanji — DarkMahou indexa majoritariamente romaji
            const altTitles = coletarAltTitles([
                titles.en_jp,
                titles.ja_jp,
                ...(Array.isArray(attributes.abbreviatedTitles) ? attributes.abbreviatedTitles : []),
            ], title);
            const result: KitsuMappingResult = {
                imdbId: null,
                title,
                altTitles,
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

        if (!['mal', 'myanimelist', 'anilist', 'tvdb', 'tmdb'].includes(provider)) return null;
        if (this.cache.has(id)) return this.cache.get(id)!;

        const match = id.match(/^[^:]+:(\d+)(?::(\d+))?(?::(\d+))?$/);
        if (!match) return null;

        try {
            const mapping = provider === 'anilist'
                ? await this.mapAniListId(match[1])
                : provider === 'tvdb'
                    ? await this.mapTvdbId(match[1])
                    : provider === 'tmdb'
                        ? await this.mapTmdbId(match[1])
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
        // Jikan: `title` é o romaji — o nome que sites de torrent de anime usam
        const title = anime.title_english || anime.title || anime.title_japanese || null;
        return {
            imdbId: imdb,
            title,
            altTitles: coletarAltTitles([
                anime.title,
                anime.title_japanese,
                ...(Array.isArray(anime.synonyms) ? anime.synonyms : []),
                ...(Array.isArray(anime.title_synonyms) ? anime.title_synonyms : []),
            ], title),
            animeType: anime.type === 'Movie' ? 'movie' : 'series',
            year: anime.year ? String(anime.year) : undefined,
        };
    }

    private async mapAniListId(id: string): Promise<KitsuMappingResult | null> {
        const { data } = await axios.post('https://graphql.anilist.co', {
            query: `query ($id: Int) { Media(id: $id, type: ANIME) { title { english romaji native } synonyms format startDate { year } externalLinks { site url } } }`,
            variables: { id: Number(id) },
        }, { timeout: 5000 });
        const anime = data?.data?.Media;
        if (!anime) return null;

        const imdb = anime.externalLinks?.find((link: any) => link.site === 'IMDb')?.url?.match(/tt\d+/)?.[0] || null;
        const title = anime.title?.english || anime.title?.romaji || anime.title?.native || null;
        return {
            imdbId: imdb,
            title,
            altTitles: coletarAltTitles([
                anime.title?.romaji,
                anime.title?.native,
                ...(Array.isArray(anime.synonyms) ? anime.synonyms : []),
            ], title),
            animeType: anime.format === 'MOVIE' ? 'movie' : 'series',
            year: anime.startDate?.year ? String(anime.startDate.year) : undefined,
        };
    }

    private async mapTvdbId(id: string): Promise<KitsuMappingResult | null> {
        const key = this.tmdbApiKey;
        if (key) {
            try {
                // TVDB -> TMDB via Find API (robusto), depois título + IMDb via TMDB
                const find = await this.tmdbFetch(`/find/${id}`, { external_source: 'tvdb_id' });
                const tv = find?.tv_results?.[0];
                const movie = find?.movie_results?.[0];
                const mediaId = tv?.id ?? movie?.id;
                if (mediaId !== undefined) {
                    const media = await this.fetchTmdbMedia(String(mediaId));
                    if (media?.name) return this.buildFromTmdbMedia(media);
                }
            } catch (error) {
                logger.warn('TMDB find (tvdb) falhou, tentando cinemeta', { error: (error as Error).message });
            }
        }

        // Fallback legado: cinemeta strem.io
        try {
            const { data } = await axios.get(`https://v3-cinemeta.strem.io/meta/series/tvdb:${id}.json`, { timeout: 8000 });
            const meta = data?.meta;
            if (!meta) return null;
            return {
                imdbId: meta.imdb_id || null,
                title: meta.name || null,
                altTitles: coletarAltTitles(Array.isArray(meta.aliases) ? meta.aliases : [], meta.name || null),
                animeType: meta.type === 'movie' ? 'movie' : 'series',
                year: meta.releaseInfo || meta.year || null,
            };
        } catch {
            return null;
        }
    }

    /** Suporte a IDs do TMDB diretamente (xperience/jellyfin catalogam animes por tmdb). */
    private async mapTmdbId(id: string): Promise<KitsuMappingResult | null> {
        const media = await this.fetchTmdbMedia(id);
        if (!media?.name) return null;
        return this.buildFromTmdbMedia(media);
    }

    private async buildFromTmdbMedia(media: { name: string | null; imdbId: string | null; year: string | undefined; animeType: 'movie' | 'series' }): Promise<KitsuMappingResult> {
        const title = cleanAnimeTitle(media.name);
        return {
            imdbId: media.imdbId,
            title,
            // Tenta incluir o título original (romaji/JP) como alternativo para o DarkMahou
            altTitles: [],
            animeType: media.animeType,
            season: extractTitleSeason(media.name),
            year: media.year,
        };
    }

    private get tmdbApiKey(): string {
        return (process.env.TMDB_API_KEY || '').trim();
    }

    private async tmdbFetch(url: string, extraParams: Record<string, string> = {}): Promise<any> {
        const key = this.tmdbApiKey;
        if (!key) return null;
        const { data } = await axios.get(`https://api.themoviedb.org/3${url}`, {
            timeout: 6000,
            params: { api_key: key, language: 'pt-BR', ...extraParams },
        });
        return data;
    }

    /** Busca título/imdb/ano de um ID TMDB (TV ou Movie). */
    private async fetchTmdbMedia(tmdbId: string): Promise<{ name: string | null; imdbId: string | null; year: string | undefined; animeType: 'movie' | 'series' } | null> {
        try {
            const tv = await this.tmdbFetch(`/tv/${tmdbId}`, { include_image_language: '' });
            if (tv && tv.id) {
                const ext = await this.tmdbFetch(`/tv/${tmdbId}/external_ids`).catch(() => null);
                return {
                    name: tv.name || tv.original_name || null,
                    imdbId: ext?.imdb_id || null,
                    year: tv.first_air_date?.slice(0, 4) ?? undefined,
                    animeType: 'series',
                };
            }
        } catch { /* try movie */ }
        try {
            const movie = await this.tmdbFetch(`/movie/${tmdbId}`, { include_image_language: '' });
            if (movie && movie.id) {
                const ext = await this.tmdbFetch(`/movie/${tmdbId}/external_ids`).catch(() => null);
                return {
                    name: movie.title || movie.original_title || null,
                    imdbId: ext?.imdb_id || null,
                    year: movie.release_date?.slice(0, 4) ?? undefined,
                    animeType: 'movie',
                };
            }
        } catch { /* ignore */ }
        return null;
    }
}
