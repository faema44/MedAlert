import { scryptAsync } from '@noble/hashes/scrypt.js';
import * as Crypto from 'expo-crypto';
import { encrypt, decrypt, toB64, fromB64 } from './caregiverCrypto';

// ---------------------------------------------------------------------------
// Backup cifrado com senha.
//
// O backup em claro era o prontuário inteiro (remédios, histórico, perfil) num JSON que o
// destino típico é o Drive ou o WhatsApp de alguém. Cifrar com senha fecha esse buraco: o
// arquivo pode vazar que ninguém abre sem a senha.
//
// A cifra é a MESMA do cuidador (XChaCha20-Poly1305, caregiverCrypto) — o que muda é de onde
// vem a chave: derivada da senha por scrypt, que é caro de propósito. Testar senhas contra o
// arquivo custa ~1s por tentativa NO CELULAR; numa GPU também não é barato, porque o scrypt
// exige os 32 MiB de memória por tentativa (N=2^15, r=8). É o que dá para fazer contra senha
// fraca — o resto é pedir uma senha que preste.
//
// scryptAsync, não scrypt: a versão síncrona travaria o JS thread por segundos e o modal de
// "cifrando..." congelaria junto. A async cede o loop a cada bloco (onProgress interno).
//
// SENHA ERRADA = Poly1305 estoura em decrypt(). Não há "abriu com lixo dentro": ou a senha
// bate e o JSON volta íntegro, ou lança erro. O import trata esse erro como "senha incorreta".
// ---------------------------------------------------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 };
const SALT_BYTES = 16;

type Envelope = {
  medalert_encrypted: 1;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'xchacha20poly1305';
  payload: string;
};

// A senha passa por trim(): espaço invisível no fim (autocomplete de teclado faz isso) criaria
// um backup que a "mesma" senha digitada depois não abre — irrecuperável por definição.
async function derivarChave(senha: string, salt: Uint8Array, N: number, r: number, p: number): Promise<string> {
  const key = await scryptAsync(new TextEncoder().encode(senha.trim()), salt, { N, r, p, dkLen: SCRYPT.dkLen });
  return toB64(key);
}

export async function encryptBackup(json: string, senha: string): Promise<string> {
  const salt = Crypto.getRandomBytes(SALT_BYTES);
  const keyB64 = await derivarChave(senha, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const env: Envelope = {
    medalert_encrypted: 1,
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: toB64(salt) },
    cipher: 'xchacha20poly1305',
    payload: encrypt(json, keyB64),
  };
  return JSON.stringify(env);
}

/** Reconhece o envelope sem tentar decifrar — é como o import decide se pede senha. */
export function isEncryptedBackup(json: string): boolean {
  try { return JSON.parse(json)?.medalert_encrypted === 1; } catch { return false; }
}

/** Estoura com senha errada ou arquivo adulterado. Quem chama mostra "senha incorreta". */
export async function decryptBackup(envelopeJson: string, senha: string): Promise<string> {
  const env = JSON.parse(envelopeJson) as Envelope;
  if (env?.medalert_encrypted !== 1 || env.kdf?.name !== 'scrypt') {
    throw new Error('Formato de backup cifrado inválido');
  }
  // Os parâmetros vêm do ARQUIVO (não das constantes): um backup feito por uma versão futura
  // com custo maior continua abrindo aqui. Com teto, senão um arquivo forjado com N gigante
  // viraria travamento do app ao "abrir".
  const { N, r, p } = env.kdf;
  if (!(N >= 2 ** 14 && N <= 2 ** 17) || r !== 8 || p !== 1) {
    throw new Error('Parâmetros de cifra fora do esperado');
  }
  const keyB64 = await derivarChave(senha, fromB64(env.kdf.salt), N, r, p);
  return decrypt(env.payload, keyB64);
}
