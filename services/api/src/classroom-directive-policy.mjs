import { isIP } from 'node:net';

function normalizedHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
}

export function isPublicHostname(hostname) {
  const value = normalizedHostname(hostname);
  if (
    value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') ||
    value.endsWith('.internal') || value.endsWith('.lan') || value === 'host.docker.internal' ||
    value === '0.0.0.0' || value === '::1' || value === '::' || value.startsWith('::ffff:') ||
    value.startsWith('fc') || value.startsWith('fd') || /^(?:fe[89ab]|ff)/u.test(value)
  ) return false;
  if (isIP(value) === 6) return true;
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = octets;
  return !(
    first === 0 || first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function parsePublicHttpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !isPublicHostname(url.hostname)) return null;
  return url;
}

export function directiveDelivery(directive, allowedOrigins = []) {
  if (directive.kind !== 'open_url') return { delivery: 'manual_only', origin: null };
  const url = parsePublicHttpsUrl(directive.url);
  if (!url) {
    const error = new Error('Use a public HTTPS URL without embedded credentials.');
    error.status = 400;
    error.code = 'directive_url_invalid';
    throw error;
  }
  const normalizedOrigins = new Set(allowedOrigins.map((origin) => new URL(origin).origin));
  return {
    delivery: normalizedOrigins.has(url.origin) ? 'auto_eligible' : 'manual_only',
    origin: url.origin,
    url: url.toString(),
  };
}
