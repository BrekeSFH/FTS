/** Arranque del servidor de lobby. */
import { DEFAULT_PORT, createServer } from './createServer';
import { openStash } from './stash';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
/** Archivo de los alijos. Relativo a donde se arranca, `server/` con npm. */
const dbPath = process.env.FTS_DB ?? 'data/fts.sqlite';
await createServer({ stash: openStash(dbPath) }).listen(port);
console.log(`Lobby escuchando en ws://localhost:${port} · alijos en ${dbPath}`);
