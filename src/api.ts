// In-memory session token management (never persisted to localStorage)
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) msg = errData.error;
    } catch {
      // ignore non-json error body
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function apiDownload(
  url: string,
  options: RequestInit = {},
  fallbackFilename = 'download'
): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (!(options.body instanceof FormData) && options.method === 'POST' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) msg = errData.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/.exec(disp);
  const filename = match ? match[1] : fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
  return { blob, filename };
}
