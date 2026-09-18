import { Stream, StreamRequest } from '../types/index.js';
import { analisarMagnet, gerarUrlResolve } from '../magnet/magnetHelper.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { Logger } from '../utils/logger.js';
import { MetadataExtractor } from '../titulos/MetadataExtractor.js';
import { EnhancedSeriesMetadata } from '../titulos/interfaces.js';
import { enrichMagnetTrackers } from '../lib/trackerEnrich.js';

export class StreamFormatter {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly metadataExtractor: MetadataExtractor;
  private resolveBaseUrl?: string;

  private static instance: StreamFormatter;

  public static getInstance(): StreamFormatter {
    if (!StreamFormatter.instance) {
      StreamFormatter.instance = new StreamFormatter();
    }
    return StreamFormatter.instance;
  }

  constructor() {
    this.logger = new Logger('StreamFormatter');
    this.qualityDetector = QualityDetector.getInstance();
    this.metadataExtractor = MetadataExtractor.getInstance();
    // Versionamento Semântico v2.0.0 - MAJOR: Formato de título corrigido igual Torrentio
    this.logger.debug('StreamFormatter ready'); // versão silenciosa
  }

  public setResolveBaseUrl(baseUrl: string): void {
    this.resolveBaseUrl = baseUrl.replace(/\/$/, '');
  }

  // Formato StremThru-style (com identidade Brasil RD)
  // Linha 1: titulo completo do torrent
  // Linha 2: 💾 tamanho 👤 seeds 🔍 tracker/provedor
  // Linha 3: 💿 qualidade 🎞️ codec 📺 HDR 🎧 audio 🌐 idioma 📅 data
  private formatTitleCorreto(
    torrentTitle: string,
    seeds?: number,
    size?: string,
    language?: string,
    provider?: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false,
    quality?: string,
    dataUpload?: string,
    flags?: string
  ): string {
    // PRIMEIRA LINHA: Titulo canonico do magnet (dn do parse-torrent)
    let result = torrentTitle.trim();

    // SEGUNDA LINHA: tamanho, seeds, tracker (estilo StremThru)
    const segundaLinha: string[] = [];
    if (size) {
      segundaLinha.push(`💾 ${size}`);
    }
    segundaLinha.push(`👤 ${seeds !== undefined && seeds > 0 ? seeds : 0}`);
    if (provider) {
      segundaLinha.push(`🔍 ${provider}`);
    }
    if (segundaLinha.length > 0) {
      result += '\n' + segundaLinha.join(' ');
    }

    // TERCEIRA LINHA: perfil tecnico + idioma (+ data opcional)
    const infoTecnica = this.extrairInfoTecnica(result, metadata);
    const terceiraLinha: string[] = [];
    if (quality) {
      terceiraLinha.push(`💿 ${quality}`);
    }
    if (infoTecnica.codec) {
      terceiraLinha.push(`🎞️ ${infoTecnica.codec}`);
    }
    if (infoTecnica.hdr) {
      terceiraLinha.push(`📺 ${infoTecnica.hdr}`);
    }
    if (infoTecnica.audio) {
      terceiraLinha.push(`🎧 ${infoTecnica.audio}`);
    }
    const idiomaLabel = this.formatarIdioma(language || 'PT-BR');
    terceiraLinha.push(`🌐 ${idiomaLabel}${flags ? ' ' + flags : ''}`);
    if (dataUpload) {
      terceiraLinha.push(`📅 ${dataUpload}`);
    }
    if (terceiraLinha.length > 0) {
      result += '\n' + terceiraLinha.join(' ');
    }

    return result;
  }

  // Nome da stream estilo StremThru:
  // Linha 1: badges da store (⚡️ quando em cache, [TB] com debrid ativado)
  // Linha 2: nome do addon (ADDON_NAME permite identificar a instância, ex: brasilrd-vercel)
  // Linha 3: resolucao
  private montarNomeStream(qualidade: string, emCache: boolean, debridAtivo: boolean): string {
    const badges: string[] = [];
    if (debridAtivo) {
      badges.push(emCache ? '⚡️ [TB]' : '[TB]');
    }
    const partes: string[] = [];
    if (badges.length > 0) {
      partes.push(badges.join(' '));
    }
    partes.push((process.env.ADDON_NAME || 'Brasil RD').trim());
    partes.push(qualidade);
    return partes.join('\n');
  }

