/**
 * Decodifica sprites de una instalación real de Fallout Tactics.
 * Se saltea si FT_CORE no apunta a la carpeta `core` del juego.
 */
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import { BlobReader, Uint8ArrayWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { countSpriteImages, decodeSpriteFrame, isSprite, readSpriteAnimations } from '../src/sprites/sprite';

const CORE = process.env.FT_CORE ?? '';

/** `spr-sprites_0` da la mayor variedad por byte leído; `spr-extra_0` trae la variante comprimida. */
const ARCHIVES = ['spr-sprites_0.bos', 'spr-extra_0.bos', 'spr-missspec_A.bos', 'spr-critter_0.bos'];

describe('sprites reales', () => {
  it.runIf(CORE)('decodifica el primer frame de cada animación', async () => {
    const problems: string[] = [];
    const versions = new Map<string, number>();
    let sprites = 0;
    let animations = 0;
    let frames = 0;

    for (const archive of ARCHIVES) {
      const blob = await openAsBlob(join(CORE, archive));
      const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
      const entries = (await reader.getEntries()).filter(
        (e): e is FileEntry => !e.directory && e.filename.toLowerCase().endsWith('.spr'),
      );

      for (const entry of entries) {
        const bytes = await entry.getData(new Uint8ArrayWriter());
        if (!isSprite(bytes)) {
          problems.push(`${entry.filename}: no tiene firma <sprite>`);
          continue;
        }
        sprites++;
        try {
          const anims = readSpriteAnimations(bytes);
          animations += anims.length;
          for (let a = 0; a < anims.length; a++) {
            const version = String.fromCharCode(bytes[anims[a].dataOffset + 2]);
            versions.set(version, (versions.get(version) ?? 0) + 1);

            const frame = await decodeSpriteFrame(bytes, a, 0);
            frames++;
            // Las dos invariantes que valen: llenar la imagen y consumir los
            // bytes justos. La segunda es la que detecta un offset corrido.
            if (frame.pixelsWritten !== frame.width * frame.height) {
              problems.push(
                `${entry.filename} [${anims[a].name}]: ${frame.pixelsWritten} de ${frame.width * frame.height} píxeles`,
              );
            }
            if (frame.bytesConsumed !== frame.declaredDataSize) {
              problems.push(
                `${entry.filename} [${anims[a].name}]: consumió ${frame.bytesConsumed} de ${frame.declaredDataSize} bytes`,
              );
            }
            // El rectángulo tiene que contener a su imagen. Es lo que
            // confirma que la tabla quedó alineada: desalineada daría valores
            // disparatados. Se admite un píxel de margen porque unas pocas
            // imágenes lo declaran justo al revés, y rectángulos más grandes
            // porque en los sprites animados la imagen viene recortada a su
            // contenido mientras el rectángulo conserva la caja original.
            if (frame.rect && frame.width > 0) {
              const rw = frame.rect.right - frame.rect.left;
              const rh = frame.rect.bottom - frame.rect.top;
              if (rw < frame.width - 1 || rh < frame.height - 1) {
                problems.push(
                  `${entry.filename} [${anims[a].name}]: rect de ${rw}×${rh}` +
                    ` para una imagen de ${frame.width}×${frame.height}`,
                );
              }
            }
          }
        } catch (err) {
          problems.push(`${entry.filename}: ${(err as Error).message}`);
        }
      }
      await reader.close();
    }

    expect(problems.slice(0, 10)).toEqual([]);
    const porVersion = [...versions].map(([v, n]) => `'${v}'×${n}`).join(' ');
    console.log(
      `\n${sprites} sprites, ${animations} animaciones, ${frames} frames decodificados` +
        `\n  versiones de <anim_img>: ${porVersion}\n`,
    );
  }, 900_000);

  it.runIf(CORE)('recorre todas las imágenes de animaciones con varias direcciones', async () => {
    // El primer test solo pide la imagen 0 de cada animación. Este ejercita el
    // salto de una imagen a la siguiente, que es donde pega la tabla de
    // rectángulos: tiene una entrada por dirección y por frame, no solo por frame.
    const blob = await openAsBlob(join(CORE, 'spr-sprites_0.bos'));
    const reader = new ZipReader(new BlobReader(blob as unknown as Blob), { useWebWorkers: false });
    const entries = (await reader.getEntries()).filter(
      (e): e is FileEntry => !e.directory && e.filename.toLowerCase().startsWith('sprites/vehicles/'),
    );
    expect(entries.length).toBeGreaterThan(0);

    const problems: string[] = [];
    let images = 0;
    let multiDirection = 0;

    for (const entry of entries) {
      const bytes = await entry.getData(new Uint8ArrayWriter());
      const anims = readSpriteAnimations(bytes);
      for (let a = 0; a < anims.length; a++) {
        if (anims[a].directions > 1) multiDirection++;
        const stored = await countSpriteImages(bytes, a);
        if (stored > anims[a].imageCount) {
          problems.push(`${entry.filename} [${anims[a].name}]: guarda ${stored} y declara ${anims[a].imageCount}`);
        }
        for (let i = 0; i < stored; i++) {
          const frame = await decodeSpriteFrame(bytes, a, i);
          images++;
          // Una imagen vacía es válida; si trae datos, tienen que cerrar.
          if (frame.width === 0) continue;
          if (frame.pixelsWritten !== frame.width * frame.height) {
            problems.push(`${entry.filename} [${anims[a].name} #${i}]: ${frame.pixelsWritten} píxeles`);
          }
          if (frame.bytesConsumed !== frame.declaredDataSize) {
            problems.push(`${entry.filename} [${anims[a].name} #${i}]: ${frame.bytesConsumed} de ${frame.declaredDataSize} bytes`);
          }
        }
      }
    }
    await reader.close();

    expect(problems.slice(0, 10)).toEqual([]);
    expect(multiDirection).toBeGreaterThan(0);
    console.log(`
${entries.length} vehículos, ${images} imágenes, ${multiDirection} animaciones con varias direcciones
`);
  }, 900_000);
});
