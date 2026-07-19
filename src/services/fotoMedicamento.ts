import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { File, Paths, Directory } from 'expo-file-system';

// ---------------------------------------------------------------------------
// Foto do medicamento — para reconhecer o comprimido na hora de tomar.
//
// O problema real: quem toma seis remédios tem três comprimidos brancos e redondos na
// gaveta. O nome na tela não resolve isso; a foto do que está na cartela, sim.
//
// POR QUE REDIMENSIONAR (e não só comprimir): o image-picker comprime mas não muda as
// dimensões — uma foto de 12MP vira ~800 KB mesmo em qualidade baixa. A 600px ela cai para
// ~40 KB, e é isso que permite a foto CABER NO BACKUP (ver fotoParaBase64). Sem isso, a
// pessoa troca de celular, restaura, os remédios voltam e as fotos somem em silêncio.
//
// 600px é de sobra para reconhecer um comprimido: o cartão da Home mostra ~80px.
// ---------------------------------------------------------------------------

const LADO_MAX = 600;
const QUALIDADE = 0.7;
const PASTA = 'fotos_med';

function pasta(): Directory {
  const d = new Directory(Paths.document, PASTA);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** Nome estável por medicamento: refotografar substitui, não acumula lixo. */
function arquivoDe(medId: number): File {
  return new File(pasta(), `med_${medId}.jpg`);
}

async function reduzirESalvar(uri: string, medId: number): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: LADO_MAX } }],
    { compress: QUALIDADE, format: ImageManipulator.SaveFormat.JPEG },
  );
  const destino = arquivoDe(medId);
  if (destino.exists) destino.delete();
  // `move` é ASSÍNCRONO (Promise<void>) — sem await, a função devolvia o caminho ANTES de o
  // arquivo chegar lá, e o preview ficava com "arquivo não existe". E é o objeto de ORIGEM
  // que passa a apontar para o destino, não o `destino` que passamos: por isso o uri sai de
  // `origem`, não de `destino`.
  const origem = new File(out.uri);
  await origem.move(destino);
  return origem.uri;
}

/** Câmera. Devolve o caminho salvo, ou null se a pessoa desistiu ou negou a permissão. */
export async function tirarFoto(medId: number): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: true,   // recorte quadrado: enquadra o comprimido e já reduz o arquivo
    aspect: [1, 1],
    quality: 1,            // qualidade cai no manipulateAsync, não aqui — recomprimir 2x borra
  });
  if (r.canceled || !r.assets?.length) return null;
  return reduzirESalvar(r.assets[0].uri, medId);
}

/** Galeria — para quem já fotografou a caixa antes, ou tem foto da receita. */
export async function escolherFoto(medId: number): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (r.canceled || !r.assets?.length) return null;
  return reduzirESalvar(r.assets[0].uri, medId);
}

/**
 * Move a foto para o nome definitivo depois que o medicamento ganha id.
 *
 * Cadastro novo fotografa antes de existir id, então o arquivo nasce com um provisório
 * negativo. Sem consolidar, uma troca de foto mais tarde criaria `med_{id}.jpg` e deixaria o
 * `med_-123.jpg` para trás — 40 KB órfãos por vez, num app que a pessoa usa por anos.
 */
export async function consolidarFoto(medIdReal: number, uri: string | null | undefined): Promise<string | null> {
  if (!temFoto(uri)) return null;
  const destino = arquivoDe(medIdReal);
  if (uri === destino.uri) return uri as string;
  try {
    if (destino.exists) destino.delete();
    const origem = new File(uri as string);
    await origem.move(destino);   // assíncrono — ver reduzirESalvar
    return origem.uri;
  } catch {
    return uri as string;  // falhou o move: o caminho antigo ainda é válido, não perde a foto
  }
}

export function apagarFoto(medId: number): void {
  const f = arquivoDe(medId);
  if (f.exists) f.delete();
}

/**
 * A foto existe MESMO? O caminho fica no banco, mas o arquivo mora no sandbox do app —
 * restaurar um backup de outro celular traz o caminho sem o arquivo, e um <Image> apontando
 * para o nada aparece como quadrado quebrado. Quem pergunta antes mostra o ícone de sempre.
 */
export function temFoto(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try { return new File(uri).exists; } catch { return false; }
}

// --- backup ---------------------------------------------------------------
// O backup é JSON puro; foto é arquivo. Sem estas duas, restaurar traria os remédios SEM as
// fotos, calado. A 600px cada uma tem ~40 KB, então 20 remédios acrescentam ~1 MB ao arquivo
// — que continua indo por WhatsApp.

export function fotoParaBase64(uri: string | null | undefined): string | null {
  if (!temFoto(uri)) return null;
  // base64Sync e não base64(): o exportBackup monta um objeto grande de uma vez, e uma
  // promessa aqui obrigaria a espalhar async por todo o caminho do backup por causa de um
  // arquivo de 40 KB.
  try { return new File(uri as string).base64Sync(); } catch { return null; }
}

/** Devolve o caminho do arquivo recriado, ou null se o backup não tinha foto para este. */
export function base64ParaFoto(medId: number, b64: string | null | undefined): string | null {
  if (!b64) return null;
  try {
    const destino = arquivoDe(medId);
    if (destino.exists) destino.delete();
    destino.create();
    destino.write(b64, { encoding: 'base64' });
    return destino.uri;
  } catch {
    return null;
  }
}
