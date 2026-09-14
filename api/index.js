// Entrypoint serverless (Vercel) — reusa a mesma app Express do server.ts,
// sem chamar app.listen(). O build (`npm run build`) precisa rodar antes
// (compila src/ -> dist/), pois é o dist/server.js que é importado aqui.

const path = require('path');

let appPromise = null;
let serverModule = null;

function loadApp() {
  if (!appPromise) {
    serverModule = serverModule || require(path.join(__dirname, '../dist/server.js'));
    // Warm-up no primeiro acesso; em falha, reset para tentar na próxima
    // invocação em vez de cuspir um FUNCTION_INVOCATION_FAILED.
    appPromise = serverModule.getApp();
    appPromise.catch(() => {
      if (serverModule) {
        try { delete require.cache[require.resolve(path.join(__dirname, '../dist/server.js'))]; } catch {}
      }
      appPromise = null;
    });
  }
  return appPromise;
}

module.exports = async (req, res) => {
  try {
    const app = await loadApp();
    return app(req, res);
  } catch (err) {
    // Nunca deixa a invocação "quebrar": responde 200 com lista vazia para o
    // Stremio e loga. O Vercel re-tenta sozinho; a próxima (warm) funciona.
    console.error('[Vercel handler] erro na invocação:', err && (err.stack || err.message));
    if (!res.headersSent) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ streams: [] }));
    } else {
      res.end();
    }
  }
};
