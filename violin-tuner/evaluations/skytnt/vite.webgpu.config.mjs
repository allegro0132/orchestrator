import { defineConfig } from 'vite';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const modelDir = process.env.SKY_W4A16_DIR || '/tmp/arco-skytnt-w4a16';
const allowed = new Set([
  'manifest.json',
  'model_base.w4a16.onnx',
  'model_token.w4a16.onnx',
  'model_base.w16a16.onnx',
  'model_token.w16a16.onnx',
]);
export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  server: { host: '127.0.0.1', port: 5181 },
  plugins: [
    {
      name: 'local-skytnt-models',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url, 'http://localhost');
          if (url.pathname === '/skytnt-report' && request.method === 'POST') {
            if (
              request.headers.origin !== `http://${request.headers.host}` ||
              request.headers['content-type'] !== 'application/json'
            ) {
              response.statusCode = 403;
              response.end();
              return;
            }
            let body = '';
            request.on('data', (chunk) => {
              body += chunk;
              if (body.length > 2000000) request.destroy();
            });
            request.on('end', () => {
              try {
                const result = JSON.parse(body);
                if (
                  result.type !== 'done' ||
                  !/^skytnt-tv2o-medium-w(?:4|16)a16-[a-z0-9-]+$/.test(result.manifest?.id || '')
                )
                  throw Error('invalid');
                writeFileSync(
                  join(modelDir, `webgpu-report-${result.manifest.id}.json`),
                  JSON.stringify(result, null, 2),
                );
                response.end('saved');
              } catch {
                response.statusCode = 400;
                response.end();
              }
            });
            return;
          }
          if (!url.pathname.startsWith('/skytnt-model/')) return next();
          const name = url.pathname.slice('/skytnt-model/'.length);
          if (!allowed.has(name) || !existsSync(join(modelDir, name))) {
            response.statusCode = 404;
            response.end('Model not found');
            return;
          }
          response.setHeader(
            'Content-Type',
            name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
          );
          response.setHeader('Content-Length', statSync(join(modelDir, name)).size);
          response.setHeader('Cache-Control', 'no-store');
          const stream = createReadStream(join(modelDir, name));
          response.on('close', () => stream.destroy());
          stream.on('error', () => response.destroy());
          stream.pipe(response);
        });
      },
    },
  ],
});
