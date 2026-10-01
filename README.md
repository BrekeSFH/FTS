# FTS

> Nombre en clave provisorio. El nombre final no usará marcas registradas de terceros.

Extraction RPG isométrico multijugador (PvE / PvPvE) que corre en el navegador, con modelo **BYOG (Bring Your Own Game)**: el jugador aporta los archivos `.BOS` de su propia instalación de Fallout Tactics y el cliente extrae los assets localmente. El servidor nunca aloja assets protegidos.

## Documentación

- [Documento de Diseño (GDD) v2](docs/GDD.md)

## Stack previsto

- **Cliente:** TypeScript, File System Access API (con fallback a `<input type="file">`), IndexedDB, Pixi.js o Phaser.
- **Servidor:** Node.js + Colyseus, autoritativo y headless.
- **Red:** WebSockets (estado) y WebRTC (voz por proximidad).

## Hitos

- [x] **Hito 1:** Lector de archivos `.BOS` en el navegador (verificar firma ZIP, listar entradas, descompresión bajo demanda).
- [x] **Hito 2:** Decodificador de sprites (`.SPR` / `.ZAR` / `.TIL`) y render de un frame en Canvas 2D.
- [ ] **Hito 3:** Servidor Colyseus con lobby básico sincronizado entre dos navegadores.

## Cliente: explorador BOS (Hito 1)

```bash
cd client
npm install
npm run dev      # abre http://localhost:5173
npm test         # tests unitarios (vitest)
npm run build    # typecheck + build de producción
```

Para verificar contra una instalación real, apuntá `FT_CORE` a la carpeta `core` del juego;
sin esa variable el test de integración se saltea:

```bash
FT_CORE="C:/Program Files (x86)/Steam/steamapps/common/Fallout Tactics/core" npm test
```

Abrí un `.BOS` de tu instalación. El cliente verifica la firma ZIP (`PK\x03\x04`, o el EOCD si el ZIP tiene datos antepuestos), lista las entradas leyendo solo el directorio central y descomprime cada entrada bajo demanda (vista previa o descarga). Si el archivo no es ZIP, muestra los primeros bytes en hexadecimal para diagnosticar el formato.

Código relevante:

- `client/src/bos/signature.ts`: detección del formato.
- `client/src/bos/archive.ts`: `BosArchive`, lectura con acceso aleatorio sobre [zip.js](https://gildas-lormeau.github.io/zip.js/).
- `client/src/bos/filePicker.ts`: File System Access API con fallback a `<input type="file">`.

## Cliente: decodificadores de imagen (Hito 2)

La vista previa del explorador reconoce los tres formatos de imagen del juego y los dibuja en un `<canvas>`; lo que no reconoce sigue cayendo al volcado hexadecimal.

Ninguno de los tres está documentado públicamente: la disposición se dedujo por ingeniería inversa sobre los archivos de una instalación real y quedó escrita en el encabezado de cada módulo, junto con los campos que siguen sin identificar.

| Formato | Qué es | Módulo |
|---|---|---|
| `.ZAR` | Imagen suelta: paleta de 256 colores y datos RLE | `client/src/sprites/zar.ts` |
| `.TIL` | Envoltorio `<tile>` con uno o más ZAR; es el terreno isométrico | `client/src/sprites/tile.ts` |
| `.SPR` | Contenedor de animaciones con nombre; sus imágenes son ZAR sin paleta propia, a veces comprimidas con zlib | `client/src/sprites/sprite.ts` |

El RLE es común a los tres. Cada byte de control codifica una cantidad en sus 6 bits altos y un tipo en los 2 bajos: saltear píxeles transparentes, índices de paleta opacos, pares de índice y alpha, o una tira de alphas sobre el color 0.

- `client/src/sprites/canvas.ts`: puente entre los decodificadores y el `<canvas>`.

Los tests de integración recorren la instalación entera: los 839 `.ZAR` de `gui_0.bos`, los 29.957 `.TIL` de `tiles_0.bos` y 1592 animaciones de sprites. Cada imagen tiene que llenar su alto por ancho **y** consumir exactamente los bytes que declara; lo segundo es lo que detecta un offset corrido, que de otro modo también llena la imagen pero la dibuja desplazada.

## Aviso legal

Este proyecto no incluye ni distribuye ningún asset de Fallout Tactics. Se requiere una copia legítima del juego.
