// Criptografia da URL de manifest/stream (AES-256-GCM)
// Empacota { apiKey, p2p } num token opaco em vez de expor a API key em texto plano na URL.

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.CONFIG_SECRET || process.env.ENCRYPTION_KEY || 'brasil-rd-troque-este-segredo-no-env';
  return crypto.createHash('sha256').update(secret).digest();
}

export interface ConfigPayload {
  apiKey: string;
  p2p?: boolean;
}

/** Gera token opaco (base64url) contendo a config criptografada. */
export function encryptConfig(payload: ConfigPayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

/** Decripta o token de volta para a config original. Retorna null se inválido/adulterado. */
export function decryptConfig(token: string): ConfigPayload | null {
  try {
    const packed = Buffer.from(token, 'base64url');
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const enc = packed.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    const parsed = JSON.parse(dec.toString('utf8'));
    if (!parsed || typeof parsed.apiKey !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
