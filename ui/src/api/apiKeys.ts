async function adminFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) window.dispatchEvent(new Event('rf:unauthorized'));
  return res;
}

export interface ApiKey {
  id: string;
  projectId: string;
  key: string;
  name: string;
  environment: string;
  createdAt: string;
}

export async function getApiKeys(projectId: string): Promise<ApiKey[]> {
  const res = await adminFetch(`/admin/api-keys?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error('Failed to fetch API keys');
  return res.json() as Promise<ApiKey[]>;
}

export async function createApiKey(name: string, environment: string, projectId: string): Promise<ApiKey> {
  const res = await adminFetch('/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, environment, projectId }),
  });
  if (!res.ok) {
    let message = 'Failed to create API key';
    try {
      const err = await res.json() as { error: string };
      message = err.error ?? message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  return res.json() as Promise<ApiKey>;
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await adminFetch(`/admin/api-keys/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete API key');
}
