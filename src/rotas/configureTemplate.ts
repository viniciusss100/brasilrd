import { Logger } from '../utils/logger.js';

const logger = new Logger('ConfigureTemplate');

export const configureTemplate = (manifest: any, apiKey: string = '', p2pEnabled: boolean = true) => {
    const logo = manifest.logo || '';
    const inicialApiKey = apiKey || '';
    const showP2p = p2pEnabled;
    const hasTorz = !!(process.env.EXTERNAL_ADDON_MANIFESTS || '').toLowerCase().includes('torz');

    const torzBlock = hasTorz ? `
            <div class="toggle-row toggle-row--warning" onclick="toggleOption('useTorz')" id="torzToggleRow">
                <div class="toggle-label">
                    <span class="toggle-title">&#127758; Ativar Torz</span>
                    <span class="toggle-desc">Pode aumentar tempo de resposta</span>
                </div>
                <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" id="useTorz"><span class="slider"></span></label>
            </div>` : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${manifest.name}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
            --bg: #0d0d0f;
            --surface: #16161a;
            --surface2: #1e1e24;
            --border: rgba(255,255,255,0.08);
            --accent: #7c3aed;
            --accent-light: #8b5cf6;
            --accent-glow: rgba(124,58,237,0.22);
            --text: #f1f0f5;
            --muted: #8b8a97;
            --success: #22c55e;
            --warning: #f59e0b;
            --radius: 14px;
            --radius-sm: 8px;
        }

        html, body {
            height: 100%;
            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
        }

        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100%;
            /* mobile: padding mínimo para não cortar nas bordas */
            padding: 12px;
        }

        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image:
                linear-gradient(rgba(124,58,237,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(124,58,237,0.03) 1px, transparent 1px);
            background-size: 40px 40px;
            pointer-events: none;
            z-index: 0;
        }

        .card {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 420px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 18px;
            overflow: hidden;
            box-shadow:
                0 0 0 1px rgba(255,255,255,0.04),
                0 20px 56px rgba(0,0,0,0.5),
                0 0 60px var(--accent-glow);
        }

        .card::before {
            content: '';
            display: block;
            height: 2px;
            background: linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed);
            background-size: 200% 100%;
            animation: shimmer 3s linear infinite;
        }
        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .card-body {
            padding: 20px 20px 18px;
            display: flex;
            flex-direction: column;
            gap: 0;
        }

        /* ── Header compacto ── */
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 14px;
        }

        .logo-wrap {
            width: 48px;
            height: 48px;
            flex-shrink: 0;
            border-radius: 13px;
            background: linear-gradient(135deg, #3d1a6e, #1e0a3c);
            border: 1px solid rgba(124,58,237,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 18px var(--accent-glow);
            overflow: hidden;
        }
        .logo-wrap img { width: 100%; height: 100%; object-fit: contain; }
        .logo-wrap .icon-fallback { width: 28px; height: 28px; fill: #a855f7; }

        .header-text { flex: 1; min-width: 0; }
        .addon-name {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: -0.3px;
            color: var(--text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .addon-version { font-size: 11px; color: var(--muted); font-weight: 500; }

        /* chips inline no header */
        .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 5px;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 999px;
            background: var(--surface2);
            border: 1px solid var(--border);
            font-size: 10px;
            font-weight: 500;
            color: var(--muted);
        }
        .chip-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: var(--accent-light);
            flex-shrink: 0;
        }

        /* ── Divider ── */
        .divider {
            border: none;
            border-top: 1px solid var(--border);
            margin: 12px 0;
        }

        /* ── Instâncias: 3 colunas ── */
        .section-label {
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 7px;
        }

        .instance-links {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 12px;
        }
        .instance-btn {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 8px 4px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: var(--radius-sm);
            color: var(--text);
            font-size: 11px;
            font-weight: 600;
            text-decoration: none;
            transition: background 0.2s, border-color 0.2s;
            line-height: 1.2;
            text-align: center;
        }
        .instance-btn:hover {
            background: rgba(255,255,255,0.07);
            border-color: rgba(255,255,255,0.22);
        }
        .instance-icon { font-size: 16px; line-height: 1; }

        .instance-btn--vercel { border-color: rgba(255,255,255,0.14); }
        .instance-btn--vercel:hover { border-color: rgba(255,255,255,0.35); }
        .instance-btn--render { border-color: rgba(34,197,94,0.18); }
        .instance-btn--render:hover { border-color: rgba(34,197,94,0.4); }
        .instance-btn--wisp { border-color: rgba(96,165,250,0.18); }
        .instance-btn--wisp:hover { border-color: rgba(96,165,250,0.4); }

        /* ── TorBox ── */
        .torbox-wrap { margin-bottom: 12px; }
        .torbox-btn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 10px 13px;
            background: linear-gradient(135deg, rgba(124,58,237,0.11), rgba(168,85,247,0.07));
            border: 1px solid rgba(124,58,237,0.4);
            border-radius: var(--radius-sm);
            color: #c4b5fd;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
            box-shadow: 0 0 0 1px rgba(124,58,237,0.08), 0 3px 12px rgba(124,58,237,0.18);
        }
        .torbox-btn:hover {
            background: linear-gradient(135deg, rgba(124,58,237,0.19), rgba(168,85,247,0.13));
            border-color: rgba(168,85,247,0.55);
            color: #ddd6fe;
            box-shadow: 0 0 0 1px rgba(124,58,237,0.18), 0 5px 18px rgba(124,58,237,0.28);
        }
        .torbox-btn-left { display: flex; align-items: center; gap: 10px; }
        .torbox-icon {
            width: 15px; height: 15px;
            fill: none; stroke: currentColor;
            stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
            flex-shrink: 0;
        }
        .torbox-btn-text { display: flex; flex-direction: column; gap: 1px; text-align: left; }
        .torbox-btn-title { font-size: 13px; font-weight: 600; color: #ddd6fe; line-height: 1.2; }
        .torbox-btn-sub { font-size: 10px; color: #a78bfa; opacity: 0.85; }
        .offer-badge {
            display: inline-flex;
            background: linear-gradient(135deg, #22c55e, #16a34a);
            color: #052e16;
            border-radius: 999px;
            padding: 3px 9px;
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            flex-shrink: 0;
        }

        /* ── API Key ── */
        .input-wrap { position: relative; }
        .input-wrap svg {
            position: absolute;
            left: 11px; top: 50%;
            transform: translateY(-50%);
            width: 14px; height: 14px;
            stroke: var(--muted); fill: none;
            stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
            pointer-events: none;
        }
        input[type="text"] {
            width: 100%;
            padding: 10px 10px 10px 33px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text);
            font-family: inherit;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        input[type="text"]:focus {
            border-color: var(--accent-light);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }
        input[type="text"]::placeholder { color: var(--muted); }
        input[type="text"]:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── Toggles ── */
        .toggles { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }

        .toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 9px 12px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            user-select: none;
            min-height: 44px;
        }
        .toggle-row:hover { border-color: rgba(255,255,255,0.14); }
        .toggle-row--warning { border-color: rgba(245,158,11,0.22); }
        .toggle-row--warning:hover { border-color: rgba(245,158,11,0.42); }

        .toggle-label { display: flex; flex-direction: column; gap: 1px; padding-right: 10px; }
        .toggle-title { font-size: 12.5px; font-weight: 500; color: var(--text); line-height: 1.3; }
        .toggle-desc { font-size: 10px; color: var(--muted); line-height: 1.3; }

        .switch {
            position: relative;
            width: 36px; height: 20px;
            flex-shrink: 0;
        }
        .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .slider {
            position: absolute;
            inset: 0;
            background: rgba(255,255,255,0.12);
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.1);
            transition: background 0.2s;
            cursor: pointer;
        }
        .slider::after {
            content: '';
            position: absolute;
            left: 2px; top: 50%;
            transform: translateY(-50%);
            width: 14px; height: 14px;
            border-radius: 50%;
            background: #fff;
            transition: left 0.2s;
        }
        .switch input:checked ~ .slider { background: var(--accent); }
        .switch input:checked ~ .slider::after { left: 18px; }

        /* ── Install ── */
        .install-btn {
            display: block;
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #7c3aed, #6d28d9);
            border: none;
            border-radius: var(--radius-sm);
            color: #fff;
            font-family: inherit;
            font-size: 13.5px;
            font-weight: 600;
            letter-spacing: 0.02em;
            cursor: pointer;
            text-align: center;
            text-decoration: none;
            transition: opacity 0.15s, transform 0.1s, box-shadow 0.2s;
            box-shadow: 0 4px 14px rgba(109,40,217,0.4);
            margin-top: 10px;
            /* toque mínimo de 44px já garantido pelo padding */
        }
        .install-btn:hover { opacity: 0.9; box-shadow: 0 6px 18px rgba(109,40,217,0.52); }
        .install-btn:active { transform: scale(0.985); }

        /* ── URL block ── */
        .url-block { margin-top: 10px; display: none; }
        .url-label { font-size: 10px; color: var(--muted); margin-bottom: 5px; }
        .url-field { display: flex; gap: 6px; }

        input[type="text"].url-input {
            padding-left: 10px;
            flex: 1;
            font-size: 11px;
            color: var(--muted);
            cursor: pointer;
        }
        .copy-btn {
            flex-shrink: 0;
            padding: 0 12px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--muted);
            font-family: inherit;
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
            white-space: nowrap;
        }
        .copy-btn:hover { color: var(--text); border-color: rgba(255,255,255,0.2); }
        .copy-btn.copied { color: var(--success); border-color: var(--success); }

        /* ── Toast ── */
        .toast {
            position: fixed;
            bottom: 20px; left: 50%;
            transform: translateX(-50%) translateY(8px);
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 9px 16px;
            font-size: 12.5px;
            color: var(--text);
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            pointer-events: none;
            white-space: nowrap;
            z-index: 99;
        }
        .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

        /* ── Aviso Torz (tooltip-style, oculto por padrão) ── */
        #torzWarning {
            display: none;
            margin-top: 4px;
            padding: 7px 10px;
            background: rgba(245,158,11,0.07);
            border: 1px solid rgba(245,158,11,0.18);
            border-radius: var(--radius-sm);
            font-size: 10.5px;
            color: #fbbf24;
            line-height: 1.45;
        }

        /* ── Ajuste fine para smartphones muito pequenos (< 380px) ── */
        @media (max-width: 379px) {
            .card-body { padding: 16px 14px 14px; }
            .addon-name { font-size: 16px; }
            .logo-wrap { width: 42px; height: 42px; border-radius: 11px; }
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="card-body">

            <!-- Header compacto: logo + nome + chips na mesma linha -->
            <div class="header">
                <div class="logo-wrap" id="logoWrap">
                    <img src="${logo}" alt="${manifest.name}" id="logoImg"
                         onerror="this.style.display='none';document.getElementById('iconFallback').style.display='block'">
                    <svg id="iconFallback" class="icon-fallback" style="display:none" viewBox="0 0 24 24">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <div class="header-text">
                    <div class="addon-name">${manifest.name}</div>
                    <div class="addon-version">v${manifest.version}</div>
                    <div class="chips">
                        <div class="chip"><span class="chip-dot"></span>Filmes</div>
                        <div class="chip"><span class="chip-dot"></span>Séries</div>
                        <div class="chip"><span class="chip-dot"></span>Anime</div>
                        <div class="chip"><span class="chip-dot"></span>PT-BR</div>
                        ${showP2p ? `<div class="chip"><span class="chip-dot"></span>P2P</div>` : ''}
                    </div>
                </div>
            </div>

            <hr class="divider" style="margin:0 0 12px">

            <!-- Instâncias: 3 colunas compactas -->
            <div class="section-label">Instâncias</div>
            <div class="instance-links">
                <a class="instance-btn instance-btn--vercel"
                   href="https://pjbr2.vercel.app/configure" target="_blank" rel="noopener">
                    <span class="instance-icon">▲</span>
                    <span>Vercel</span>
                </a>
                <a class="instance-btn instance-btn--render"
                   href="https://pjbr.onrender.com" target="_blank" rel="noopener">
                    <span class="instance-icon">☁️</span>
                    <span>Render</span>
                </a>
                <a class="instance-btn instance-btn--wisp"
                   href="https://pjbr.wispbyte.app" target="_blank" rel="noopener">
                    <span class="instance-icon">⚡</span>
                    <span>Wispbyte</span>
                </a>
            </div>

            <!-- TorBox referral -->
            <div class="torbox-wrap">
                <a class="torbox-btn"
                   href="https://torbox.app/subscription?referral=e2437622-108c-4d82-b394-1d25ea78a812"
                   target="_blank" rel="noopener">
                    <span class="torbox-btn-left">
                        <svg viewBox="0 0 24 24" class="torbox-icon">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                        <span class="torbox-btn-text">
                            <span class="torbox-btn-title">Assinar TorBox</span>
                            <span class="torbox-btn-sub">Link de indicação • Suporte ao PJBR</span>
                        </span>
                    </span>
                    <span class="offer-badge">+7 dias/mês</span>
                </a>
            </div>

            <hr class="divider" style="margin:0 0 12px">

            <!-- API Key -->
            <div class="section-label">Chave de API</div>
            <div class="input-wrap">
                <svg viewBox="0 0 24 24">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                </svg>
                <input type="text"
                       id="${manifest.config[0].key}"
                       name="${manifest.config[0].key}"
                       placeholder="Cole sua chave de API do Torbox"
                       value="${inicialApiKey}"
                       autocomplete="off"
                       spellcheck="false">
            </div>

            <!-- Toggles -->
            <div class="toggles">
                ${showP2p ? `
                <div class="toggle-row" onclick="toggleP2p()">
                    <div class="toggle-label">
                        <span class="toggle-title">Modo P2P</span>
                        <span class="toggle-desc">Magnet direto, sem debrid</span>
                    </div>
                    <label class="switch" onclick="event.stopPropagation()">
                        <input type="checkbox" id="p2pMode" onchange="toggleP2p()">
                        <span class="slider"></span>
                    </label>
                </div>` : `<input type="hidden" id="p2pMode" value="false">`}

                <div class="toggle-row" onclick="toggleOption('excludeKeywords')">
                    <div class="toggle-label">
                        <span class="toggle-title">Remover keywords ruins</span>
                        <span class="toggle-desc">CAM, Dual-LAT, sample, VF…</span>
                    </div>
                    <label class="switch" onclick="event.stopPropagation()">
                        <input type="checkbox" id="excludeKeywords"><span class="slider"></span>
                    </label>
                </div>

                <div class="toggle-row" onclick="toggleOption('excludeQuality')">
                    <div class="toggle-label">
                        <span class="toggle-title">Remover qualidade ruim</span>
                        <span class="toggle-desc">CAM, CAMRip, TC, HDTC</span>
                    </div>
                    <label class="switch" onclick="event.stopPropagation()">
                        <input type="checkbox" id="excludeQuality"><span class="slider"></span>
                    </label>
                </div>

                ${torzBlock}
            </div>

            <!-- Aviso Torz (aparece só quando ativado) -->
            <div id="torzWarning">
                &#9888;&#65039; O Torz pode aumentar o tempo de resposta. N&#227;o recomendado com AIOStreams.
            </div>

            <!-- Install -->
            <a id="installLink" class="install-btn" href="#">Instalar no Stremio</a>

            <!-- Manifest URL -->
            <div class="url-block" id="urlBlock">
                <div class="url-label">URL do manifest (AIOStreams / uso manual)</div>
                <div class="url-field">
                    <input type="text" class="url-input" id="directUrl" readonly
                           onclick="this.select()" title="Clique para selecionar">
                    <button class="copy-btn" id="copyBtn" onclick="copyUrl()">Copiar</button>
                </div>
            </div>

        </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        const apiKeyInput = document.getElementById('${manifest.config[0].key}');
        const p2pCheckbox = document.getElementById('p2pMode');
        const installLink = document.getElementById('installLink');
        const directUrl   = document.getElementById('directUrl');
        const urlBlock    = document.getElementById('urlBlock');
        const copyBtn     = document.getElementById('copyBtn');
        const toast       = document.getElementById('toast');
        const torzWarning = document.getElementById('torzWarning');

        const p2pAvailable = ${showP2p ? 'true' : 'false'};
        let debounceTimer = null;

        function isP2pActive() {
            if (!p2pAvailable) return false;
            return p2pCheckbox && p2pCheckbox.checked;
        }

        function toggleP2p() {
            if (!p2pAvailable) return;
            apiKeyInput.disabled = p2pCheckbox.checked;
            scheduleUpdate();
        }

        function toggleOption(id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !el.checked;
            if (id === 'useTorz' && torzWarning) {
                torzWarning.style.display = el.checked ? 'block' : 'none';
            }
            scheduleUpdate();
        }

        async function updateLink() {
            const apiKey = apiKeyInput.value.trim();
            const isP2p  = isP2pActive();
            const excludeKeywords = document.getElementById('excludeKeywords').checked;
            const excludeQuality  = document.getElementById('excludeQuality').checked;
            const useTorzEl = document.getElementById('useTorz');
            const useTorz   = useTorzEl ? useTorzEl.checked : false;
            const base = window.location.protocol + '//' + window.location.host;

            if (!isP2p && !apiKey) {
                installLink.href = '#';
                urlBlock.style.display = 'none';
                return;
            }

            try {
                const resp = await fetch('/api/encrypt-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, p2p: isP2p, excludeKeywords, excludeQuality, useTorz })
                });
                const data = await resp.json();
                if (!data.success) throw new Error(data.error || 'erro');

                const path = '/e/' + data.token + '/manifest.json';
                installLink.href = 'stremio://' + window.location.hostname + ':' + window.location.port + path;
                directUrl.value  = base + path;
                urlBlock.style.display = 'block';
            } catch (err) {
                installLink.href = '#';
                urlBlock.style.display = 'none';
                showToast(err.message || 'API Key inválida ou Torbox indisponível.');
            }
        }

        function scheduleUpdate() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(updateLink, 250);
        }

        function copyUrl() {
            const val = directUrl.value;
            if (!val) return;
            navigator.clipboard?.writeText(val).catch(() => {
                directUrl.select();
                document.execCommand('copy');
            });
            copyBtn.textContent = 'Copiado!';
            copyBtn.classList.add('copied');
            setTimeout(() => { copyBtn.textContent = 'Copiar'; copyBtn.classList.remove('copied'); }, 2000);
        }

        function showToast(msg) {
            toast.textContent = msg;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2500);
        }

        installLink.addEventListener('click', e => {
            if (!isP2pActive() && !apiKeyInput.value.trim()) {
                e.preventDefault();
                showToast('Insira sua API Key do Torbox.');
            }
        });

        apiKeyInput.addEventListener('input', scheduleUpdate);
        apiKeyInput.addEventListener('paste', () => setTimeout(scheduleUpdate, 100));

        toggleP2p();
    </script>
</body>
</html>`;
};

logger.info('ConfigureTemplate v5.0.0 carregado - UI compacta mobile-first');
