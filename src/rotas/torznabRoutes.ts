import { TorrentScraperService } from '../services/scraper/TorrentScraperService.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';

const esc = (value: unknown) => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>${body}`;

const INDEXER_ID = 'brasilrd';
const INDEXER_TITLE = 'brasilrd';

// Prowlarr-compatible caps XML
const capsXml = xml(
  '<caps>' +
    `<server version="1.1" title="${INDEXER_TITLE}" strapline="${INDEXER_TITLE}" url=""/>` +
    '<limits max="100" default="50"/>' +
    '<registration available="no" open="no"/>' +
    '<searching>' +
      '<search available="yes" supportedParams="q" searchEngine="raw"/>' +
      '<tv-search available="yes" supportedParams="q,season,ep" searchEngine="raw"/>' +
      '<movie-search available="yes" supportedParams="q,imdbid" searchEngine="raw"/>' +
      '<music-search available="no" supportedParams=""/>' +
      '<audio-search available="no" supportedParams=""/>' +
      '<book-search available="no" supportedParams=""/>' +
    '</searching>' +
    '<categories>' +
      '<category id="2000" name="Movies">' +
        '<subcat id="2010" name="Movies/Foreign"/>' +
      '</category>' +
      '<category id="5000" name="TV">' +
        '<subcat id="5020" name="TV/Foreign"/>' +
      '</category>' +
    '</categories>' +
    '<groups/>' +
    '<genres/>' +
    '<tags/>' +
  '</caps>'
);

export function setupTorznabRoutes(app: any): void {
  const scraper = new TorrentScraperService();

  const checkAuth = (req: any, res: any): boolean => {
    const key = process.env.TORZNAB_API_KEY;
    if (!key) return true;
    const provided = req.query.apikey || req.query.passkey || req.headers['x-api-key'];
    if (provided !== key) {
      res.status(401).type('application/xml').send(
        xml('<error code="100" description="Invalid API Key"/>')
      );
      return false;
    }
    return true;
  };

  const handle = async (req: any, res: any) => {
    if (!checkAuth(req, res)) return;

    const type = String(req.query.t || 'search');
    res.type('application/xml');

    if (type === 'caps') {
      return res.send(capsXml);
    }

    if (type === 'indexers') {
      // Prowlarr indexer listing
      return res.send(xml(
        `<indexers><indexer id="${esc(INDEXER_ID)}" title="${esc(INDEXER_TITLE)}" active="true" configured="true" public="false"/></indexers>`
      ));
    }

    const query = String(req.query.q || req.query.query || '').trim();
    if (!query) {
      // Retorna item de teste para o Prowlarr validar a conexão com sucesso quando busca sem query
      const pubDate = new Date().toUTCString();
      const dummyItem = '<item>' +
        `<title>BrasilRD Prowlarr Test 1080p</title>` +
        `<guid isPermaLink="false">0000000000000000000000000000000000000000</guid>` +
        `<link>magnet:?xt=urn:btih:0000000000000000000000000000000000000000</link>` +
        `<pubDate>${esc(pubDate)}</pubDate>` +
        `<size>1024</size>` +
        `<enclosure url="magnet:?xt=urn:btih:0000000000000000000000000000000000000000" type="application/x-bittorrent" length="1024"/>` +
        `<torznab:attr name="category" value="2000"/>` +
        `<torznab:attr name="seeders" value="1"/>` +
        `<torznab:attr name="peers" value="1"/>` +
        `<torznab:attr name="leechers" value="0"/>` +
        `<torznab:attr name="infohash" value="0000000000000000000000000000000000000000"/>` +
        `<torznab:attr name="magneturl" value="magnet:?xt=urn:btih:0000000000000000000000000000000000000000"/>` +
        `<torznab:attr name="size" value="1024"/>` +
        `<torznab:attr name="downloadvolumefactor" value="0"/>` +
        `<torznab:attr name="uploadvolumefactor" value="1"/>` +
        '</item>';

      return res.send(xml(
        `<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">` +
        `<channel>` +
        `<title>${esc(INDEXER_TITLE)}</title>` +
        `<description>${esc(INDEXER_TITLE)}</description>` +
        `<link/>` +
        `<language>pt-BR</language>` +
        `<category>search</category>` +
        dummyItem +
        `</channel>` +
        `</rss>`
      ));
    }

    const season = req.query.season ? Number(req.query.season) : undefined;
    const ep = req.query.ep ? Number(req.query.ep) : undefined;
    const mediaType = type === 'movie' ? 'movie' : 'series';
    const searchQuery = season ? `${query} Temporada ${season}${ep ? ` Episodio ${ep}` : ''}` : query;

    const results = await scraper.searchTorrents(searchQuery, mediaType, season);

    const items = await Promise.all(results.map(async result => {
      const hash = (await analisarMagnet(result.magnet))?.infoHash || result.magnet;
      const category = mediaType === 'movie' ? 2000 : 5000;
      const pubDate = new Date().toUTCString();
      const size = Math.max(0, result.sizeInBytes || 0);
      return (
        '<item>' +
        `<title>${esc(result.title)}</title>` +
        `<guid isPermaLink="false">${esc(hash)}</guid>` +
        `<link>${esc(result.magnet)}</link>` +
        `<pubDate>${esc(pubDate)}</pubDate>` +
        `<size>${size}</size>` +
        `<enclosure url="${esc(result.magnet)}" type="application/x-bittorrent" length="${size}"/>` +
        `<torznab:attr name="category" value="${category}"/>` +
        `<torznab:attr name="seeders" value="${result.seeders || 0}"/>` +
        `<torznab:attr name="peers" value="${result.leechers || 0}"/>` +
        `<torznab:attr name="leechers" value="${result.leechers || 0}"/>` +
        `<torznab:attr name="infohash" value="${esc(hash)}"/>` +
        `<torznab:attr name="magneturl" value="${esc(result.magnet)}"/>` +
        `<torznab:attr name="size" value="${size}"/>` +
        `<torznab:attr name="downloadvolumefactor" value="0"/>` +
        `<torznab:attr name="uploadvolumefactor" value="1"/>` +
        '</item>'
      );
    }));

    return res.send(xml(
      `<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">` +
      `<channel>` +
      `<title>${esc(INDEXER_TITLE)}</title>` +
      `<description>${esc(INDEXER_TITLE)}</description>` +
      `<link/>` +
      `<language>pt-BR</language>` +
      `<category>search</category>` +
      items.join('') +
      `</channel>` +
      `</rss>`
    ));
  };

  // Prowlarr mounts the indexer at /torznab/<indexerid>/api
  // Also support generic /api and /torznab/api patterns
  const paths = [
    `/:id/prowlarr/api`,
    `/torznab/${INDEXER_ID}/api`,
    `/torznab/${INDEXER_ID}`,
    '/torznab/api',
    '/torznab',
    '/api',
  ];

  app.get(paths, handle);

  // Redirect trailing slash variants
  app.get(paths.map(p => `${p}/`), (req: any, res: any) => {
    const base = req.path.replace(/\/$/, '');
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `${base}${qs}`);
  });
}
