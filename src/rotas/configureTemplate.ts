import { Logger } from '../utils/logger.js';

const logger = new Logger('ConfigureTemplate');

export const configureTemplate = (manifest: any, apiKey: string = '', p2pEnabled: boolean = true) => {
    const logo = manifest.logo || '';
    const inicialApiKey = apiKey || '';
    const showP2p = p2pEnabled;

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
            --accent-glow: rgba(124,58,237,0.25);
            --text: #f1f0f5;
            --muted: #8b8a97;
            --success: #22c55e;
            --warning: #f59e0b;
            --radius: 14px;
            --radius-sm: 8px;
        }

        html, body {
            min-height: 100%;
            background: var(--bg);
            color: var(--text);
            font-family: 'Inter', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
        }

        body {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px 16px;
        }

        /* Subtle grid background */
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
            max-width: 440px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 20px;
            overflow: hidden;
            box-shadow:
                0 0 0 1px rgba(255,255,255,0.04),
                0 24px 64px rgba(0,0,0,0.5),
                0 0 80px var(--accent-glow);
        }

        /* Top accent bar */
        .card::before {
            content: '';
            display: block;
            height: 3px;
            background: linear-gradient(90deg, #7c3aed, #a855f7, #7c3aed);
            background-size: 200% 100%;
            animation: shimmer 3s linear infinite;
        }
        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .card-body {
            padding: 36px 32px 32px;
        }

        /* Header */
        .header {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 14px;
            margin-bottom: 32px;
        }

        .logo-wrap {
            width: 72px;
            height: 72px;
            border-radius: 18px;
            background: linear-gradient(135deg, #3d1a6e, #1e0a3c);
            border: 1px solid rgba(124,58,237,0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 24px var(--accent-glow);
            overflow: hidden;
        }

        .logo-wrap img {
            width: 100%;
            height: 100%;
            object-fit: contain;
        }

        /* SVG fallback icon */
        .logo-wrap .icon-fallback {
            width: 40px;
            height: 40px;
            fill: #a855f7;
        }

        .title-block {
            text-align: center;
        }

        .addon-name {
            font-size: 22px;
            font-weight: 700;
            letter-spacing: -0.3px;
            color: var(--text);
        }

        .addon-version {
            font-size: 12px;
            color: var(--muted);
            margin-top: 3px;
            font-weight: 500;
        }

        /* Feature chips */
        .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
            margin-bottom: 28px;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 11px;
            border-radius: 999px;
            background: var(--surface2);
            border: 1px solid var(--border);
            font-size: 11px;
            font-weight: 500;
            color: var(--muted);
        }

        .chip-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent-light);
            flex-shrink: 0;
        }

        /* Divider */
        .divider {
            border: none;
            border-top: 1px solid var(--border);
            margin: 24px 0;
        }

        /* Section label */
        .section-label {
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--muted);
            margin-bottom: 10px;
        }

        /* Input */
        .input-wrap {
            position: relative;
        }

        .input-wrap svg {
            position: absolute;
            left: 13px;
            top: 50%;
            transform: translateY(-50%);
            width: 16px;
            height: 16px;
            stroke: var(--muted);
            fill: none;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            pointer-events: none;
        }

        input[type="text"] {
            width: 100%;
            padding: 11px 12px 11px 38px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--text);
            font-family: inherit;
            font-size: 13.5px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        input[type="text"]:focus {
            border-color: var(--accent-light);
            box-shadow: 0 0 0 3px var(--accent-glow);
        }
        input[type="text"]::placeholder { color: var(--muted); }
        input[type="text"]:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Toggle (P2P) */
        .toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            user-select: none;
            margin-top: 12px;
        }
        .toggle-row:hover { border-color: rgba(255,255,255,0.14); }

        .toggle-label {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .toggle-title { font-size: 13.5px; font-weight: 500; color: var(--text); }
        .toggle-desc { font-size: 11px; color: var(--muted); }

        /* Switch */
        .switch {
            position: relative;
            width: 40px;
            height: 22px;
            flex-shrink: 0;
        }
        .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .slider {
            position: absolute;
            inset: 0;
            background: var(--border);
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.1);
            transition: background 0.2s;
            cursor: pointer;
        }
        .slider::after {
            content: '';
            position: absolute;
            left: 3px;
            top: 50%;
            transform: translateY(-50%);
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            transition: left 0.2s;
        }
        .switch input:checked ~ .slider { background: var(--accent); }
        .switch input:checked ~ .slider::after { left: 21px; }

        /* Torbox referral button */
        .torbox-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 11px;
            background: rgba(124,58,237,0.08);
            border: 1px solid rgba(124,58,237,0.25);
            border-radius: var(--radius-sm);
            color: #a78bfa;
            font-family: inherit;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.2s, border-color 0.2s;
            margin-bottom: 16px;
        }
        .torbox-btn:hover {
            background: rgba(124,58,237,0.15);
            border-color: rgba(124,58,237,0.45);
            color: #c4b5fd;
        }
        .offer-badge { display:inline-flex; background:#22c55e; color:#052e16; border-radius:999px; padding:3px 9px; font-size:10px; font-weight:700; margin-left:4px; }
        .offer-copy { text-align:center; color:#a7f3d0; font-size:12px; line-height:1.45; margin:-8px 0 16px; }
        .torbox-btn svg {
            width: 15px;
            height: 15px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            flex-shrink: 0;
        }

        /* Install button */
        .install-btn {
            display: block;
            width: 100%;
            padding: 13px;
            background: linear-gradient(135deg, #7c3aed, #6d28d9);
            border: none;
            border-radius: var(--radius-sm);
            color: #fff;
            font-family: inherit;
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.02em;
            cursor: pointer;
            text-align: center;
            text-decoration: none;
            transition: opacity 0.15s, transform 0.1s, box-shadow 0.2s;
            box-shadow: 0 4px 16px rgba(109,40,217,0.4);
        }
        .install-btn:hover { opacity: 0.9; box-shadow: 0 6px 20px rgba(109,40,217,0.55); }
        .install-btn:active { transform: scale(0.985); }

        /* Manifest URL field */
        .url-block {
            margin-top: 16px;
            display: none;
        }

        .url-field {
            display: flex;
            gap: 8px;
        }

        input[type="text"].url-input {
            padding-left: 12px;
            flex: 1;
            font-size: 11.5px;
            background: var(--surface2);
            color: var(--muted);
            cursor: pointer;
        }

        .copy-btn {
            flex-shrink: 0;
            padding: 0 14px;
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--muted);
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
            white-space: nowrap;
        }
        .copy-btn:hover { color: var(--text); border-color: rgba(255,255,255,0.2); }
        .copy-btn.copied { color: var(--success); border-color: var(--success); }

        .url-label {
            font-size: 11px;
            color: var(--muted);
            margin-bottom: 8px;
        }

        /* Toast */
        .toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(10px);
            background: var(--surface2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 10px 18px;
            font-size: 13px;
            color: var(--text);
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            pointer-events: none;
            white-space: nowrap;
            z-index: 99;
        }
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* Mobile */
        @media (max-width: 480px) {
            .card-body { padding: 28px 20px 24px; }
            .addon-name { font-size: 20px; }
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="card-body">

            <!-- Header -->
            <div class="header">
                <div class="logo-wrap" id="logoWrap">
                    <img src="${logo}" alt="${manifest.name}" id="logoImg" onerror="this.style.display='none';document.getElementById('iconFallback').style.display='block'">
                    <svg id="iconFallback" class="icon-fallback" style="display:none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <div class="title-block">
                    <div class="addon-name">${manifest.name}</div>
                    <div class="addon-version">v${manifest.version}</div>
                </div>
            </div>

            <!-- Feature chips -->
            <div class="chips">
                <div class="chip"><span class="chip-dot"></span>Filmes</div>
                <div class="chip"><span class="chip-dot"></span>Séries</div>
                <div class="chip"><span class="chip-dot"></span>Anime</div>
                <div class="chip"><span class="chip-dot"></span>Torbox</div>
                ${showP2p ? `<div class="chip"><span class="chip-dot"></span>P2P</div>` : ''}
                <div class="chip"><span class="chip-dot"></span>PT-BR</div>
            </div>

            <hr class="divider">

            <!-- Torbox referral -->
            <a class="torbox-btn" href="https://torbox.app/subscription?referral=b08bcd10-8df2-44c9-a0ba-4d5bdb62ef96" target="_blank" rel="noopener">
                <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Assinar Torbox <span class="offer-badge">OFERTA</span>
            </a>
            <div class="offer-copy"><strong>Ganhe 7 dias extras a cada mês assinado</strong><br>12 meses = <strong>84 dias bônus</strong></div>

            <!-- API Key -->
            <div class="section-label">Chave de API</div>
            <div class="input-wrap">
                <svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                <input type="text"
                       id="${manifest.config[0].key}"
                       name="${manifest.config[0].key}"
                       placeholder="Cole sua chave de API do Torbox"
                       value="${inicialApiKey}"
                       autocomplete="off"
                       spellcheck="false">
            </div>

            <!-- P2P Toggle -->
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
            </div>
            ` : `<input type="hidden" id="p2pMode" value="false">`}

            <div class="toggle-row" onclick="toggleOption('excludeKeywords')">
                <div class="toggle-label"><span class="toggle-title">Filtrar keywords ruins</span><span class="toggle-desc">CAM, Dual-LAT, Cinecalidad, sample, VF...</span></div>
                <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" id="excludeKeywords"><span class="slider"></span></label>
            </div>
            <div class="toggle-row" onclick="toggleOption('excludeQuality')">
                <div class="toggle-label"><span class="toggle-title">Filtrar qualidade ruim</span><span class="toggle-desc">CAM, CAMRip, TC, HDTC</span></div>
                <label class="switch" onclick="event.stopPropagation()"><input type="checkbox" id="excludeQuality"><span class="slider"></span></label>
            </div>

            <hr class="divider">

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

        // P2P pode estar desabilitado no servidor (input hidden)
        const p2pAvailable = ${showP2p ? 'true' : 'false'};

        let debounceTimer = null;

        function isP2pActive() {
            if (!p2pAvailable) return false;
            return p2pCheckbox && p2pCheckbox.checked;
        }

        function toggleP2p() {
            if (!p2pAvailable) return;
            const isP2p = p2pCheckbox.checked;
            apiKeyInput.disabled = isP2p;
            scheduleUpdate();
        }

        function toggleOption(id) {
            const el = document.getElementById(id);
            el.checked = !el.checked;
            scheduleUpdate();
        }

        async function updateLink() {
            const apiKey = apiKeyInput.value.trim();
            const isP2p  = isP2pActive();
            const excludeKeywords = document.getElementById('excludeKeywords').checked;
            const excludeQuality = document.getElementById('excludeQuality').checked;
            const base   = window.location.protocol + '//' + window.location.host;

            if (!isP2p && !apiKey) {
                installLink.href = '#';
                urlBlock.style.display = 'none';
                return;
            }

            try {
                const resp = await fetch('/api/encrypt-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey, p2p: isP2p, excludeKeywords, excludeQuality })
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

        installLink.addEventListener('click', (e) => {
            if (!isP2pActive() && !apiKeyInput.value.trim()) {
                e.preventDefault();
                showToast('Insira sua API Key do Torbox.');
            }
        });

        apiKeyInput.addEventListener('input', scheduleUpdate);
        apiKeyInput.addEventListener('paste', () => setTimeout(scheduleUpdate, 100));

        document.getElementById('mainForm') && (document.getElementById('mainForm').onsubmit = e => e.preventDefault());

        toggleP2p();
    </script>
</body>
</html>`;
};

logger.info('ConfigureTemplate v4.0.0 carregado - UI moderna pjbr');
