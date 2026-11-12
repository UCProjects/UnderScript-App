export const iconLimit = 256 * 1024;

const signatures = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  ['image/x-icon', [0x00, 0x00, 0x01, 0x00]],
];

function imageType(data) {
  const found = signatures.find(([, bytes]) => bytes.every((byte, index) => data[index] === byte));
  if (found) return found[0];
  if (data.length > 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  const start = data.toString('utf8', 0, 512).trimStart();
  if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype[^>]*>\s*)?<svg[\s>]/i.test(start)) return 'image/svg+xml';
  return undefined;
}

export async function fetchIcon(value, { fetchImpl = (...args) => fetch(...args) } = {}) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:') return undefined;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'UnderScript-App' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 200) return undefined;
    if (res.url && new URL(res.url).protocol !== 'https:') return undefined;
    if (Number(res.headers.get('content-length')) > iconLimit) return undefined;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > iconLimit) return undefined;
    const type = imageType(data);
    return type ? { type, data } : undefined;
  } catch (e) {
    return undefined;
  }
}
