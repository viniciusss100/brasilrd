// Entrypoint raiz — compatibilidade com plataformas que exigem index.js na base do projeto
// (Wispbyte, Railway sem nixpacks, etc.). O build compila src/ → dist/ antes de usar isso.
require('./dist/server.js');
