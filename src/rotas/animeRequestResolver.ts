import { KitsuMapper } from '../catalogo/KitsuMapper.js';
import { StreamRequest } from '../types/index.js';

const ANIME_ID_REGEX = /^(kitsu|mal|myanimelist|anilist|tvdb):/i;

export async function resolveAnimeRequest(request: StreamRequest): Promise<StreamRequest> {
    if (!ANIME_ID_REGEX.test(request.id)) return request;

    const mapping = await KitsuMapper.getInstance().mapAnimeId(request.id);
    if (!mapping) return request;

    request.type = mapping.animeType;
    if (mapping.imdbId) {
        request.id = mapping.season !== undefined && mapping.episode !== undefined
            ? `${mapping.imdbId}:${mapping.season}:${mapping.episode}`
            : mapping.imdbId;
    } else {
        request.season = mapping.season;
        request.episode = mapping.episode;
    }
    if (mapping.title) request.title = mapping.title;
    if (mapping.altTitles?.length) {
        request.alternativeTitles = [...new Set(mapping.altTitles.map(t => t.trim()))]
            .filter(t => t.length > 2 && t.toLowerCase() !== (mapping.title || '').toLowerCase());
    }
    return request;
}
