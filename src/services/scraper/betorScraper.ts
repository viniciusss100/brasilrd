import { Logger } from '../../utils/logger.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { TorrentResult } from './torrentTypes.js';
import { requisicaoComFallback } from './wordpressScraper.js';

const logger = new Logger('BetorScraper');

// ─── Betor API response shape ────────────────────────────────────────────────
interface BetorItem {
  magnet_uri?: string;
  magnet_xt?: string;     // base32 infohash (32 chars) OR hex (40 chars)
  torrent_name?: string;
  magnet_dn?: string;
  languages?: string[];
  provider_slug?: string;
  imdb_id?: string;
  tmdb_id?: number;
  torrent_size?: number;  // bytes
  torrent_num_seeds?: number;
  episodes?: number[];
  seasons?: number[];
  item_type?: string;     // 'movie' | 'series' | ...
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizarBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Betor returns `magnet_xt` as base32 (32 chars) or hex (40 chars).
 * Convert base32 → hex so analisarMagnet / infoHash checks work.
 */
function base32ToHex(b32: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const upper = b32.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const ch of upper) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  // Trim to nearest byte
  bits = bits.substring(0, Math.floor(bits.length / 8) * 8);
  let hex = '';
  for (let i = 0; i < bits.length; i += 8) {
    hex += parseInt(bits.slice(i, i + 8), 2).toString(16).padStart(2, '0');
  }
  return hex;
}

function resolveInfoHash(item: BetorItem): string {
  // Try magnet_uri first
  if (item.magnet_uri) {
    const m = item.magnet_uri.match(/urn:btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})/i);
    if (m) {
      const raw = m[1];
      return raw.length === 40 ? raw.toLowerCase() : base32ToHex(raw).toLowerCase();
    }
  }
  if (!item.magnet_xt) return '';
  if (/^[a-fA-F0-9]{40}$/.test(item.magnet_xt)) return item.magnet_xt.toLowerCase();
  if (/^[A-Za-z2-7]{32}$/.test(item.magnet_xt)) return base32ToHex(item.magnet_xt).toLowerCase();
  return '';
}

function buildMagnet(infoHash: string, displayName?: string): string {
  let uri = `magnet:?xt=urn:btih:${infoHash}`;
  if (displayName) uri += `&dn=${encodeURIComponent(displayName)}`;
  return uri;
}

function mapLanguage(langs?: string[]): string {
  if (!langs || langs.length === 0) return 'Desconhecido';
  const ls = langs.map(l => l.toLowerCase());
  const pt = ls.some(l => l.includes('por') || l.includes('pt') || l.includes('brazil'));
  const en = ls.some(l => l.includes('eng') || l.includes('en'));
  if (pt && en) return 'Dual Áudio';
  if (pt) return 'Dublado';
  if (en) return 'Legendado';
  return langs.join(' | ');
}

function formatSize(bytes?: number): { size: string; sizeInBytes: number } {
  if (!bytes || bytes <= 0) return { size: 'N/A', sizeInBytes: 0 };
  if (bytes >= 1024 ** 4) return { size: `${(bytes / 1024 ** 4).toFixed(2)} TB`, sizeInBytes: bytes };
  if (bytes >= 1024 ** 3) return { size: `${(bytes / 1024 ** 3).toFixed(2)} GB`, sizeInBytes: bytes };
  if (bytes >= 1024 ** 2) return { size: `${(bytes / 1024 ** 2).toFixed(2)} MB`, sizeInBytes: bytes };
  return { size: `${(bytes / 1024).toFixed(2)} KB`, sizeInBytes: bytes };
}

// ─── Main search function ─────────────────────────────────────────────────────

export interface BetorSearchOptions {
  baseUrl?: string;
  timeout?: number;
  season?: number;
  episode?: number;
}

export async function searchBetor(
  query: string,
  type: 'movie' | 'series' | 'anime' = 'movie',
  imdbId?: string,
  options: BetorSearchOptions = {}
): Promise<TorrentResult[]> {
  const baseUrl = normalizarBaseUrl(
    options.baseUrl || process.env.BETOR_SEARCH_URL?.trim() || 'https://search.betor.top'
  );
  const qualidade = QualityDetector.getInstance();

  const params: Record<string, string | number | boolean> = {};

  if (imdbId) {
    // Prefer IMDB-based lookup (most reliable)
    params.imdb_id = imdbId.replace(/^tt/, '');
    if (options.season !== undefined) params.season = options.season;
    if (options.episode !== undefined) params.episode = options.episode;
  } else {
    params.q = query;
    if (options.season !== undefined) params.season = options.season;
    if (options.episode !== undefined) params.episode = options.episode;
  }

  try {
    const response = await requisicaoComFallback(`${baseUrl}/v1/search/`, {
      timeout: options.timeout ?? 15000,
      params,
    });

    const raw: BetorItem[] = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response.data?.results)
      ? response.data.results
      : [];

    const resultados: TorrentResult[] = [];
    const hashes = new Set<string>();

    for (const item of raw) {
      const titulo = (item.torrent_name || item.magnet_dn || '').trim();
      if (!titulo) continue;

      const infoHash = resolveInfoHash(item);
      if (!/^[a-f0-9]{40}$/.test(infoHash) || hashes.has(infoHash)) continue;
      hashes.add(infoHash);

      const magnet = item.magnet_uri || buildMagnet(infoHash, titulo);
      const language = mapLanguage(item.languages);
      const { size, sizeInBytes } = formatSize(item.torrent_size);
      const quality = qualidade.extractQualityFromFilename(titulo);

      const season = item.seasons?.[0];
      const episode = item.episodes?.[0];

      resultados.push({
        title: titulo,
        magnet,
        seeders: item.torrent_num_seeds || 0,
        leechers: 0,
        size,
        quality,
        provider: 'Betor',
        language,
        type,
        relevanceScore: imdbId ? 0.95 : 0.80,
        sizeInBytes,
        infoHash,
        season,
        episode,
        imdbConfirmed: !!imdbId,
        lastUpdated: new Date(),
        confidence: imdbId ? 0.90 : 0.75,
      });
    }

    if (resultados.length === 0) {
      logger.debug('Betor retornou zero resultados', { query: query.substring(0, 60), imdbId });
    }

    return resultados;
  } catch (error) {
    logger.warn('Betor falhou', {
      query: query.substring(0, 60),
      imdbId,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    });
    return [];
  }
}