  // Extrai perfil tecnico (codec/HDR/audio) do titulo + metadata, estilo StremThru
  private extrairInfoTecnica(titulo: string, metadata?: EnhancedSeriesMetadata): { codec?: string; hdr?: string; audio?: string } {
    const t = titulo.toLowerCase();

    let codec: string | undefined;
    if (metadata?.codec && metadata.codec !== 'unknown') {
      codec = metadata.codec;
    }
    if (/x\.?265|hevc/i.test(t)) {
      codec = 'HEVC';
    } else if (/x\.?264|avc|h\.?264/i.test(t)) {
      codec = 'H.264';
    } else if (/\bav1\b/i.test(t)) {
      codec = 'AV1';
    }
    if (codec && /\b(unknown|desconhecido|hd)\b/i.test(codec)) {
      codec = undefined;
    }

    const hdrMarcas: string[] = [];
    const possuiDV = /dolby\s*vision|dovi/i.test(t);
    const possuiHdr10Plus = /hdr10\s*\+/i.test(t);
    const possuiHdr10 = /hdr10(?![+\s\d])/i.test(t);
    const possuiHdr = /\bhdr\b/i.test(t);
    if (possuiDV) hdrMarcas.push('DV');
    if (possuiHdr10Plus) hdrMarcas.push('HDR10+');
    else if (possuiHdr10) hdrMarcas.push('HDR10');
    if (possuiHdr && !possuiDV && !possuiHdr10 && !possuiHdr10Plus) hdrMarcas.push('HDR');
    const hdr = hdrMarcas.length > 0 ? hdrMarcas.join(' ') : undefined;

    let audio: string | undefined;
    if (/dolby\s*atmos|\batmos\b/i.test(t)) {
      audio = 'Atmos';
    } else if (/\btruehd\b/i.test(t)) {
      audio = 'TrueHD';
    } else if (/dts[-_. ]?hd/i.test(t)) {
      audio = 'DTS-HD';
    } else if (/\bdts\b/i.test(t)) {
      audio = 'DTS';
    } else if (/\beac-?3\b/i.test(t)) {
      audio = 'EAC3';
    } else if (/\bac-?3\b/i.test(t)) {
      audio = 'AC3';
    } else if (/\baac\b/i.test(t)) {
      audio = 'AAC';
    }

    return { codec, hdr, audio };
  }

  // Formata data de upload (DD/MM/AAAA)
  private formatarDataUpload(data?: Date | string): string | undefined {
    if (!data) return undefined;
    const dataObj = new Date(data);
    if (isNaN(dataObj.getTime())) return undefined;
    return dataObj.toLocaleDateString('pt-BR');
  }

  // Formata tamanho em bytes (número) ou string já formatada ("4.31 GB") para exibição
  private formatarTamanho(tamanho?: number | string): string | undefined {
    if (tamanho === undefined || tamanho === null) return undefined;
    if (typeof tamanho === 'string') {
      const texto = tamanho.trim();
      if (!texto || texto === '' || /^n\/a$/i.test(texto) || /^desconhecido$/i.test(texto)) return undefined;
      // Já formatado: "4.31 GB", "1.2GB", "900 MB"...
      const jaFormatado = texto.match(/^(\d+(?:[.,]\d+)?)\s*([KMGT]?B)\b/i);
      if (jaFormatado) {
        const unidade = jaFormatado[2].toUpperCase() === 'B' ? 'MB' : jaFormatado[2].toUpperCase();
        return `${jaFormatado[1].replace(',', '.')} ${unidade}`;
      }
      // Texto numérico puro (bytes)
      if (/^\d+$/.test(texto)) {
        return this.formatarTamanho(parseInt(texto, 10));
      }
      return undefined;
    }
    if (typeof tamanho === 'number') {
      if (!Number.isFinite(tamanho) || tamanho <= 0) return undefined;
      const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
      let valor = tamanho;
      let indice = 0;
      while (valor >= 1024 && indice < unidades.length - 1) {
        valor /= 1024;
        indice++;
      }
      const casas = indice < 2 ? 0 : 2;
      return `${valor.toFixed(casas)} ${unidades[indice]}`;
    }
    return undefined;
  }

