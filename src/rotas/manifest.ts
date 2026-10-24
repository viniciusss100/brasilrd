// Manifest do Addon pjbr
// Versao sincronizada automaticamente com package.json

import { version as versaoProjeto } from '../../package.json';

// P2P_ENABLED=false oculta o modo P2P da UI e do manifest
const p2pEnabled = !['0', 'false', 'off', 'no'].includes(
    (process.env.P2P_ENABLED ?? '').trim().toLowerCase()
);

export const manifest = {
    id: 'org.pjbr.addon',

    version: versaoProjeto,

    // ADDON_NAME: identifica a instância no player (ex: pjbr-vercel)
    name: process.env.ADDON_NAME?.trim() || 'pjbr',
    description: 'Addon brasileiro com suporte ao Torbox',

    // Imagens
    logo: `${process.env.BASE_URL || 'http://localhost:7000'}/videos/logo.png`,
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',

    // Recursos e tipos suportados
    resources: ['stream'],
    types: ['movie', 'series', 'anime', 'other'],

    // Catálogos vazios - foco em busca por ID
    catalogs: [],

    // Prefixos de ID suportados
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb', 'kitsu', 'mal', 'myanimelist', 'anilist'],

    // Comportamento do addon
    behaviorHints: {
        configurable: true,
        configurationRequired: false,
        adult: false,
        p2p: p2pEnabled,
        preferredAudioLanguage: 'por'
    },

    // Configuração — p2p só aparece quando habilitado
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave de API do Torbox',
            required: false,
            placeholder: 'Cole sua chave de API do Torbox aqui'
        },
        ...(p2pEnabled ? [{
            key: 'p2p',
            type: 'checkbox',
            title: 'Modo P2P puro (magnet direto, sem debrid)',
            required: false
        }] : []),
        {
            key: 'excludeKeywords',
            type: 'checkbox',
            title: 'Excluir keywords ruins (CAM, telesync, sample...)',
            required: false
        },
        {
            key: 'excludeQuality',
            type: 'checkbox',
            title: 'Excluir qualidades ruins (CAM, CAMRip, TC, HDTC)',
            required: false
        }
    ]
};

// Exporta flag para uso no template
export { p2pEnabled };

console.log(`[Manifest] pjbr v${versaoProjeto} - p2p=${p2pEnabled}`);
