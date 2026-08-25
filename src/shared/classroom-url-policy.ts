function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
}

export function isPublicClassroomHostname(hostname: string): boolean {
  const value = normalizedHostname(hostname);
  if (
    value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') ||
    value.endsWith('.internal') || value.endsWith('.lan') || value === 'host.docker.internal' ||
    value === '0.0.0.0' || value === '::1' || value === '::' || value.startsWith('::ffff:') ||
    value.startsWith('fc') || value.startsWith('fd') || /^(?:fe[89ab]|ff)/u.test(value)
  ) return false;
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = 0, second = 0] = octets;
  return !(
    first === 0 || first === 10 || first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) || first >= 224
  );
}

export function validateClassroomUrl(value: string, expectedOrigin?: string): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (
    url.protocol !== 'https:' || url.username || url.password ||
    !isPublicClassroomHostname(url.hostname) ||
    (expectedOrigin !== undefined && url.origin !== expectedOrigin)
  ) return null;
  return url;
}
