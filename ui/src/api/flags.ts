import { apiFetch } from './client';

export interface Flag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment: string;
  targeting?: {
    userIds?: string[];
    attributes?: Record<string, string[]>;
  };
  rollout?: {
    percentage: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlagPayload {
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment?: string;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export interface UpdateFlagPayload {
  name?: string;
  description?: string;
  enabled?: boolean;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export async function getFlags(): Promise<Flag[]> {
  const res = await apiFetch('/api/flags');
  if (!res.ok) throw new Error('Failed to fetch flags');
  return res.json() as Promise<Flag[]>;
}

export async function createFlag(payload: CreateFlagPayload): Promise<Flag> {
  const res = await apiFetch('/api/flags', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create flag');
  }
  return res.json() as Promise<Flag>;
}

export async function updateFlag(key: string, payload: UpdateFlagPayload): Promise<Flag> {
  const res = await apiFetch(`/api/flags/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to update flag');
  }
  return res.json() as Promise<Flag>;
}

export async function deleteFlag(key: string): Promise<void> {
  const res = await apiFetch(`/api/flags/${key}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete flag');
}
