// Web: same sources as the phone, fetched through the server's image proxy (favicons send no CORS
// headers); the browser HTTP cache keeps the bytes, storage only remembers which source answered.
import { storage } from '@/storage';
import { organizationDomain } from '@/utils/addresses';

import { BIMI_SOURCE, avatarSources } from './avatarSources';

const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const DNS_RESOLVER = 'https://cloudflare-dns.com/dns-query';
const TXT = 16;

interface Entry {
  uri: string | null;
  expiresAt: number;
}

const resolved = new Map<string, Entry>();
const pending = new Map<string, Promise<string | null>>();
const storageKey = (address: string) => `avatar-web:${address}`;
const proxied = (url: string) => `/api/image?url=${encodeURIComponent(url)}`;

export function cachedAvatar(email: string): string | null | undefined {
  const address = email.trim().toLowerCase();
  let entry = resolved.get(address);
  if (!entry) {
    const saved = storage.getString(storageKey(address));
    if (!saved) return undefined;
    entry = JSON.parse(saved) as Entry;
    resolved.set(address, entry);
  }
  return Date.now() > entry.expiresAt ? undefined : entry.uri;
}

export function loadAvatar(email: string): Promise<string | null> {
  const address = email.trim().toLowerCase();
  const cached = cachedAvatar(address);
  if (cached !== undefined) return Promise.resolve(cached);
  let request = pending.get(address);
  if (!request) {
    request = lookUp(address).finally(() => pending.delete(address));
    pending.set(address, request);
  }
  return request;
}

async function lookUp(address: string): Promise<string | null> {
  for (const source of avatarSources(address)) {
    const url = source.startsWith(BIMI_SOURCE) ? await bimiLogo(source.slice(BIMI_SOURCE.length)) : source;
    if (url && (await fetch(proxied(url)).then((response) => response.ok, () => false))) return remember(address, proxied(url));
  }
  return remember(address, null);
}

function remember(address: string, uri: string | null): string | null {
  const entry = { uri, expiresAt: Date.now() + RECHECK_AFTER_MS };
  resolved.set(address, entry);
  storage.set(storageKey(address), JSON.stringify(entry));
  return uri;
}

async function bimiLogo(domain: string): Promise<string | null> {
  const organization = organizationDomain(domain);
  return (await bimiLocation(domain)) ?? (organization !== domain ? await bimiLocation(organization) : null);
}

async function bimiLocation(domain: string): Promise<string | null> {
  try {
    const response = await fetch(`${DNS_RESOLVER}?name=default._bimi.${encodeURIComponent(domain)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
    });
    if (!response.ok) return null;
    const { Answer = [] } = (await response.json()) as { Answer?: { type: number; data: string }[] };
    return bimiLogoLocation(Answer.filter((entry) => entry.type === TXT).map((entry) => entry.data));
  } catch {
    return null;
  }
}

export function bimiLogoLocation(records: string[]): string | null {
  for (const data of records) {
    const text = (data.match(/"((?:[^"\\]|\\.)*)"/g) ?? [data]).map((part) => part.replace(/^"|"$/g, '')).join('');
    const tags = new Map(
      text
        .split(';')
        .map((tag) => tag.trim().split('='))
        .filter(([name]) => name)
        .map(([name, ...value]) => [name.trim().toLowerCase(), value.join('=').trim()] as const),
    );
    const location = tags.get('l');
    if (tags.get('v')?.toUpperCase() === 'BIMI1' && location?.startsWith('https://')) return location;
  }
  return null;
}
