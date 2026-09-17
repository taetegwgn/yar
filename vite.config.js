import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { createRoomHandler } from './server/rooms.js';
import { localStore } from './server/local-store.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GEMINI_');
  const handler = createRoomHandler(localStore(resolve('.local-rooms')), { apiKey: process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '' });
  return {
    plugins: [{
      name: 'shared-room-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/rooms')) return next();
          try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 8192) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '요청이 너무 큽니다.' })); return; }
              chunks.push(chunk);
            }
            const request = new Request(`http://${req.headers.host}${req.url}`, {
              method: req.method, headers: req.headers,
              ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) })
            });
            const response = await handler(request);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '개발 서버 요청에 실패했습니다.' }));
          }
        });
      }
    }]
  };
});