  // Extrai o tamanho exato em bytes a partir de um valor numérico ou string
  // ("2.5 GB", "900 MB", "1,2 TB"). Usado no behaviorHints.videoSize para que
  // consumidores (aiostreams/Nuvio/Jellyfin) exibam o tamanho corretamente.
  private extrairTamanhoBytes(tamanho?: number | string): number | undefined {
    if (tamanho === undefined || tamanho === null) return undefined;
    if (typeof tamanho === 'number') {
      return Number.isFinite(tamanho) && tamanho > 0 ? Math.round(tamanho) : undefined;
    }
    const texto = String(tamanho).trim();
    const m = texto.match(/^(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|TB)\b/i);
    if (!m) return undefined;
    const valor = parseFloat(m[1].replace(',', '.'));
    if (isNaN(valor) || valor <= 0) return undefined;
    const unidade = m[2].toUpperCase();
    const multiplicador = unidade === 'TB' ? 1024 ** 4
      : unidade === 'GB' ? 1024 ** 3
      : unidade === 'MB' ? 1024 ** 2
      : 1024;
    return Math.round(valor * multiplicador);
  }

  // Adiciona a qualidade real ao titulo caso ele nao a mencione
  private atualizarQualidadeNoTitulo(titulo: string, qualidade: string): string {
    const regexQualidade = new RegExp(`\\b${qualidade}\\b`, 'i');
    if (regexQualidade.test(titulo)) {
      return titulo;
    }
    const regexEntreParenteses = /\s*\(\s*(\d{3,4}p|4k|uhd|hd)\s*\)/i;
    if (regexEntreParenteses.test(titulo)) {
      return titulo.replace(regexEntreParenteses, ` (${qualidade})`);
    }
    return `${titulo} (${qualidade})`;
  }

  // Formata idioma mantendo nossos padrões.
  // IMPORTANTE: multi-áudio "Dual" (PT-BR + original) e "Dual Áudio" são
  // exibidos como PT-BR — o release tem faixa de áudio em português do
  // Brasil, então o resultado aparece como "português brasil" no
  // Stremio/Nuvio/aiostreams.
  private formatarIdioma(idioma: string): string {
    if (!idioma) return 'PT-BR';

    // Normaliza (v1.6.2): remove acentos e trata valores inválidos como PT-BR
    const idiomaNormalizado = idioma
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim();

    if (['', 'desconhecido', 'unknown', 'undefined', 'null', 'n/a', 'na'].includes(idiomaNormalizado)) {
      return 'PT-BR';
    }

    const mapaIdiomas: Record<string, string> = {
      'pt-br': 'PT-BR',
      'pt': 'PT-BR',
      'portuguese': 'PT-BR',
      'portugues': 'PT-BR',
      'portugues,english': 'PT-BR',
      'brazilian': 'PT-BR',
      'dublado': 'PT-BR',
      'dublada': 'PT-BR',
      'dublagem': 'PT-BR',
      'nacional': 'PT-BR',

      // Dual / Dual Áudio / dual audio => tem áudio PT-BR -> mostrar PT-BR
      'dual': 'PT-BR',
      'dual audio': 'PT-BR',
      'dualaudio': 'PT-BR',
      'pt-br,en': 'PT-BR',
      'pt-br,en-us': 'PT-BR',
      'portuguese,english': 'PT-BR',
      'dublado,legendado': 'PT-BR',

      'en': 'EN',
      'english': 'EN',
      'eng': 'EN',
      'legendado': 'EN',
      'legendada': 'EN',
      'legenda': 'EN',
      'subtitled': 'EN',

      'multi': 'Multi',
      'multilanguage': 'Multi',
      'pt-br,en-us,ja-jp': 'Multi',

      'es': 'ES',
      'spanish': 'ES',
      'esp': 'ES',

      'fr': 'FR',
      'french': 'FR'
    };

    if (mapaIdiomas[idiomaNormalizado]) {
      return mapaIdiomas[idiomaNormalizado];
    }

    // Casamento por palavra (v1.6.2) em vez de includes — evita "es" casando
    // em "portugues", etc.
    for (const [chave, valor] of Object.entries(mapaIdiomas)) {
      const k = chave.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[-.,]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(idiomaNormalizado)) {
        return valor;
      }
    }

