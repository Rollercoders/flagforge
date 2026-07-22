import { apiFetch } from './client';

export type FlagType = 'boolean' | 'number' | 'string';
export type FlagValue = boolean | number | string;

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  type: FlagType;
  value?: FlagValue;
  defaultValue?: FlagValue;
  environment: string;
  targeting?: { userIds?: string[]; attributes?: Record<string, string[]> };
  rollout?: { percentage: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlagPayload {
  key: string;
  name: string;
  description?: string;
  type?: FlagType;
  value?: FlagValue;
  defaultValue?: FlagValue;
  targeting?: Flag['targeting'];
  rollout?: Flag['rollout'];
}

export interface UpdateFlagPayload {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  value?: FlagValue;
  defaultValue?: FlagValue;
  targeting?: Flag['targeting'] | null;
  rollout?: Flag['rollout'] | null;
}

export async function getFlags(projectId: string, environment: string): Promise<Flag[]> {
  const url = `/admin/flags?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url);
  if (!res.ok) throw new Error('Failed to fetch flags');
  return res.json() as Promise<Flag[]>;
}

export async function createFlag(projectId: string, environment: string, payload: CreateFlagPayload): Promise<Flag> {
  const res = await apiFetch('/admin/flags', {
    method: 'POST',
    body: JSON.stringify({ ...payload, projectId, environment }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create flag');
  }
  return res.json() as Promise<Flag>;
}

export async function updateFlag(key: string, projectId: string, environment: string, payload: UpdateFlagPayload): Promise<Flag> {
  const url = `/admin/flags/${key}?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to update flag');
  }
  return res.json() as Promise<Flag>;
}

export async function deleteFlag(key: string, projectId: string, environment: string): Promise<void> {
  const url = `/admin/flags/${key}?projectId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}`;
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete flag');
}
