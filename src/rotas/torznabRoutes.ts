import { TorrentScraperService } from '../services/scraper/TorrentScraperService.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';

const esc = (value: unknown) => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;
const capsXml = xml(
  '<caps>' +
    '<server title="Brasil RD" version="1.0"/>' +
    '<searching>' +
      '<search available="yes" supportedParams="q"/>' +
      '<tv-search available="yes" supportedParams="q,season,ep"/>' +
      '<movie-search available="yes" supportedParams="q,imdbid"/>' +
    '</searching>' +
    '<categories>' +
      '<category id="2000" name="Movies"/>' +
      '<category id="5000" name="TV"/>' +
    '</categories>' +
  '</caps>'
);

export function setupTorznabRoutes(app: any): void {
  const scraper = new TorrentScraperService();
  const handle = async (req: any, res: any) => {
    const key = process.env.TORZNAB_API_KEY;
    if (key && req.query.apikey !== key) return res.status(401).type('application/xml').send(xml('<error code="100" description="Invalid API key"/>'));

    const type = String(req.query.t || 'search');
    res.type('application/xml');
    if (type === 'caps') {
      return res.send(capsXml);
    }

    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) return res.send(xml('<error code="201" description="Missing search query"/>'));
    const season = req.query.season ? Number(req.query.season) : undefined;
    const mediaType = type === 'movie' ? 'movie' : 'series';
    const results = await scraper.searchTorrents(season ? `${query} Temporada ${season}` : query, mediaType, season);
    const items = await Promise.all(results.map(async result => {
      const hash = (await analisarMagnet(result.magnet))?.infoHash || result.magnet;
      const category = mediaType === 'movie' ? 2000 : 5000;
      return `<item><title>${esc(result.title)}</title><guid isPermaLink="false">${esc(hash)}</guid><link>${esc(result.magnet)}</link><enclosure url="${esc(result.magnet)}" type="application/x-bittorrent" length="${Math.max(0, result.sizeInBytes || 0)}"/><torznab:attr name="category" value="${category}"/><torznab:attr name="seeders" value="${result.seeders || 0}"/><torznab:attr name="peers" value="${result.leechers || 0}"/></item>`;
    }));
    return res.send(xml(`<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Brasil RD</title>${items.join('')}</channel></rss>`));
  };
  const redirectToApi = (req: any, res: any) => res.redirect(302, `/torznab/api${req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
  app.get(['/torznab', '/torznab/'], redirectToApi);
  app.get(['/torznab/api', '/torznab/api/', '/api', '/api/'], handle);
  app.get(['/torznab/api/api', '/api/api'], handle);
}
