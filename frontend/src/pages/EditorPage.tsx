import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CollaborativeEditor,
  type ConnectionStatus,
  type PresenceEvent,
  type PresenceUser,
} from '../CollaborativeEditor';
import {
  getDocument,
  updateDocument,
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  type DocumentMeta,
  type DocumentMember,
  type DocumentRole,
} from '../api';
import { useAuth } from '../context/AuthContext';

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return timestampFormatter.format(date);
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<DocumentMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [presenceToast, setPresenceToast] = useState<
    (PresenceEvent & { timestamp: number }) | null
  >(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('connecting');
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [members, setMembers] = useState<DocumentMember[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<DocumentRole>('EDITOR');
  const { user, loading: authLoading, login } = useAuth();
  const editorUser = useMemo(() => {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name || user.email,
      color: user.accentColor,
    };
  }, [user]);
  const displayName = user?.name || user?.email || 'Guest collaborator';

  useEffect(() => {
    if (!id) {
      setError('Missing document id');
      setLoading(false);
      return;
    }
    let mounted = true;
    if (authLoading) {
      return () => {
        mounted = false;
      };
    }

    if (!user) {
      setDoc(null);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        setLoading(true);
        const result = await getDocument(id);
        if (!mounted) return;
        setDoc(result);
        setTitleDraft(result.title || 'Untitled script');
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        console.error(err);
        setError(err.message || 'Document not found');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [authLoading, id, user]);

  useEffect(() => {
    if (!presenceToast) return;
    const timeout = setTimeout(() => setPresenceToast(null), 2800);
    return () => clearTimeout(timeout);
  }, [presenceToast]);

  const handlePresenceChange = useCallback((users: PresenceUser[]) => {
    setPresence(users);
  }, []);

  const handlePresenceEvent = useCallback(
    (event: PresenceEvent) => {
      if (!event.user || !editorUser) return;
      if (event.user.id === editorUser.id) return;
      setPresenceToast({ ...event, timestamp: Date.now() });
    },
    [editorUser]
  );

  const isOwner = !!(doc && user && doc.ownerId === user.id);

  const handleTitleCommit = useCallback(async () => {
    if (!doc) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === doc.title) {
      setIsEditingTitle(false);
      setTitleDraft(doc.title || 'Untitled script');
      return;
    }
    try {
      const updated = await updateDocument(doc.id, { title: nextTitle });
      setDoc(updated);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to rename document');
    } finally {
      setIsEditingTitle(false);
    }
  }, [doc, titleDraft]);

  const loadMembers = useCallback(async () => {
    if (!doc) return;
    try {
      setMembersLoading(true);
      const result = await listMembers(doc.id);
      setMembers(result);
      setMembersError(null);
    } catch (err: any) {
      console.error(err);
      setMembersError(err.message || 'Failed to load collaborators');
    } finally {
      setMembersLoading(false);
    }
  }, [doc]);

  const handleOpenShare = useCallback(() => {
    setIsShareOpen(true);
    void loadMembers();
  }, [loadMembers]);

  const handleInvite = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!doc || !inviteEmail.trim()) return;
      try {
        const created = await inviteMember(doc.id, inviteEmail.trim(), inviteRole);
        setMembers((prev) => (prev ? [...prev, created] : [created]));
        setInviteEmail('');
        setMembersError(null);
      } catch (err: any) {
        console.error(err);
        setMembersError(err.message || 'Failed to invite collaborator');
      }
    },
    [doc, inviteEmail, inviteRole]
  );

  const handleRoleChange = useCallback(
    async (memberId: string, role: DocumentRole) => {
      if (!doc) return;
      try {
        const updated = await updateMemberRole(doc.id, memberId, role);
        setMembers((prev) =>
          prev ? prev.map((m) => (m.id === memberId ? updated : m)) : prev
        );
        setMembersError(null);
      } catch (err: any) {
        console.error(err);
        setMembersError(err.message || 'Failed to update role');
      }
    },
    [doc]
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!doc) return;
      try {
        await removeMember(doc.id, memberId);
        setMembers((prev) => (prev ? prev.filter((m) => m.id !== memberId) : prev));
        setMembersError(null);
      } catch (err: any) {
        console.error(err);
        setMembersError(err.message || 'Failed to remove collaborator');
      }
    },
    [doc]
  );

  const timestamp = doc ? formatTimestamp(doc.updatedAt) : '—';
  const activeCollaborators = presence.filter(
    (participant) => !participant.isSelf && participant.id !== editorUser?.id
  );
  const presenceLabel = editorUser
    ? activeCollaborators.length
      ? `${activeCollaborators.length} collaborator${
          activeCollaborators.length > 1 ? 's' : ''
        } live`
      : 'Only you here'
    : 'Sign in to join';
  const presenceSource = activeCollaborators.length
    ? activeCollaborators
    : editorUser
    ? [
        {
          clientId: -1,
          isSelf: true,
          ...editorUser,
        } as PresenceUser,
      ]
    : [];
  const presenceAvatars = presenceSource.slice(0, 4);

  if (!id) {
    return (
      <div className="editor-page">
        <div className="editor-panel">
          <p className="documents-error">Missing document id.</p>
          <Link className="back-link" to="/">
            ← Back to documents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <header className="top-bar">
        <button className="back-link top-bar__back" onClick={() => navigate(-1)}>
          ← Documents
        </button>
        <div className="top-bar__body">
          <p className="eyebrow">Active script</p>
          {isEditingTitle && isOwner ? (
            <input
              className="editor-title-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void handleTitleCommit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleTitleCommit();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setIsEditingTitle(false);
                  setTitleDraft(doc?.title || 'Untitled script');
                }
              }}
              aria-label="Rename document"
              autoFocus
            />
          ) : (
            <h1
              className={`editor-title ${isOwner ? 'editor-title--editable' : ''}`}
              onClick={() => {
                if (isOwner) setIsEditingTitle(true);
              }}
            >
              {doc ? doc.title || 'Untitled script' : 'Loading…'}
            </h1>
          )}
          <div className="top-bar__meta">
            <span>Room {doc?.roomId ?? '—'}</span>
            <span>Last edited {doc ? timestamp : '—'}</span>
            <span className={`pill pill--${connectionStatus}`}>
              {connectionStatus === 'connected'
                ? 'Realtime'
                : connectionStatus === 'connecting'
                ? 'Connecting…'
                : 'Offline'}
            </span>
          </div>
        </div>
        <div className="top-bar__actions">
          <div className="presence-chips">
            <div className="presence-chips__avatars">
              {presenceAvatars.map((participant, index) => (
                <span
                  key={`${participant.clientId}-${index}`}
                  className="presence-summary__dot"
                  style={{ background: participant.color }}
                  title={participant.name}
                />
              ))}
              {activeCollaborators.length > 4 && (
                <span className="presence-summary__extra">
                  +{activeCollaborators.length - 4}
                </span>
              )}
            </div>
            <span className="presence-summary__label">{presenceLabel}</span>
          </div>
          {isOwner && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleOpenShare}
            >
              Share
            </button>
          )}
          <div className="user-badge">
            <span
              className="user-dot"
              style={{ background: user?.accentColor || '#54a0ff' }}
            />
            <div>
              <strong style={{ display: 'block', fontSize: '0.95rem' }}>
                {displayName}
              </strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                {user ? 'Live collaborator' : 'Sign in required'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="editor-layout">
        <section className="editor-panel">
          {presenceToast && presenceToast.user && (
            <div
              className={`presence-toast presence-toast--${presenceToast.type}`}
            >
              <span
                className="presence-toast__dot"
                style={{ background: presenceToast.user.color }}
              />
              <div>
                <strong>{presenceToast.user.name}</strong>{' '}
                {presenceToast.type === 'joined' ? 'joined' : 'left'} the room
              </div>
            </div>
          )}
          {authLoading ? (
            <div className="editor-empty">
              <strong>Checking your session…</strong>
            </div>
          ) : !user ? (
            <div className="editor-empty">
              <strong>Sign in to edit this draft</strong>
              <button
                className="btn-primary"
                type="button"
                onClick={() => login(window.location.href)}
              >
                Sign in with Google
              </button>
            </div>
          ) : loading ? (
            <div className="editor-empty">
              <strong>Loading document…</strong>
            </div>
          ) : error ? (
            <div className="editor-empty">
              <strong>{error}</strong>
              <Link className="back-link" to="/">
                Go back to documents
              </Link>
            </div>
          ) : doc && editorUser ? (
            <CollaborativeEditor
              docId={doc.id}
              user={editorUser}
              onPresenceChange={handlePresenceChange}
              onPresenceEvent={handlePresenceEvent}
              onStatusChange={setConnectionStatus}
            />
          ) : null}
        </section>

        <aside className="editor-sidepanel">
          <div className="panel-card">
            <h3>Realtime status</h3>
            <dl className="info-list">
              <div>
                <dt>Room</dt>
                <dd>{doc?.roomId ?? '—'}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{doc ? timestamp : '—'}</dd>
              </div>
              <div>
                <dt>Collaborators</dt>
                <dd>{presenceLabel}</dd>
              </div>
            </dl>
          </div>
          <div className="panel-card">
            <h3>Slash commands</h3>
            <ul className="command-list">
              <li>
                <code>\scene</code>
                <span>Scene heading with custom location + time</span>
              </li>
              <li>
                <code>\dialogue</code>
                <span>Character cue and dialogue block</span>
              </li>
              <li>
                <code>\action</code>
                <span>Action line placeholder</span>
              </li>
            </ul>
          </div>
          <div className="panel-card">
            <h3>Tips</h3>
            <ul className="tip-list">
              <li>Use the toolbar for bold, italics, underline, and lists.</li>
              <li>Download the latest draft as a Word file from the toolbar.</li>
              <li>Share access with teammates via the Share button.</li>
            </ul>
          </div>
        </aside>
      </div>

      {isShareOpen && doc && (
        <div className="share-dialog-backdrop" role="dialog" aria-modal="true">
          <div className="share-dialog">
            <div className="share-dialog__header">
              <h2>Share "{doc.title || 'Untitled script'}"</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setIsShareOpen(false)}
                aria-label="Close share dialog"
              >
                ×
              </button>
            </div>
            <p className="share-dialog__subtitle">
              Invite collaborators and adjust their permissions.
            </p>
            <form className="share-dialog__invite" onSubmit={handleInvite}>
              <input
                type="email"
                required
                placeholder="name@example.com"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
              <select
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as DocumentRole)
                }
              >
                <option value="EDITOR">Can edit</option>
                <option value="COMMENTER">Can comment</option>
                <option value="VIEWER">View only</option>
              </select>
              <button type="submit" className="btn-primary">
                Send invite
              </button>
            </form>
            {membersError && (
              <p className="share-dialog__error">{membersError}</p>
            )}
            <div className="share-dialog__list">
              {membersLoading && <p>Loading collaborators…</p>}
              {!membersLoading && members && members.length === 0 && (
                <p>No collaborators yet. Invite someone above.</p>
              )}
              {!membersLoading && members && members.length > 0 && (
                <ul>
                  {members.map((member) => {
                    const isCurrentUser = member.user.id === user?.id;
                    return (
                      <li key={member.id} className="share-dialog__row">
                        <div className="share-dialog__user">
                          <span
                            className="share-dialog__avatar"
                            style={{ background: member.user.accentColor }}
                          />
                          <div>
                            <div className="share-dialog__name">
                              {member.user.name || member.user.email}
                              {isCurrentUser && ' (you)'}
                            </div>
                            <div className="share-dialog__email">
                              {member.user.email}
                            </div>
                          </div>
                        </div>
                        <div className="share-dialog__role">
                          <select
                            value={member.role}
                            onChange={(event) =>
                              handleRoleChange(
                                member.id,
                                event.target.value as DocumentRole
                              )
                            }
                            disabled={isCurrentUser}
                          >
                            <option value="OWNER">Owner</option>
                            <option value="EDITOR">Editor</option>
                            <option value="COMMENTER">Commenter</option>
                            <option value="VIEWER">Viewer</option>
                          </select>
                          {!isCurrentUser && (
                            <button
                              type="button"
                              className="icon-button icon-button--danger"
                              onClick={() => handleRemoveMember(member.id)}
                              aria-label={`Remove ${member.user.email}`}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
