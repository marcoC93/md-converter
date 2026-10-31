import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.js';

const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '::1'];
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Estrae il nome host da un header `Host` (`localhost:8080`, `[::1]:8080`, `127.0.0.1`). */
export function hostnameFromHostHeader(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(1, end);
  }
  const colon = value.lastIndexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

export function isAllowedHost(hostHeader: string | undefined, extraHosts: string[]): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameFromHostHeader(hostHeader);
  return LOOPBACK_HOSTNAMES.includes(hostname) || extraHosts.includes(hostname);
}

/** L'origine è accettata solo se coincide con l'host a cui il browser sta parlando. */
export function isSameOrigin(originHeader: string, hostHeader: string): boolean {
  try {
    const origin = new URL(originHeader);
    return origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Protegge da due attacchi tipici dei servizi su localhost:
 * - DNS rebinding: un dominio esterno che risolve in 127.0.0.1 arriva con un `Host` estraneo;
 * - CSRF: una pagina di un altro sito invia richieste al servizio locale tramite il browser.
 */
export function registerRequestGuard(app: FastifyInstance, extraHosts: string[]): void {
  app.addHook('onRequest', async (request) => {
    const host = request.headers.host;
    if (!isAllowedHost(host, extraHosts)) {
      throw new AppError('FORBIDDEN_REQUEST', 'Host non consentito.');
    }

    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite === 'cross-site') {
      throw new AppError('FORBIDDEN_REQUEST', 'Richiesta proveniente da un altro sito.');
    }

    const origin = request.headers.origin;
    if (STATE_CHANGING_METHODS.includes(request.method) && origin !== undefined) {
      if (!host || !isSameOrigin(origin, host)) {
        throw new AppError('FORBIDDEN_REQUEST', 'Origine della richiesta non consentita.');
      }
    }
  });
}
