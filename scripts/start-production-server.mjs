process.env.ASTRO_NODE_AUTOSTART = 'disabled';

const entryUrl = new URL('../dist/server/entry.mjs', import.meta.url);
const { startServer } = await import(entryUrl);
const runtime = startServer();
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
    await runtime.server.stop();
    await runtime.done;
    clearTimeout(forceExit);
  } catch (error) {
    clearTimeout(forceExit);
    console.error('Homepage server shutdown failed', error);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => { void stop('SIGTERM'); });
process.once('SIGINT', () => { void stop('SIGINT'); });

await runtime.done;
