let uiToken: string | null = null;

async function getToken(): Promise<string> {
  if (uiToken) return uiToken;
  const res = await fetch('/admin/ui-token');
  if (!res.ok) throw new Error('Failed to fetch UI token');
  const data = await res.json() as { key: string };
  uiToken = data.key;
  return uiToken;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
}
