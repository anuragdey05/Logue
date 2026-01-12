import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDocument, listDocuments, type DocumentMeta } from '../api';
import { useAuth } from '../context/AuthContext';

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not edited yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not edited yet';
  }
  return timestampFormatter.format(date);
}

export function HomePage() {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const { user, loading: authLoading, login, logout } = useAuth();
  const isAuthenticated = Boolean(user);
  const displayName = user?.name || user?.email;

  useEffect(() => {
    let mounted = true;
    if (authLoading) {
      return () => {
        mounted = false;
      };
    }

    if (!isAuthenticated) {
      setDocuments([]);
      setLoading(false);
      setError(null);
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        setLoading(true);
        const docs = await listDocuments();
        if (!mounted) return;
        setDocuments(docs);
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        console.error(err);
        setError(err.message || 'Failed to load documents');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [authLoading, isAuthenticated]);

  async function handleCreateDocument(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!isAuthenticated) {
      login();
      return;
    }

    try {
      setCreating(true);
      const doc = await createDocument(newTitle);
      setDocuments((prev) => [doc, ...prev]);
      setNewTitle('');
      setError(null);
      navigate(`/documents/${doc.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create document');
    } finally {
      setCreating(false);
    }
  }

  async function handleQuickStart() {
    if (creating) return;
    if (!isAuthenticated) {
      login();
      return;
    }

    try {
      setCreating(true);
      const doc = await createDocument();
      setDocuments((prev) => [doc, ...prev]);
      setError(null);
      navigate(`/documents/${doc.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create document');
    } finally {
      setCreating(false);
    }
  }

  const stats = useMemo(
    () => ({
      total: documents.length,
      updated:
        documents.length > 0 ? formatTimestamp(documents[0]?.updatedAt) : '—',
    }),
    [documents]
  );

  return (
    <div className="home-shell">
      <div className="home-account">
        {isAuthenticated ? (
          <>
            <span
              className="user-dot"
              style={{ background: user?.accentColor }}
              aria-hidden
            />
            <div>
              <strong>{displayName}</strong>
              <button
                className="link-button"
                type="button"
                onClick={() => {
                  void logout();
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : (
          <button className="btn-primary" type="button" onClick={() => login()}>
            Sign in with Google
          </button>
        )}
      </div>

      <header className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">Logue Studio</p>
          <h1>Write emotional screenplays with your team in real time.</h1>
          <p className="hero-subtext">
            Bring storytelling to life with live collaboration, autosave
            snapshots, and structured drafts that keep every beat in sync.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={handleQuickStart} disabled={creating}>
              {!isAuthenticated
                ? 'Sign in to start'
                : creating
                ? 'Starting…'
                : 'Start writing'}
            </button>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                document.getElementById('doc-section')?.scrollIntoView({
                  behavior: 'smooth',
                });
              }}
            >
              Browse drafts
            </button>
          </div>
        </div>

        <div className="home-panel">
          <div className="home-panel__header">
            <div>
              <p className="eyebrow">Create</p>
              <h2>New screenplay</h2>
            </div>
            <span className="badge-soft">{stats.total} drafts</span>
          </div>
          <form className="doc-form" onSubmit={handleCreateDocument}>
            <input
              type="text"
              placeholder="Untitled screenplay"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={!isAuthenticated}
            />
            <button type="submit" disabled={creating || !isAuthenticated}>
              {!isAuthenticated
                ? 'Sign in to create'
                : creating
                ? 'Creating…'
                : 'Create document'}
            </button>
          </form>
          <dl className="home-stats">
            <div>
              <dt>Total drafts</dt>
              <dd>{stats.total}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{stats.updated}</dd>
            </div>
          </dl>
          {error && <p className="documents-error">{error}</p>}
        </div>
      </header>

      <section className="doc-section" id="doc-section">
        <div className="doc-section__header">
          <div>
            <p className="eyebrow">Latest drafts</p>
            <h2>Jump back into a scene</h2>
          </div>
          <span className="badge-soft">{stats.total} active</span>
        </div>

        {authLoading ? (
          <div className="documents-empty">Checking your session…</div>
        ) : !isAuthenticated ? (
          <div className="documents-empty">
            Sign in to view and create collaborative drafts.
            <button className="btn-primary btn-inline" type="button" onClick={() => login()}>
              Sign in with Google
            </button>
          </div>
        ) : loading ? (
          <div className="documents-empty">Loading documents…</div>
        ) : documents.length === 0 ? (
          <div className="documents-empty">
            No scripts yet. Use the panel above to start one.
          </div>
        ) : (
          <div className="doc-grid">
            {documents.map((doc) => (
              <button
                type="button"
                key={doc.id}
                className="doc-card doc-card--grid"
                onClick={() => navigate(`/documents/${doc.id}`)}
              >
                <div className="doc-card__title-row">
                  <span className="pill">room {doc.roomId.slice(-4)}</span>
                </div>
                <h3 className="doc-card__title">{doc.title}</h3>
                <p className="doc-card__meta">Updated {formatTimestamp(doc.updatedAt)}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
