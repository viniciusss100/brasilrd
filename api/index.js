// Entrypoint serverless (Vercel) — reusa a mesma app Express do server.ts,
// sem chamar app.listen(). O build (`npm run build`) precisa rodar antes
// (compila src/ -> dist/), pois é o dist/server.js que é importado aqui.

const { getApp } = require('../dist/server.js');

let appPromise = null;

module.exports = async (req, res) => {
  if (!appPromise) {
    appPromise = getApp();
  }
  const app = await appPromise;
  return app(req, res);
};
