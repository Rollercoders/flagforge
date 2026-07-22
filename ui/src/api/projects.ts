async function adminFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) window.dispatchEvent(new Event('rf:unauthorized'));
  return res;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;
  secretKey: string;
  createdAt: string;
}

export async function getProjects(): Promise<Project[]> {
  const res = await adminFetch('/admin/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json() as Promise<Project[]>;
}

export async function createProject(name: string): Promise<Project> {
  const res = await adminFetch('/admin/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create project');
  }
  return res.json() as Promise<Project>;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await adminFetch(`/admin/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function getEnvironments(projectId: string): Promise<Environment[]> {
  const res = await adminFetch(`/admin/projects/${projectId}/environments`);
  if (!res.ok) throw new Error('Failed to fetch environments');
  return res.json() as Promise<Environment[]>;
}

export async function createEnvironment(projectId: string, name: string): Promise<Environment> {
  const res = await adminFetch(`/admin/projects/${projectId}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to create environment');
  }
  return res.json() as Promise<Environment>;
}

export async function deleteEnvironment(projectId: string, envId: string): Promise<void> {
  const res = await adminFetch(`/admin/projects/${projectId}/environments/${envId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete environment');
}

export async function renameEnvironment(projectId: string, envId: string, name: string): Promise<Environment> {
  const res = await adminFetch(`/admin/projects/${projectId}/environments/${envId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to rename environment');
  }
  return res.json() as Promise<Environment>;
}

export async function regenerateEnvironmentKey(envId: string, role: 'client' | 'secret' = 'client'): Promise<Environment> {
  const res = await adminFetch(`/admin/environments/${envId}/regenerate-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error('Failed to regenerate key');
  return res.json() as Promise<Environment>;
}
