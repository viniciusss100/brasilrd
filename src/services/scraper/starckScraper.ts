// Starck Filmes HTML Scraper — busca → magnets diretos/base64
// Usa o mesmo DNS bypass do WordPress/TPB scraper
// Apenas entrega dados brutos do HTML (igual TPB/RARGB scraper)

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = process.env.STARCK_BASE_URL?.trim() || 'https://starckfilmes-v31.com';

// ── Tipos ─────────────────────────────────────────────────────────────

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
}

// ── Config do axios (igual TPB/WordPress) ─────────────────────────────
const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Busca → lista de URLs de posts
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  postUrl: string;
}

interface StarckSearchResult {
  links: SearchResultItem[];
  directMagnets: StarckTorrent[];
}

// Base64 URL-safe → string UTF-8. Retorna null quando o payload é inválido.
function decodeBase64Url(entrada: string): string | null {
  let s = entrada.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

// O site passou a "embaralhar" o payload com um padrão determinístico
// (passo 3) antes de mandar em base64url. Reverte exatamente o mesmo laço.
function unshuffleString(entrada: string): string {
  const n = entrada.length;
  const resultado = new Array<string>(n);
  const visitado = new Array<boolean>(n).fill(false);
  let o = 0;

  for (let t = 0; t < n; t++) {
    while (visitado[o]) o = (o + 1) % n;
    visitado[o] = true;
    resultado[t] = entrada[o];
    o = (o + 3) % n;
  }

  return resultado.join('');
}

// Links de download usam ?id= / ?xid= com magnet em base64url embaralhado.
// Mantém fallback para base64 direto de posts antigos.
function decodeLinkMagnets(html: string): StarckTorrent[] {
  const results: StarckTorrent[] = [];
  const seen = new Set<string>();
  const $ = cheerio.load(html);

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const idMatch = href.match(/[?&](x?id)=([^&]+)/i);
    if (!idMatch) return;

    let valor: string;
    try {
      valor = decodeURIComponent(idMatch[2]);
    } catch {
      return;
    }

    let magnet = decodeBase64Url(unshuffleString(valor));
    if (!magnet || !magnet.startsWith('magnet:?')) {
      // Compatibilidade com o formato antigo (sem shuffle).
      magnet = decodeBase64Url(valor);
    }
    if (!magnet || !magnet.startsWith('magnet:?')) return;

    magnet = magnet.replace(/&amp;/gi, '&');
    const hash = magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1]?.toLowerCase();
    if (!hash || seen.has(hash)) return;

    seen.add(hash);
    results.push({ magnet, infoHash: hash });
  });

  return results;
}

function decodeDirectMagnets(html: string): StarckTorrent[] {
  const results: StarckTorrent[] = [];
  const seen = new Set<string>();
  const matches = html.match(/magnet:\?[^"'<>\s]+/gi) || [];
  for (const raw of matches) {
    const magnet = raw.replace(/&amp;/gi, '&');
    const hash = magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1]?.toLowerCase();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    results.push({ magnet, infoHash: hash });
  }
  return results;
}

async function searchStarckLinks(query: string): Promise<StarckSearchResult> {
  const searchUrl = `${STARCK_BASE}/?s=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/catalog/"]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 5 || text === 'Detalhes') return;
      if (seen.has(href)) return;
      seen.add(href);

      results.push({
        title: text,
        postUrl: href.startsWith('http') ? href : `${STARCK_BASE}${href}`,
      });
    });

    return {
      links: results.slice(0, 40),
      directMagnets: [
        ...decodeDirectMagnets(res.data),
        ...decodeLinkMagnets(res.data),
      ],
    };
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: query.substring(0, 50), error: err.message });
    return { links: [], directMagnets: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets base64 da página de post
// ═══════════════════════════════════════════════════════════════════════

function decodeBase64Magnets(html: string): StarckTorrent[] {
  const results: StarckTorrent[] = [];
  const seen = new Set<string>();

  const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
  let match;

  while ((match = b64Regex.exec(html)) !== null) {
    const b64 = match[0];
    if (seen.has(b64)) continue;
    seen.add(b64);

    try {
      const decoded = Buffer.from(b64, 'base64').toString('latin1')
        .replace(/&amp;/gi, '&');

      if (!decoded.startsWith('magnet:?')) continue;

      const btihMatch = decoded.match(/btih:([a-fA-F0-9]{40})/i);
      if (!btihMatch) continue;

      results.push({
        magnet: decoded,
        infoHash: btihMatch[1].toLowerCase(),
      });
    } catch {
      // Base64 inválido, ignora
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

export async function searchStarck(
  query: string,
  type: 'movie' | 'series' | 'anime' = 'movie'
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  try {
    // PASSO 1: Busca → URLs de posts
    const search = await searchStarckLinks(query);
    const links = search.links;
    const allResults: StarckTorrent[] = [...search.directMagnets];
    if (links.length === 0 && allResults.length === 0) return [];

    // PASSO 2: Para cada post, extrai magnets (paralelo, max 8)
    const batchSize = 8;
    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await axios.get(item.postUrl, axiosConfig);
            return [
              ...decodeBase64Magnets(res.data),
              ...decodeLinkMagnets(res.data),
            ];
          } catch {
            return [];
          }
        })
      );

      for (const results of batchResults) {
        allResults.push(...results);
      }
    }

    // Dedup global por infoHash — o mesmo magnet pode aparecer no direct,
    // no base64 longo e no link ?id= da mesma página.
    const seen = new Set<string>();
    const unicos = allResults.filter(t => {
      if (seen.has(t.infoHash)) return false;
      seen.add(t.infoHash);
      return true;
    });

    const duration = Date.now() - startTime;
    logger.info(`Starck: ${unicos.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);

    return unicos;
  } catch (err: any) {
    logger.error('Starck erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}
