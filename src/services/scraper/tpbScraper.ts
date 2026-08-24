// The Pirate Bay HTML Scraper — usa cheerio pra parsear tabela de torrents

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps as dnsAgent, lookupCustomizado } from './wordpressScraper.js';

const logger = new Logger('TPBScraper');

export interface TpbTorrent {
  title: string;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  infoHash: string;
}

const MIRRORS = [
  { url: 'https://www4.thepiratebay3.co', priority: 1 },
  { url: 'https://piratebay.live', priority: 2 },
  { url: 'https://1.piratebays.to', priority: 3 },
  { url: 'https://tpb.party', priority: 4 },
];

export async function searchTpb(query: string, type: 'movie' | 'series' | 'anime' = 'movie'): Promise<TpbTorrent[]> {
  // Tenta query completo primeiro, depois versões mais curtas (TPB é restritivo com queries longas)
  const words = query.split(' ').filter(w => w.length > 1);
  const queriesToTry: string[] = [query]; // query completo
  
  // Fallback progressivo: primeiras 3 palavras, depois 2 palavras
  if (words.length > 3) queriesToTry.push(words.slice(0, 3).join(' '));
  if (words.length > 2) queriesToTry.push(words.slice(0, 2).join(' '));
  
  for (const q of queriesToTry) {
    const isFallback = q !== query;
    for (const mirror of MIRRORS.sort((a, b) => a.priority - b.priority)) {
      try {
        // Formato 1: /search/ (piratebay.live, tpb.party)
        const results1 = await scrapeMirror(mirror.url, q, 'search');
        if (results1.length > 0) {
          if (isFallback) logger.debug(`TPB fallback "${q}" → ${results1.length} torrents (${mirror.url})`);
          return results1;
        }
        // Formato 2: /s/?q= (1.piratebays.to)
        const results2 = await scrapeMirror(mirror.url, q, 's');
        if (results2.length > 0) {
          if (isFallback) logger.debug(`TPB fallback "${q}" → ${results2.length} torrents (${mirror.url})`);
          return results2;
        }
      } catch (err: any) {
        logger.warn(`TPB mirror ${mirror.url} falhou: ${err.code || err.message}`);
      }
    }
  }
  return [];
}

async function scrapeMirror(baseUrl: string, query: string, format: 'search' | 's'): Promise<TpbTorrent[]> {
  const encoded = encodeURIComponent(query);
  const searchUrl = format === 'search'
    ? `${baseUrl}/search/${encoded}/1/99/0`
    : `${baseUrl}/s/?q=${encoded}&category=0`;
  
  const res = await axios.get(searchUrl, {
    timeout: 15000,
    httpsAgent: dnsAgent,
    lookup: lookupCustomizado,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    },
  });

  const $ = cheerio.load(res.data);
  const torrents: TpbTorrent[] = [];

  // Helper: decodifica HTML entities via cheerio (tag <span> é válida)
  const decode = (s: string) => cheerio.load(`<span>${s}</span>`)('span').text();

  // Suporta ambos formatos de tabela: com tbody (piratebay.live) e sem (1.piratebays.to)
  const rows = $('table tr').toArray().filter(row => $(row).find('td').length >= 3);

  for (const row of rows) {
    const tds = $(row).find('td');
    if (tds.length < 3) continue;

    // Encontra a coluna com magnet link
    let title = '';
    let magnetLink = '';
    for (let i = 0; i < tds.length; i++) {
      const magA = $(tds[i]).find('a[href^="magnet:"]').first().attr('href');
      if (magA) {
        magnetLink = magA;
        title = decode($(tds[i]).find('a').first().text().trim());
        if (!title) title = decode($(tds[i]).text().trim().split('\n')[0].trim());
        break;
      }
    }
    if (!title || !magnetLink) continue;

    const infoHashMatch = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
    if (!infoHashMatch) continue;
    const infoHash = infoHashMatch[1].toLowerCase();

    // Seeders/leechers: penúltimas colunas com números
    let seeders = 0, leechers = 0;
    for (let i = tds.length - 1; i >= 1; i--) {
      const val = parseInt($(tds[i]).text().trim());
      if (!isNaN(val) && val > 0) {
        if (!leechers) { leechers = val; }
        else { seeders = val; break; }
      }
    }

    torrents.push({ title, magnet: magnetLink, seeders, leechers, size: 'N/A', infoHash });
  }

  if (torrents.length > 0) {
    logger.debug(`TPB ${baseUrl}: ${torrents.length} torrents`, { query: query.substring(0, 40), format });
  }
  return torrents;
}
