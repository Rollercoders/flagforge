export async function login(password: string): Promise<void> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? 'Login failed');
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return false;
    const data = await res.json() as { authenticated: boolean };
    return data.authenticated;
  } catch {
    return false;
  }
}
