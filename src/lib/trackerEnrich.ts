// Enriquecimento de trackers em magnet links — adaptado de torrentEnrich.js
// Objetivo: aumentar a quantidade de "fontes" (trackers) de cada torrent encontrado,
// acelerando descoberta de peers tanto no modo debrid quanto no modo P2P puro.

import axios from 'axios';
import { Logger } from '../utils/logger.js';

const logger = new Logger('TrackerEnrich');

const EXTRA_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://wepzone.net:6969/announce',
  'http://tracker.bt4g.com:2095/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'https://tracker.ghostchu-services.top:443/announce',
];

let DYNAMIC_TRACKERS: string[] = [...EXTRA_TRACKERS];

const TRACKER_LIST_URLS = [
  'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best_ip.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best_ip.txt',
  'https://ngosang.github.io/trackerslist/trackers_best_ip.txt',
];

async function updateDynamicTrackers(): Promise<void> {
  for (const url of TRACKER_LIST_URLS) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      if (res.status === 200 && res.data) {
        const trackers: string[] = String(res.data)
          .split('\n')
          .map((t: string) => t.trim())
          .filter(Boolean);
        if (trackers.length > 0) {
          DYNAMIC_TRACKERS = [...new Set([...EXTRA_TRACKERS, ...trackers])];
          logger.debug(`Trackers dinâmicos atualizados: ${DYNAMIC_TRACKERS.length}`);
          return;
        }
      }
    } catch {
      // tenta próximo mirror
    }
  }
}

updateDynamicTrackers().catch(() => {});
setInterval(() => updateDynamicTrackers().catch(() => {}), 12 * 60 * 60 * 1000);

export function getExtraTrackers(): string[] {
  return DYNAMIC_TRACKERS;
}

/**
 * Retorna a lista de trackers de um magnet (existentes + enriquecidos), sem duplicatas.
 */
export function getEnrichedTrackerList(magnet: string, existentes: string[] = []): string[] {
  const existentesLower = new Set(existentes.map(t => t.toLowerCase()));
  const extras = DYNAMIC_TRACKERS.filter(t => !existentesLower.has(t.toLowerCase()));
  return [...existentes, ...extras];
}

/**
 * Enriquece um magnet link adicionando trackers extras (parâmetros tr=) que ainda não existem.
 * Usado no modo P2P puro para maximizar a quantidade de fontes/peers do torrent.
 */
export function enrichMagnetTrackers(magnet: string): string {
  try {
    if (!magnet || !magnet.startsWith('magnet:?')) return magnet;
    const [base, query] = magnet.split('?');
    const params = new URLSearchParams(query);
    const existentes = params.getAll('tr');
    const existentesLower = new Set(existentes.map(t => t.toLowerCase()));

    for (const tracker of DYNAMIC_TRACKERS) {
      if (!existentesLower.has(tracker.toLowerCase())) {
        params.append('tr', tracker);
        existentesLower.add(tracker.toLowerCase());
      }
    }

    return `${base}?${params.toString()}`;
  } catch (err) {
    logger.warn('Falha ao enriquecer magnet, retornando original', {
      error: err instanceof Error ? err.message : 'erro desconhecido'
    });
    return magnet;
  }
}
