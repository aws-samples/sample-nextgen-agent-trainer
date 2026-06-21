function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split('.')[1]));
    return exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function forceLogout() {
  localStorage.removeItem('id_token');
  localStorage.removeItem('access_token');
  localStorage.removeItem('user_name');
  window.location.href = '/';
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('id_token');

  if (!isTokenValid(token)) {
    forceLogout();
    throw new Error('Token expired');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options?.headers as Record<string, string> ?? {}),
  };
  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    forceLogout();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export default apiFetch;
