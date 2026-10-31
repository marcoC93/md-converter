// Health check del container: usa Node invece di curl, così non serve installare altri pacchetti.
const port = process.env.PORT ?? '8080';

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
