// src/api.ts
export type DocumentMeta = {
  id: string;
  title: string;
  description: string;
  roomId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEditedBy: string | null;
  ownerId?: string | null;
};

export type DocumentRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export type DocumentMember = {
  id: string;
  role: DocumentRole;
  user: {
    id: string;
    email: string;
    name: string | null;
    accentColor: string;
  };
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
};

const API_BASE =
  import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:4000';

const jsonHeaders = { 'Content-Type': 'application/json' };

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const message = error?.error || 'Request failed';
    throw new Error(message);
  }
  return res.json();
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const res = await fetch(`${API_BASE}/documents`, {
    credentials: 'include',
  });
  return handleJson(res);
}

export async function getDocument(id: string): Promise<DocumentMeta> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    credentials: 'include',
  });
  return handleJson(res);
}

export async function updateDocument(
  id: string,
  data: Partial<Pick<DocumentMeta, 'title' | 'description' | 'status'>>
): Promise<DocumentMeta> {
  const res = await fetch(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify(data),
  });
  return handleJson(res);
}

export async function createDocument(title?: string): Promise<DocumentMeta> {
  const res = await fetch(`${API_BASE}/documents`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ title }),
  });
  return handleJson(res);
}

export async function putSnapshot(
  documentId: string,
  snapshot: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/snapshot`, {
    method: 'PUT',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ snapshot }),
  });
  if (!res.ok) {
    throw new Error('Failed to save snapshot');
  }
}

export async function getSnapshot(
  documentId: string
): Promise<string | null> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/snapshot`, {
    credentials: 'include',
  });
  if (res.status === 204) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to load snapshot');
  }
  const data = await res.json();
  return data.snapshot ?? null;
}

export async function listMembers(
  documentId: string
): Promise<DocumentMember[]> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/members`, {
    credentials: 'include',
  });
  return handleJson(res);
}

export async function inviteMember(
  documentId: string,
  email: string,
  role: DocumentRole
): Promise<DocumentMember> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/members`, {
    method: 'POST',
    credentials: 'include',
    headers: jsonHeaders,
    body: JSON.stringify({ email, role }),
  });
  return handleJson(res);
}

export async function updateMemberRole(
  documentId: string,
  memberId: string,
  role: DocumentRole
): Promise<DocumentMember> {
  const res = await fetch(
    `${API_BASE}/documents/${documentId}/members/${memberId}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: jsonHeaders,
      body: JSON.stringify({ role }),
    }
  );
  return handleJson(res);
}

export async function removeMember(
  documentId: string,
  memberId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/documents/${documentId}/members/${memberId}`,
    {
      method: 'DELETE',
      credentials: 'include',
    }
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const message = (error as any)?.error || 'Failed to remove member';
    throw new Error(message);
  }
}

export async function getCurrentUser(): Promise<AuthenticatedUser> {
  const res = await fetch(`${API_BASE}/auth/user`, {
    credentials: 'include',
  });
  if (res.status === 401) {
    throw new Error('Not authenticated');
  }
  return handleJson(res);
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

export function beginGoogleLogin(redirect?: string) {
  const target = redirect || window.location.href;
  const url = new URL(`${API_BASE}/auth/google`);
  url.searchParams.set('redirect', target);
  window.location.assign(url.toString());
}
