async function adminFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) {
    window.dispatchEvent(new Event('rf:unauthorized'));
  }
  return res;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  environment: string;
  createdAt: string;
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const res = await adminFetch('/admin/api-keys');
  if (!res.ok) throw new Error('Failed to fetch API keys');
  return res.json() as Promise<ApiKey[]>;
}

export async function createApiKey(name: string, environment: string): Promise<ApiKey> {
  const res = await adminFetch('/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, environment }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create API key');
  }
  return res.json() as Promise<ApiKey>;
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await adminFetch(`/admin/api-keys/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete API key');
}