    return idioma.toUpperCase();
  }

  // Extrai tracker do magnet (mantido)
  private extrairTracker(magnet: string): string {
    if (!magnet) return 'Torrent';
    
    if (magnet.includes('thepiratebay')) return 'ThePirateBay';
    if (magnet.includes('1337x')) return '1337x';
    if (magnet.includes('rarbg')) return 'RARBG';
    if (magnet.includes('torrentgalaxy')) return 'TorrentGalaxy';
    if (magnet.includes('magnetdl')) return 'MagnetDL';
    
    return 'Torrent';
  }

  // Stream direto do Torbox - FORMATO CORRIGIDO (StremThru-style)
  async criarStreamDireto(
    torrentTitle: string, // Título COMPLETO do torrent
    descricao: string,
    linkDireto: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number,
    debridAtivo: boolean = false,
    dataUpload?: string,
    tamanhoBytes?: number // tamanho exato em bytes (videoSize p/ consumidores)
  ): Promise<Stream> {
    /* DEBUG SILENCIOSO
    this.logger.debug('CRIANDO_STREAM_DIRETO', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });
    */

    // Extrai informações da descrição para usar nos emojis
    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
    const bandeirasIdioma = this.extrairBandeirasDaDescricao(descricao);

    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;

    const qualidadeReal = qualidade || 'HD';
    const tituloComQualidadeReal = this.atualizarQualidadeNoTitulo(torrentTitle, qualidadeReal);
    
    // Formata título NO FORMATO STREMTHRU: linha1=título, linha2=tamanho/seeds/provedor, linha3=técnico+idioma
    const tituloFinal = this.formatTitleCorreto(
      tituloComQualidadeReal, // Título COMPLETO do torrent (com qualidade real)
      seeds,
      tamanho,
      idiomaDaDescricao,
      'Torbox', // Tracker fixo para stream direto
      metadata,
      true, // isDirect
      qualidadeReal,
      dataUpload,
      bandeirasIdioma
    );

    // Stream no formato Stremio
    const stream: Stream = {
      name: this.montarNomeStream(qualidadeReal, true, debridAtivo),
      title: tituloFinal, // Título com 2-3 linhas e \n
      infoHash: (await analisarMagnet(linkDireto))?.infoHash || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0,
      url: linkDireto
    };

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${tipo || 'movie'}-${qualidadeReal}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]).trim(),
        streamQuality: qualidadeReal,
        preferredAudioLanguage: 'por',
        ...(tamanhoBytes !== undefined ? { videoSize: tamanhoBytes } : {}),
        ...behaviorHints
      };
    }

    return stream;
  }

  // Stream lazy (magnet) - FORMATO CORRIGIDO (StremThru-style)
  async criarStreamLazy(
    torrentTitle: string, // Título COMPLETO do torrent
    descricao: string,
    magnet: string,
    apiKey: string,
    provider: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number,
    p2p: boolean = false,
    emCache: boolean = false,
    dataUpload?: string,
    tamanhoBytes?: number // tamanho exato em bytes (videoSize p/ consumidores)
  ): Promise<Stream> {
    /* DEBUG SILENCIOSO
    this.logger.debug('CRIANDO_STREAM_LAZY', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });
    */

    // Só enriquece trackers no modo P2P. Fluxo Torbox/debrid mantém o magnet
    // original e os seeds reais consultados pela API.
    const magnetParaP2P = p2p ? enrichMagnetTrackers(magnet) : magnet;
    const dadosMagnet = await analisarMagnet(magnetParaP2P);
    const magnetHash = dadosMagnet?.infoHash;

    // Qualidade real: se o scraper disse apenas "HD", tenta extrair da fonte canonica (dn do magnet)
    let qualidadeReal = qualidade || 'HD';
    if (dadosMagnet?.nome && (qualidadeReal === 'HD' || qualidadeReal === 'Desconhecido')) {
      const qualidadeDoMagnet = this.qualityDetector.extractBestQuality(dadosMagnet.nome);
      if (qualidadeDoMagnet && qualidadeDoMagnet !== 'HD' && qualidadeDoMagnet !== 'unknown') {
        qualidadeReal = qualidadeDoMagnet;
      }
    }
    const tituloComQualidadeReal = this.atualizarQualidadeNoTitulo(torrentTitle, qualidadeReal);

    // Extrai informações da descrição para usar nos emojis
    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB|TB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
    const bandeirasIdioma = this.extrairBandeirasDaDescricao(descricao);

    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
    
    // Formata título NO FORMATO STREMTHRU: linha1=título, linha2=tamanho/seeds/provedor, linha3=técnico+idioma
    const tituloFinal = this.formatTitleCorreto(
      tituloComQualidadeReal, // Título COMPLETO do torrent (com qualidade real)
      seeds,
      tamanho,
      idiomaDaDescricao,
      provider,       // FONTE DO SCRAPER (Comando, BLUDV, TorrentIndexer...)
      metadata,
      false, // isDirect
      qualidadeReal,
      dataUpload,
      bandeirasIdioma
    );

    // Gera URL de resolve
    let resolveUrl = '';
    try {
      const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
      resolveUrl = await gerarUrlResolve(
        magnet,
        apiKey,
        filename,
        fileIdx || 0,
        tipo,
        temporada,
        episodio,
        qualidadeReal,
        magnetHash, // evita re-parse — já temos do analisarMagnet acima
        this.resolveBaseUrl
      );
      
      /* DEBUG SILENCIOSO
      this.logger.debug('URL_LAZY_GERADA', {
        formato: 'torrentio_rd',
        url_preview: resolveUrl.substring(0, 100),
        filename: filename,
        fileIdx: fileIdx || 0
      });
      */
    } catch (error) {
      this.logger.error('ERRO_GERAR_URL_LAZY', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }

    // Stream lazy resolve — infoHash só se NÃO tiver URL (evita P2P no Stremio Web)
    const stream: Stream = {
      name: this.montarNomeStream(qualidadeReal, emCache, !!apiKey),
      title: tituloFinal,
      // P2P: não force fileIdx=0. Alguns torrents Stark têm poster/imagem
      // antes do vídeo; Nuvio respeita 0 e fica em imagem estática. Sem índice,
      // o cliente escolhe o primeiro arquivo de vídeo (Stremio já fazia isso).
      fileIdx: p2p ? undefined : (fileIdx !== undefined ? fileIdx : 0)
    };

    if (p2p) {
      stream.infoHash = magnetHash || undefined;
      stream.sources = dadosMagnet?.anuncios.map(tracker => `tracker:${tracker}`) || [];
    } else if (resolveUrl) {
      stream.url = resolveUrl;
    } else {
      stream.infoHash = magnetHash || undefined;
    }

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${tipo || 'movie'}-${qualidadeReal}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]).trim(),
        streamQuality: qualidadeReal,
        preferredAudioLanguage: 'por',
        ...(tamanhoBytes !== undefined ? { videoSize: tamanhoBytes } : {}),
        ...behaviorHints
      };
    }

    // Adiciona metadata de pacote se for o caso
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    /* DEBUG SILENCIOSO
    this.logger.debug('STREAM_LAZY_CRIADO', {
      titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      fonte: provider,
      formato: 'torrentio_com_titulo_correto_e_url'
    });
    */

    return stream;
  }

  // Extrai idioma da descrição
  // Ordem de prioridade: PT (dublado/dual/nacional/pt-br) > legendado > multi > demais.
  // Releases "Dual"/"Dual Áudio" no título (filename) são tratados como PT-BR
  // (possuem faixa de áudio em português do Brasil).
  private extrairIdiomaDaDescricao(descricao: string): string {
    if (!descricao) return 'PT-BR';

    const texto = descricao.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[._-]+/g, ' ');

    // 1) Marcadores de áudio PT-BR (dublado / dual / nacional / áudio em pt)
    if (/\b(?:dual|dublado|dublada|dublagem|nacional|brazilian)\b/.test(texto)) return 'PT-BR';
    if (/du[ _-]*audio|audio[ _-]*pt|pt[ _-]*br/.test(texto)) return 'PT-BR';

    // 2) PT-BR / português explícito
    if (/\bpt[-_ ]?br\b|\bportugue[sse]{2}\b|\bportugues\b|\bportuguês\b/i.test(texto)) return 'PT-BR';

    // 3) Legendado / subtitled => sem áudio PT-BR => EN
    if (/\blegendad[oa]\b|\blegenda\b|\bsubtitulad[oa]\b|\bsubtitled\b/.test(texto)) return 'EN';

    // 4) Multi
    if (/\bmulti(?:language)?\b/.test(texto)) return 'Multi';

    // 5) Idiomas explícitos
    if (/\benglish\b|\beng\b|\ben\b/.test(texto)) return 'EN';
    if (/\bspanish\b|\besp\b|\bes\b/.test(texto)) return 'ES';
    if (/\bfrench\b|\bfr\b/.test(texto)) return 'FR';

    return 'PT-BR';
  }

  // Extrai as bandeiras de idioma para exibição no título.
  // O AIOStreams/StremThru extraem idioma do stream pelas FLAGS de países no
  // título (getLanguages). "Dual Audio" sem flags cai em NON_SPECIFIC_LANGUAGES
  // e é rebaixado no filtro de idioma — aqui expomos explicitamente PT+EN etc.
  private extrairBandeirasDaDescricao(descricao: string): string {
    if (!descricao) return '🇧🇷';

    const texto = descricao.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[._-]+/g, ' ');

    // Dual = áudio PT-BR + original (geralmente EN)
    if (/\bdual\b|du[ _-]*audio|dual[ _-]*lang/.test(texto)) return '🇧🇷 🇺🇸';

    const bandeiras: string[] = [];
    if (/\bpt[-_ ]?br\b|portugues\b|portuguese\b|brazilian\b|dublad[oa]\b|dublagem|nacional\b/.test(texto)) bandeiras.push('🇧🇷');
    if (/\bjapanese\b|\bjap\b|\bjpn\b/.test(texto)) bandeiras.push('🇯🇵');
    if (/\benglish\b|\beng\b|\ben\b|\blegendad[oa]\b|\blegenda\b|\bsubbed\b/.test(texto)) bandeiras.push('🇺🇸');
    if (/\bspanish\b|\besp\b|\bes\b/.test(texto)) bandeiras.push('🇪🇸');
    if (/\bfrench\b|\bfr\b/.test(texto)) bandeiras.push('🇫🇷');

    if (bandeiras.length > 0) return bandeiras.join(' ');

    // Multi sem idiomas específicos no texto -> fica sem flags (genérico)
    if (/\bmulti(?:language)?\b/.test(texto)) return '';

    // Padrão do addon é PT-BR
    return '🇧🇷';
  }

  // Cria streams separados para cada qualidade - MÉTODO PRINCIPAL CORRIGIDO
  async criarStreamsMultiplasQualidades(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    tipo: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number,
    cachedNoDebrid: boolean = false
  ): Promise<Stream[]> {
    // NOME CANÔNICO do parse-torrent (dn) como fonte principal; scraper title só como fallback
    const tituloFonte = torrent.canonicalName || torrent.title;
    const todasQualidades = this.extrairTodasQualidades(tituloFonte);

    // O debrid (Torbox) está ativado? → badge [TB] no nome da stream
    const debridAtivo = !!request.apiKey;
    const dataUpload = this.formatarDataUpload(torrent.uploadDate);

    // Qualidade do scraper (quando específica) tem prioridade sobre a extração do título
    const qualidadeScraper = torrent.quality
      ? (this.normalizarQualidade(torrent.quality) || torrent.quality)
      : undefined;
    if (qualidadeScraper && qualidadeScraper !== 'HD' &&
        qualidadeScraper !== 'Desconhecido' && qualidadeScraper !== 'unknown' &&
        !todasQualidades.includes(qualidadeScraper)) {
      todasQualidades.push(qualidadeScraper);
      todasQualidades.sort(this.compararQualidades);
    }
    
    /* DEBUG SILENCIOSO
    this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
      titulo_torrent: tituloFonte.substring(0, 80),
      qualidades_encontradas: todasQualidades.length,
      tipo: tipo,
      temporada: temporada,
      episodio: episodio
    });
    */

    // Se não encontrou qualidades, usa detector padrão
    if (todasQualidades.length === 0) {
      const qualidadePadrao = this.qualityDetector.extractBestQuality(tituloFonte);
      if (qualidadePadrao && qualidadePadrao !== 'unknown') {
        todasQualidades.push(qualidadePadrao);
      } else {
        todasQualidades.push('HD');
      }
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(tituloFonte);

    // Cria stream SEPARADO para cada qualidade
    for (const qualidade of todasQualidades) {
      // DESCRIÇÃO base com seeds, tamanho (formatado) e idioma
      const tamanhoFormatado = this.formatarTamanho(torrent.size);
      const tamanhoBytes = this.extrairTamanhoBytes(torrent.size);
      const descricaoBase = `${tituloFonte}\n${torrent.seeders || 0} seeds | ${tamanhoFormatado || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
      
      // TÍTULO COMPLETO do torrent (não modificado)
      const tituloCompletoTorrent = tituloFonte;
      
      if (disponivelNoRD && linkDireto) {
        // Stream direto do Torbox (em cache no debrid)
        streams.push(await this.criarStreamDireto(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          linkDireto,
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`
          },
          metadata,
          fileIdx,
          debridAtivo,
          dataUpload,
          tamanhoBytes
        ));
      } else {
        // Stream lazy com magnet
        streams.push(await this.criarStreamLazy(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          torrent.magnet,
          request.apiKey!,
          torrent.provider || 'Torrent',  // fonte do scraper
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`
          },
          metadata,
          fileIdx,
          !!request.config?.p2p,
          cachedNoDebrid,
          dataUpload,
          tamanhoBytes
        ));
      }
      
      /* DEBUG SILENCIOSO
      this.logger.debug('QUALIDADE_STREAM_CRIADA', {
        qualidade: qualidade,
        tipo: tipo,
        temporada: temporada,
        episodio: episodio,
        tem_link_direto: !!(disponivelNoRD && linkDireto),
        formato: 'torrentio_corrigido'
      });
      */
    }

    /* DEBUG SILENCIOSO
    this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
      total: streams.length,
      qualidades: todasQualidades,
      torrent: tituloFonte.substring(0, 60),
      streams_com_url: streams.filter(s => s.url).length,
      streams_sem_url: streams.filter(s => !s.url).length,
      versao: '2.0.0',
      formato: 'torrentio_corrigido_com_url'
    });
    */

    return streams;
  }

  // Extrai todas qualidades de um título
  private extrairTodasQualidades(titulo: string): string[] {
    const padroesQualidade = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
    ];

    const qualidadesEncontradas: Set<string> = new Set();
    const tituloLower = titulo.toLowerCase();
    
    for (const padrao of padroesQualidade.slice(0, 5)) {
      const matches = tituloLower.match(padrao);
      if (matches) {
        for (const match of matches) {
          const normalizada = this.normalizarQualidade(match);
          if (normalizada) {
            qualidadesEncontradas.add(normalizada);
          }
        }
      }
    }
    
    for (const padrao of padroesQualidade.slice(5)) {
      const matches = tituloLower.match(padrao);
      if (matches) {
        for (const match of matches) {
          const qualityMatches = match.match(/\d{3,4}p/gi);
          if (qualityMatches) {
            for (const qualityMatch of qualityMatches) {
              const normalizada = this.normalizarQualidade(qualityMatch);
              if (normalizada) {
                qualidadesEncontradas.add(normalizada);
              }
            }
          }
        }
      }
    }
    
    const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(tituloLower)) !== null) {
      const normalizada = this.normalizarQualidade(listMatch[1]);
      if (normalizada) {
        qualidadesEncontradas.add(normalizada);
      }
    }
    
    const resultado = Array.from(qualidadesEncontradas);
    
    if (resultado.length === 0) {
      const qualidadePadrao = this.qualityDetector.extractBestQuality(titulo);
      if (qualidadePadrao && qualidadePadrao !== 'unknown') {
        resultado.push(qualidadePadrao);
      }
    }

    const ordemQualidade = ['2160p', '1080p', '720p', 'HD', 'SD'];
    resultado.sort((a, b) => {
      const indexA = ordemQualidade.indexOf(a);
      const indexB = ordemQualidade.indexOf(b);
      return indexA - indexB;
    });

    return resultado;
  }

  // Comparador de qualidades (melhor primeiro)
  private compararQualidades(a: string, b: string): number {
    const ordem = ['2160p', '1080p', '720p', 'HD', 'SD'];
    return ordem.indexOf(a) - ordem.indexOf(b);
  }

  // Normaliza nome da qualidade
  private normalizarQualidade(qualidade: string): string {
    const qualidadeLower = qualidade.toLowerCase();
    
    if (qualidadeLower.includes('4k') || qualidadeLower.includes('2160p') || qualidadeLower.includes('uhd')) {
      return '2160p';
    } else if (qualidadeLower.includes('1080p') || qualidadeLower.includes('fullhd') || qualidadeLower.includes('full hd')) {
      return '1080p';
    } else if (qualidadeLower.includes('720p') || qualidadeLower.includes('hd') || qualidadeLower.includes('high definition')) {
      return '720p';
    } else if (qualidadeLower.includes('480p') || qualidadeLower.includes('sd') || qualidadeLower.includes('standard definition')) {
      return 'SD';
    } else if (qualidadeLower.includes('360p') || qualidadeLower.includes('low')) {
      return 'SD';
    } else if (qualidadeLower.includes('hd')) {
      return 'HD';
    }
    
    if (qualidadeLower.match(/\d{3,4}p/)) {
      return qualidadeLower;
    }
    
    return '';
  }

  // Métodos de compatibilidade (mantidos)
  async criarStreamSerie(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    temporada: number,
    episodio: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const tamanhoFormatado = this.formatarTamanho(torrent.size);
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${tamanhoFormatado || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return await this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      torrent.provider || 'Torrent',
      qualidade,
      'series',
      temporada,
      episodio,
      {
        bingeGroup: `br-${request.id}-${qualidade}`
      },
      undefined,
      fileIdx,
      false,
      false,
      undefined,
      this.extrairTamanhoBytes(torrent.size)
    );
  }

  async criarStreamFilme(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const tamanhoFormatado = this.formatarTamanho(torrent.size);
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${tamanhoFormatado || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return await this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      torrent.provider || 'Torrent',
      qualidade,
      'movie',
      undefined,
      undefined,
      {
        bingeGroup: `br-${request.id}-${qualidade}`
      },
      undefined,
      fileIdx,
      false,
      false,
      undefined,
      this.extrairTamanhoBytes(torrent.size)
    );
  }

  // Ordena streams por qualidade
  ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    const prioridadeQualidade: Record<string, number> = {
      '2160p': 100,
      '4K': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };

    return streams.sort((a, b) => {
      // Usa streamQuality do behaviorHints (qualidade correta de cada stream individual)
      const scoreA = this.calcularScoreQualidade(a);
      const scoreB = this.calcularScoreQualidade(b);
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;  // Maior score primeiro
      }
      
      // Mesma qualidade: ordena por seeds (extrai da 2a linha do titulo)
      const seedsA = this.extrairSeedsDoTitulo(a.title);
      const seedsB = this.extrairSeedsDoTitulo(b.title);
      if (seedsB !== seedsA) return seedsB - seedsA;

      // Mesmos seeds: ordena por tamanho em GB (maior primeiro)
      const sizeA = this.extrairTamanhoDoTitulo(a.title);
      const sizeB = this.extrairTamanhoDoTitulo(b.title);
      if (sizeB !== sizeA) return sizeB - sizeA;
      
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  // Extrai seeds da linha 2 do titulo (formato: "👤 42 ...")
  private extrairSeedsDoTitulo(title?: string): number {
    if (!title) return 0;
    const lines = title.split('\n');
    if (lines.length >= 2) {
      const match = lines[1].match(/👤\s*([\d.]+[kK]?)/);
      if (match) {
        const valor = match[1];
        if (/k$/i.test(valor)) return Math.round(parseFloat(valor) * 1000);
        return Math.round(parseFloat(valor));
      }
    }
    return 0;
  }

  // Extrai tamanho em GB da linha 2 do titulo (formato: "💾 4.31 GB ...")
  private extrairTamanhoDoTitulo(title?: string): number {
    if (!title) return 0;
    const lines = title.split('\n');
    if (lines.length >= 2) {
      const match = lines[1].match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
      if (match) {
        const value = parseFloat(match[1]);
        const unidade = match[2].toUpperCase();
        if (unidade === 'TB') return value * 1024;
        if (unidade === 'MB') return value / 1024;
        return value;
      }
    }
    return 0;
  }

  // Calcula score de qualidade usando behaviorHints.streamQuality (mais preciso)
  private calcularScoreQualidade(stream: Stream): number {
    const prioridadeQualidade: Record<string, number> = {
      '2160p': 100,
      '4K': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };
    
    // Priority 1: behaviorHints.streamQuality (setado corretamente por stream)
    const bhQuality = stream.behaviorHints?.streamQuality;
    if (bhQuality && prioridadeQualidade[bhQuality] !== undefined) {
      return prioridadeQualidade[bhQuality];
    }
    
    // Fallback: extrai do titulo
    const qualidade = this.qualityDetector.extractBestQuality(stream.title || '');
    return prioridadeQualidade[qualidade] || 0;
  }

  // Sanitiza nome de arquivo
  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Método público mantendo compatibilidade (usa o novo formato internamente)
  async createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number,
    cachedNoDebrid: boolean = false
  ): Promise<Stream[]> {
    return await this.criarStreamsMultiplasQualidades(
      torrent,
      request,
      directLink,
      type,
      season,
      episode,
      isAvailableOnRD,
      fileIdx,
      cachedNoDebrid
    );
  }

  // Métodos públicos mantidos para compatibilidade
  async createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    return await this.criarStreamSerie(
      torrent,
      request,
      directLink,
      season,
      episode,
      isAvailableOnRD,
      fileIdx
    );
  }

  async createMovieStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    return await this.criarStreamFilme(
      torrent,
      request,
      directLink,
      isAvailableOnRD,
      fileIdx
    );
  }

  sortStreamsByQuality(streams: Stream[]): Stream[] {
    return this.ordenarStreamsPorQualidade(streams);
  }

  // Informações do formatter atualizado
  getStats() {
    return {
      versao: '2.2.0',
      feature: 'Formato StremThru-style com identidade Brasil RD',
      linha1: 'Titulo completo do torrent',
      linha2: '💾 tamanho 👤 seeds 🔍 tracker/provedor',
      linha3: '💿 qualidade 🎞️ codec 📺 HDR 🎧 audio 🌐 idioma 📅 data',
      name: '⚡️ [TB]/[TB]\\nBrasil RD\\n{qualidade} (estilo StremThru)',
      emojis: '💾 👤 🔍 💿 🎞️ 📺 🎧 🌐 📅 ⚡️ [TB]',
      compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100%'
    };
  }
}
