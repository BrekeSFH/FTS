/**
 * Inflado de flujos zlib incrustados en otros formatos.
 *
 * Tanto los `.SPR` como los `.mis` guardan un bloque comprimido del que no se
 * declara el largo comprimido, solo el que tiene que salir. Hay que leer
 * hasta juntar esa cantidad y cortar ahí: dejar que el stream siga hasta el
 * final del buffer lo hace fallar por los bytes que vienen después.
 */

/**
 * Infla `data` hasta obtener exactamente `expected` bytes.
 *
 * Que la cuenta dé justo es el control: si el offset del bloque estuviera
 * mal, el inflado fallaría o daría de menos, y vale más enterarse acá que
 * dibujar basura más adelante.
 */
export async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const out = new Uint8Array(expected);
  let filled = 0;
  try {
    while (filled < expected) {
      const { value, done } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, expected - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (filled !== expected) {
    throw new Error(`El flujo comprimido dio ${filled} bytes y declaraba ${expected}`);
  }
  return out;
}
