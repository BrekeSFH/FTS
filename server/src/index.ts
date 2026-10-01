/** Arranque del servidor de lobby. */
import { DEFAULT_PORT, createServer } from './createServer';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
await createServer().listen(port);
console.log(`Lobby escuchando en ws://localhost:${port}`);
