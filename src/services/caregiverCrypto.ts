import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import * as Crypto from 'expo-crypto';

// ---------------------------------------------------------------------------
// Cifra das mensagens trocadas entre o idoso e o cuidador.
//
// A push atravessa os servidores do Expo e do Google/Apple. O que vai VISÍVEL nela é genérico
// ("Novo aviso — toque para ver"); o conteúdo clínico — qual remédio, qual dose, e até o apelido
// do idoso — só existe aqui dentro, cifrado com a chave trocada no pareamento.
//
// POR QUE ESTÁ EM JS, E NÃO EM KOTLIN COMO ANTES
// A versão anterior usava AES-GCM do javax.crypto porque o aviso de "sem resposta" saía de um
// receiver nativo, com o app do idoso morto. A inversão do disparo eliminou esse envio: quem
// gera o alerta agora é o celular do CUIDADOR. O idoso só cifra quando alguém toca num botão —
// e aí o JS está vivo. Com isso a cifra pôde voltar para o JS, onde funciona no iPhone também.
//
// XChaCha20-Poly1305: nonce de 24 bytes, grande o bastante para ser sorteado ao acaso sem medo
// de repetir (com AES-GCM e 12 bytes, repetir o nonce com a mesma chave quebra tudo).
//
// A ALEATORIEDADE VEM DO SISTEMA. Não existe crypto.getRandomValues neste runtime — verificado.
// Math.random() aqui não seria um atalho, seria um buraco: nonce previsível anula a cifra.
// expo-crypto.getRandomBytes() usa o gerador do SO (SecureRandom no Android, SecRandom no iOS).
// ---------------------------------------------------------------------------

const NONCE_BYTES = 24;
const KEY_BYTES = 32;

// Base64 à mão. `btoa`/`atob` NÃO são garantidos neste runtime (verificado: não há polyfill no
// react-native nem no expo), e um `undefined` aqui quebraria a cifra silenciosamente em produção.
// Isto é codificação, não criptografia — implementar é seguro; o que nunca se implementa à mão é
// a cifra e o gerador aleatório.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function fromB64(b64: string): Uint8Array {
  const limpo = b64.replace(/=+$/, '');
  const out = new Uint8Array((limpo.length * 3) >> 2);
  let bits = 0, acc = 0, n = 0;
  for (const ch of limpo) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('base64 inválido');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

export function newSharedKey(): string {
  return toB64(Crypto.getRandomBytes(KEY_BYTES));
}

export function encrypt(plaintext: string, keyB64: string): string {
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(fromB64(keyB64), nonce);
  const sealed = cipher.encrypt(new TextEncoder().encode(plaintext));

  const out = new Uint8Array(nonce.length + sealed.length);
  out.set(nonce, 0);
  out.set(sealed, nonce.length);
  return toB64(out);
}

/** Estoura se a chave não bater — o Poly1305 detecta adulteração. Deixe estourar. */
export function decrypt(payloadB64: string, keyB64: string): string {
  const raw = fromB64(payloadB64);
  if (raw.length <= NONCE_BYTES) throw new Error('payload cifrado truncado');

  const cipher = xchacha20poly1305(fromB64(keyB64), raw.slice(0, NONCE_BYTES));
  return new TextDecoder().decode(cipher.decrypt(raw.slice(NONCE_BYTES)));
}
