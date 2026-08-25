import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import {
  MAX_REQUEST_BODY_BYTES,
  SECURITY_HEADERS,
} from '../src/lib/server/security-headers.js';

process.env.ASTRO_NODE_AUTOSTART = 'disabled';

const entryUrl = new URL('../dist/server/entry.mjs', import.meta.url);
const { handler, options } = await import(entryUrl);
const port = Number(process.env.PORT ?? options.port ?? 8080);
const configuredHost = process.env.HOST ?? options.host;
const host = typeof configuredHost === 'boolean'
  ? (configuredHost ? '0.0.0.0' : 'localhost')
  : (configuredHost ?? 'localhost');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid homepage server port: ${process.env.PORT ?? options.port}`);
}
if (options.bodySizeLimit !== MAX_REQUEST_BODY_BYTES) {
  throw new Error(`Unexpected homepage request body limit: ${options.bodySizeLimit}`);
}

const listener = (request, response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  handler(request, response);
};
const server = process.env.SERVER_CERT_PATH && process.env.SERVER_KEY_PATH
  ? https.createServer({
      key: fs.readFileSync(process.env.SERVER_KEY_PATH),
      cert: fs.readFileSync(process.env.SERVER_CERT_PATH),
    }, listener)
  : http.createServer(listener);
const done = new Promise((resolve, reject) => {
  server.once('close', resolve);
  server.once('error', reject);
});

server.listen(port, host, () => {
  console.log(`jhwan.dev server listening on ${host}:${port}`);
});
let stopping = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; closing the homepage server`);

  const forceExit = setTimeout(() => {
    console.error('Homepage server did not close within 5 seconds');
    process.exit(1);
  }, 5_000);

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await done;
    clearTimeout(forceExit);
  } catch (error) {
    clearTimeout(forceExit);
    console.error('Homepage server shutdown failed', error);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => { void stop('SIGTERM'); });
process.once('SIGINT', () => { void stop('SIGINT'); });

await done;
