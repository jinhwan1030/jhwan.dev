import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export async function startRuntimeServer({
  databasePath,
  contentDirectory = 'src/content/blog',
  environment = {},
}) {
  const port = await availablePort();
  const child = spawn(process.execPath, ['./dist/server/entry.mjs'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      JHWAN_ADMIN_ENABLED: 'false',
      JHWAN_DATABASE_PATH: path.resolve(databasePath),
      JHWAN_MEDIA_PATH: path.resolve(path.dirname(databasePath), 'uploads'),
      JHWAN_CONTENT_SEED_PATH: path.resolve(contentDirectory),
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Runtime server exited early:\n${output}`);
    try {
      const response = await fetch(`${origin}/blog/`);
      if (response.ok) {
        return {
          origin,
          output: () => output,
          async stop() {
            if (child.exitCode !== null) return;
            child.kill('SIGTERM');
            await Promise.race([
              new Promise((resolve) => child.once('exit', resolve)),
              new Promise((resolve) => setTimeout(resolve, 3_000)),
            ]);
            if (child.exitCode === null) child.kill('SIGKILL');
          },
        };
      }
    } catch {
      // The server can reject connections briefly while its entrypoint initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`Runtime server did not become ready:\n${output}`);
}
