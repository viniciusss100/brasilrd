// Manifest do Addon brasilrd
// Versao sincronizada automaticamente com package.json

import { version as versaoProjeto } from '../../package.json';

export const manifest = {
    id: 'org.brasilrd.addon',

    version: versaoProjeto,
    
    // Informações básicas
    name: 'brasilrd',
    description: 'Addon brasileiro com suporte ao Torbox',
    
    // Imagens
    logo: `${process.env.BASE_URL || 'http://localhost:7000'}/videos/logo.png`,
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
    
    // Recursos e tipos suportados
    // Incluindo 'anime' e 'other' para maior compatibilidade com Torrentio
    resources: ['stream'],
    types: ['movie', 'series', 'anime', 'other'],
    
    // Catálogos vazios - foco em busca por ID
    catalogs: [],
    
    // Prefixos de ID suportados
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb', 'kitsu', 'mal', 'myanimelist', 'anilist'],
    
    // Comportamento do addon
    // IMPORTANTE: configurationRequired: false para funcionar no Stremio Web
    behaviorHints: {
        configurable: true,           // Usuário pode configurar
        configurationRequired: false, // NÃO requer configuração para usar (FIX WEB)
        adult: false,                 // Conteúdo não adulto
        p2p: true                     // Suporta modo P2P puro (opcional, via config)
    },
    
    // Configuração (API Key do Torbox + modo P2P opcional)
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave de API do Torbox',
            required: false,           // Requerido para funcionalidade completa
            placeholder: 'Cole sua chave de API do Torbox aqui'
        },
        {
            key: 'p2p',
            type: 'checkbox',
            title: 'Modo P2P puro (magnet direto, sem debrid)',
            required: false
        }
    ]
};

// Log para debug - versão atual
console.log('[Manifest] brasilrd v1.0.1 - configurationRequired: false (Web Fix)');
