import type { FastifyInstance } from 'fastify';

/**
 * La CSP permette solo risorse servite da questa stessa origine: niente CDN, font esterni o
 * script inline. `data:` e `blob:` per le immagini servono all'anteprima dei file nel browser.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.headers(SECURITY_HEADERS);
    reply.header('X-Correlation-Id', request.id);
    if (request.url.startsWith('/api/')) {
      // Le risposte API contengono stato dei documenti: non devono finire nella cache del browser.
      reply.header('Cache-Control', 'no-store');
    }
  });
}
