/**
 * ExternalAddonService
 *
 * Agrega streams de addons externos (Stremio-compatible) configurados via
 * EXTERNAL_ADDON_MANIFESTS (comma-separated manifest.json URLs).
 *
 * Fluxo:
 *   1. Na inicialização (lazy), busca cada manifest.json para descobrir
 *      os recursos declarados (resources, types, idPrefixes).
 *   2. Para cada request, monta a URL /stream/<type>/<id>.json e agrega.
 *   3. Streams são passados diretamente — sem re-validação de título.
 */

import axios from 'axios';
import { Logger } from '../utils/logger.js';
import { Stream } from '../types/index.js';
import { gerarUrlResolve } from '../magnet/magnetHelper.js';
import { QualityDetector } from '../lib/qualityDetector.js';

const logger = new Logger('ExternalAddonService');
const qualityDetector = QualityDetector.getInstance();

function formatExternalStreamTitle(raw: StremioStream, addonName: string): { name: string; title: string } {
  const rawTitle = raw.title || raw.description || raw.name || addonName;
  const lines = rawTitle.split('\n').map(line => line.trim()).filter(Boolean);
  const main = lines[0] || addonName;
  const quality = qualityDetector.extractBestQuality(rawTitle) || 'HD';
  const technical = lines.slice(1).filter(line => !/[🔍⚙️]/.test(line));
  const size = rawTitle.match(/💾\s*[^\n]+/i)?.[0] || '';
  const language = /dual|dublado|pt-?br|🇧🇷/i.test(rawTitle) ? '🌐 PT-BR 🇧🇷' : '';
  const indexer = `👤 0 🔍 ${addonName}`;
  const details = [size, indexer, `💿 ${quality}`, language, ...technical].filter(Boolean).join(' ');
  return { name: `PJBR\n${quality}`, title: `${main}\n${details}` };
}

interface AddonManifest {
  id: string;
  name: string;
  version: string;
  resources: Array<string | { name: string; types: string[]; idPrefixes?: string[] }>;
  types: string[];
  idPrefixes?: string[];
}

interface AddonInfo {
  baseUrl: string;
  manifest: AddonManifest;
}

interface StremioStream {
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: Record<string, unknown>;
  [key: string]: unknown;
}

let cachedAddons: AddonInfo[] | null = null;
let cacheTimestamp = 0;
const MANIFEST_TTL = 30 * 60 * 1000; // 30 min

function getManifestUrls(): string[] {
  const raw = process.env.EXTERNAL_ADDON_MANIFESTS || '';
  return raw
    .split(',')
    .map(u => u.trim())
    .filter(u => u.startsWith('http'));
}

function extractBaseUrl(manifestUrl: string): string {
  // Remove trailing /manifest.json or /manifest
  return manifestUrl.replace(/\/(manifest\.json|manifest)\/?$/i, '');
}

function addonSupportsStream(addon: AddonInfo, type: string, id: string): boolean {
  const { manifest } = addon;

  // Check resource support
  const hasStream = manifest.resources.some(r => {
    if (typeof r === 'string') return r === 'stream';
    return r.name === 'stream';
  });
  if (!hasStream) return false;

  // Check type
  const resourceDef = manifest.resources.find(r => typeof r !== 'string' && r.name === 'stream') as
    | { name: string; types: string[]; idPrefixes?: string[] }
    | undefined;
  const types = resourceDef?.types || manifest.types || [];
  if (!types.includes(type)) return false;

  // Check idPrefixes
  const prefixes = resourceDef?.idPrefixes || manifest.idPrefixes;
  if (prefixes && prefixes.length > 0) {
    return prefixes.some(p => id.startsWith(p));
  }

  return true;
}

async function fetchManifests(): Promise<AddonInfo[]> {
  const urls = getManifestUrls();
  if (urls.length === 0) return [];

  const addons: AddonInfo[] = [];
  await Promise.allSettled(
    urls.map(async url => {
      try {
        const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Stremio/4.4' } });
        const manifest: AddonManifest = res.data;
        if (!manifest?.id || !Array.isArray(manifest.resources)) {
          logger.warn('Manifest inválido', { url });
          return;
        }
        addons.push({ baseUrl: extractBaseUrl(url), manifest });
        logger.info('Addon externo carregado', { id: manifest.id, name: manifest.name });
      } catch (err) {
        logger.warn('Falha ao buscar manifest externo', {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );
  return addons;
}

async function getAddons(): Promise<AddonInfo[]> {
  const now = Date.now();
  if (cachedAddons !== null && now - cacheTimestamp < MANIFEST_TTL) return cachedAddons;
  cachedAddons = await fetchManifests();
  cacheTimestamp = now;
  return cachedAddons;
}

async function stremioStreamToStream(
  s: StremioStream,
  addonName: string,
  apiKey?: string,
  requestType?: string,
  requestId?: string,
): Promise<Stream | null> {
  // Must have either url or infoHash
  if (!s.url && !s.infoHash) return null;

  // Stremio exige title não-vazio para exibir o stream
  const formatted = formatExternalStreamTitle(s, addonName);
  const title = formatted.title;
  const name = formatted.name;

  const stream: Stream = {
    name,
    title,
    behaviorHints: {
      ...(s.behaviorHints as any),
    },
  };

  // Se tem infoHash e apiKey configurada → gera URL de resolve (passa pelo debrid)
  if (s.infoHash && apiKey) {
    try {
      const magnet = `magnet:?xt=urn:btih:${s.infoHash}`;
      const filename = (s.title || s.name || addonName).replace(/[^a-zA-Z0-9.\-_ ]/g, '_').trim() + '.mkv';
      const resolveUrl = await gerarUrlResolve(
        magnet,
        apiKey,
        filename,
        s.fileIdx ?? 0,
        (requestType as 'movie' | 'series') || 'movie',
        undefined,
        undefined,
        undefined,
        s.infoHash, // infoHash pré-parsado — evita re-parse
      );
      stream.url = resolveUrl;
      stream.infoHash = s.infoHash;
      if (s.fileIdx !== undefined) stream.fileIdx = s.fileIdx;
    } catch {
      // Fallback: usa infoHash direto (P2P)
      stream.infoHash = s.infoHash;
      if (s.fileIdx !== undefined) stream.fileIdx = s.fileIdx;
    }
  } else if (s.infoHash) {
    // Sem apiKey: P2P direto
    stream.infoHash = s.infoHash;
    if (s.fileIdx !== undefined) stream.fileIdx = s.fileIdx;
  } else if (s.url) {
    // URL já resolvida pelo addon externo — passa direto
    stream.url = s.url;
  }

  return stream;
}

export async function fetchExternalAddonStreams(
  type: string,
  id: string,
  apiKey?: string,
): Promise<Stream[]> {
  if (!process.env.EXTERNAL_ADDON_MANIFESTS?.trim()) return [];

  const addons = await getAddons();
  if (addons.length === 0) return [];

  const eligible = addons.filter(a => addonSupportsStream(a, type, id));
  if (eligible.length === 0) return [];

  const results: Stream[] = [];

  await Promise.allSettled(
    eligible.map(async addon => {
      const url = `${addon.baseUrl}/stream/${type}/${encodeURIComponent(id)}.json`;
      try {
        const res = await axios.get(url, {
          timeout: 12000,
          headers: { 'User-Agent': 'Stremio/4.4' },
        });
        const streams: StremioStream[] = Array.isArray(res.data?.streams) ? res.data.streams : [];
        let aceitos = 0;
        for (const s of streams) {
          const stream = await stremioStreamToStream(s, addon.manifest.name, apiKey, type, id);
          if (stream) {
            results.push(stream);
            aceitos++;
          } else {
            logger.debug('Stream externo descartado (sem url/infoHash)', {
              addon: addon.manifest.id,
              name: s.name,
              title: (s.title || '').substring(0, 60),
            });
          }
        }
        logger.debug(`Addon externo retornou ${streams.length} streams (${aceitos} aceitos)`, {
          addon: addon.manifest.id,
          type,
          id,
        });
      } catch (err) {
        logger.warn('Falha ao buscar streams do addon externo', {
          addon: addon.manifest.id,
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return results;
}

/** Invalida cache de manifests (útil em testes ou hot-reload) */
export function invalidateExternalAddonCache(): void {
  cachedAddons = null;
  cacheTimestamp = 0;
}
