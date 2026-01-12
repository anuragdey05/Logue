// src/CollaborativeEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { RemoteCursors } from './RemoteCursors.ts';
import { FontSize } from './extensions/fontSize';
import { Underline } from './extensions/underline';
import { SlashCommands } from './extensions/slashCommands';
import { getSnapshot } from './api';

type UserInfo = {
  id: string;
  name: string;
  color: string;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type PresenceUser = UserInfo & {
  clientId: number;
  isSelf: boolean;
};

export type PresenceEvent = {
  type: 'joined' | 'left';
  user: PresenceUser;
};

type AwarenessChangeEvent = {
  added: number[];
  updated: number[];
  removed: number[];
};

type Props = {
  docId: string;
  user: UserInfo;
  onPresenceChange?: (users: PresenceUser[]) => void;
  onPresenceEvent?: (event: PresenceEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
};

const FONT_SIZES = [
  { label: 'Small', value: '14px' },
  { label: 'Normal', value: '16px' },
  { label: 'Large', value: '18px' },
  { label: 'Title', value: '24px' },
];

type ScenePrefix = 'INT.' | 'EXT.' | 'INT./EXT.' | 'EST.';

const SCENE_PREFIX_OPTIONS: ScenePrefix[] = ['INT.', 'EXT.', 'INT./EXT.', 'EST.'];

const SCENE_PREFIX_ALIASES: Record<string, ScenePrefix> = {
  int: 'INT.',
  'int.': 'INT.',
  interior: 'INT.',
  ext: 'EXT.',
  'ext.': 'EXT.',
  exterior: 'EXT.',
  'int./ext.': 'INT./EXT.',
  'int/ext': 'INT./EXT.',
  'int- ext': 'INT./EXT.',
  'intext': 'INT./EXT.',
  est: 'EST.',
  'est.': 'EST.',
  establish: 'EST.',
  establishing: 'EST.',
};

type SceneContext = {
  prefix?: ScenePrefix;
  location?: string;
  time?: string;
};

const normalizeScenePrefix = (value?: string): ScenePrefix | null => {
  if (!value) return null;
  const normalized = value.replace(/[^a-z./]/gi, '').toLowerCase();
  return SCENE_PREFIX_ALIASES[normalized] ?? null;
};

const parseSceneQuery = (query?: string): SceneContext => {
  if (!query) return {};
  const segments = query.split('-');
  const locationSegment = segments[0] ?? '';
  const timeSegment = segments.slice(1).join('-');
  const trimmedLocation = locationSegment.trim();
  const [potentialPrefix, ...rest] = trimmedLocation.split(/\s+/);
  const matchedPrefix = normalizeScenePrefix(potentialPrefix);
  const location = matchedPrefix ? rest.join(' ').trim() : trimmedLocation;
  return {
    prefix: matchedPrefix ?? undefined,
    location: location || undefined,
    time: timeSegment.trim() || undefined,
  };
};

// Convert base64 string to Uint8Array for browser compatibility
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export const CollaborativeEditor: React.FC<Props> = ({
  docId,
  user,
  onPresenceChange,
  onPresenceEvent,
  onStatusChange,
}) => {
  const serverUrl =
    import.meta.env.VITE_COLLAB_SERVER_URL ?? 'ws://localhost:1234';

  const [collab, setCollab] = useState<{
    ydoc: Y.Doc;
    provider: WebsocketProvider;
  } | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);

  useEffect(() => {
    let mounted = true;
    let provider: WebsocketProvider | null = null;
    let ydoc: Y.Doc | null = null;

    const initialize = async () => {
      try {
        setLoadingSnapshot(true);
        ydoc = new Y.Doc();

        // Load snapshot from backend before connecting to WebSocket
        try {
          const snapshot = await getSnapshot(docId);
          if (snapshot && mounted) {
            const update = base64ToUint8Array(snapshot);
            Y.applyUpdate(ydoc, update);
            console.log(`Loaded snapshot for document ${docId}`);
          }
        } catch (error) {
          console.warn('Failed to load snapshot, starting with empty document:', error);
        }

        if (!mounted) {
          ydoc.destroy();
          return;
        }

        // Now connect to WebSocket with the hydrated document
        provider = new WebsocketProvider(serverUrl, docId, ydoc, {
          connect: true,
        });

        const awareness = provider.awareness;
        awareness.setLocalState({
          user,
          cursor: null,
        });

        if (mounted) {
          setCollab({ ydoc, provider });
          setLoadingSnapshot(false);
        }
      } catch (error) {
        console.error('Failed to initialize collaborative editor:', error);
        if (mounted) {
          setLoadingSnapshot(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      if (provider) {
        provider.awareness.setLocalState(null);
        provider.disconnect();
        provider.destroy();
      }
      if (ydoc) {
        ydoc.destroy();
      }
      setCollab(null);
    };
  }, [docId, serverUrl, user]);

  if (!collab || loadingSnapshot) {
    return (
      <div className="editor-surface">
        <div className="editor-toolbar">
          <div className="toolbar-meta">
            <div className="connection-pill connection-pill--connecting">Connecting…</div>
          </div>
        </div>
        <div className="editor-canvas connecting-state">
          <p>{loadingSnapshot ? 'Loading document…' : 'Connecting to collaboration server…'}</p>
        </div>
      </div>
    );
  }

  return (
    <EditorCore
      docId={docId}
      user={user}
      collab={collab}
      onPresenceChange={onPresenceChange}
      onPresenceEvent={onPresenceEvent}
      onStatusChange={onStatusChange}
    />
  );
};

type EditorCoreProps = {
  docId: string;
  user: UserInfo;
  collab: { ydoc: Y.Doc; provider: WebsocketProvider };
  onPresenceChange?: (users: PresenceUser[]) => void;
  onPresenceEvent?: (event: PresenceEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
};

const EditorCore: React.FC<EditorCoreProps> = ({
  docId,
  user,
  collab,
  onPresenceChange,
  onPresenceEvent,
  onStatusChange,
}) => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [participants, setParticipants] = useState<PresenceUser[]>([]);
  const participantsRef = useRef<PresenceUser[]>([]);
  const clientMapRef = useRef<Map<number, string>>(new Map());
  const [slashPanel, setSlashPanel] = useState<'list' | 'scene' | null>(null);
  const [slashRange, setSlashRange] = useState<{ from: number; to: number } | null>(null);
  const [pendingSlashCommand, setPendingSlashCommand] = useState<
    { command: 'dialogue' | 'action'; range: { from: number; to: number } } | null
  >(null);
  const [sceneLocation, setSceneLocation] = useState('');
  const [sceneTime, setSceneTime] = useState('');
  const [scenePrefix, setScenePrefix] = useState<ScenePrefix>('INT.');

  useEffect(() => {
    collab.provider.awareness.setLocalStateField('user', user);
  }, [collab, user]);

  useEffect(() => {
    const provider = collab.provider;
    const updateStatus = ({ status }: { status: string }) => {
      const mapped: ConnectionStatus =
        status === 'connected'
          ? 'connected'
          : status === 'connecting'
          ? 'connecting'
          : 'disconnected';
      setConnectionStatus(mapped);
      onStatusChange?.(mapped);
    };

    updateStatus({ status: 'connecting' });
    provider.on('status', updateStatus);
    return () => provider.off('status', updateStatus);
  }, [collab, onStatusChange]);

  useEffect(() => {
    const awareness = collab.provider.awareness;
    const handleUpdate = ({ added = [], removed = [] }: AwarenessChangeEvent = {
      added: [],
      updated: [],
      removed: [],
    }) => {
      const previousParticipants = participantsRef.current;
      const previousClientMap = clientMapRef.current;
      const dedupedByUser = new Map<string, PresenceUser>();
      const clientIdToUserId = new Map<number, string>();

      awareness.getStates().forEach((state, clientId) => {
        const details = state?.user as UserInfo | undefined;
        if (!details) return;
        clientIdToUserId.set(clientId, details.id);

        const participant: PresenceUser = {
          clientId,
          ...details,
          isSelf: clientId === awareness.clientID,
        };

        const existing = dedupedByUser.get(details.id);
        if (!existing) {
          dedupedByUser.set(details.id, participant);
        } else if (!existing.isSelf && participant.isSelf) {
          // Prefer the self entry when reconciling duplicate sessions.
          dedupedByUser.set(details.id, participant);
        }
      });

      const next = Array.from(dedupedByUser.values());

      added.forEach((clientId) => {
        const userId = clientIdToUserId.get(clientId);
        if (!userId) return;
        const previouslyPresent = previousParticipants.some((p) => p.id === userId);
        if (previouslyPresent) return;
        const joined = next.find((p) => p.id === userId);
        if (joined && joined.id !== user.id) {
          onPresenceEvent?.({ type: 'joined', user: joined });
        }
      });

      removed.forEach((clientId) => {
        const userId = previousClientMap.get(clientId);
        if (!userId) return;
        const stillPresent = next.some((p) => p.id === userId);
        if (stillPresent) return;
        const departed = previousParticipants.find((p) => p.id === userId);
        if (departed && departed.id !== user.id) {
          onPresenceEvent?.({ type: 'left', user: departed });
        }
      });

      participantsRef.current = next;
      clientMapRef.current = clientIdToUserId;
      setParticipants(next);
      onPresenceChange?.(next);
    };

    awareness.on('update', handleUpdate);
    handleUpdate();
    return () => awareness.off('update', handleUpdate);
  }, [collab, onPresenceChange, onPresenceEvent, user.id]);

  const editor = useEditor(
    {
      extensions: [
        SlashCommands.configure({
          onOpenMenu: (range) => {
            setSlashRange(range);
            setSlashPanel('list');
            setSceneLocation('');
            setSceneTime('');
            setScenePrefix('INT.');
          },
          onSelectCommand: (command, range, context) => {
            setSlashRange(range);
            if (command === 'scene') {
              const parsed = parseSceneQuery(context?.query);
              setScenePrefix(parsed.prefix ?? 'INT.');
              setSceneLocation(parsed.location ?? '');
              setSceneTime(parsed.time ?? '');
              setSlashPanel('scene');
              return;
            }
            if (command === 'dialogue' || command === 'action') {
              setPendingSlashCommand({ command, range });
            }
          },
        }),
        StarterKit.configure({
          history: false,
          undoRedo: false,
        } as any),
        Underline,
        FontSize,
        Collaboration.configure({
          document: collab.ydoc,
        }),
        RemoteCursors.configure({
          provider: collab.provider,
          user,
        }),
      ],
      onSelectionUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection;
        collab.provider.awareness.setLocalStateField('cursor', {
          anchor: from,
          head: to,
        });
      },
      onUpdate: ({ editor }) => {
        const { from, to } = editor.state.selection;
        collab.provider.awareness.setLocalStateField('cursor', {
          anchor: from,
          head: to,
        });
      },
    },
    [collab, user]
  );

  const insertContentAtRange = useCallback(
    (content: string, rangeOverride?: { from: number; to: number }) => {
      if (!editor) return;
      const selectionRange = rangeOverride
        ? rangeOverride
        : slashRange ?? {
            from: editor.state.selection.from,
            to: editor.state.selection.to,
          };
      if (!selectionRange) return;
      editor
        .chain()
        .focus()
        .deleteRange(selectionRange)
        .insertContentAt(selectionRange.from, content)
        .run();
    },
    [editor, slashRange]
  );

  const insertDialogueBlock = useCallback(
    (range?: { from: number; to: number }) => {
      insertContentAtRange('CHARACTER NAME\nDialogue goes here.\n', range);
      setSlashPanel(null);
      setPendingSlashCommand(null);
    },
    [insertContentAtRange]
  );

  const insertActionBlock = useCallback(
    (range?: { from: number; to: number }) => {
      insertContentAtRange('Action description…\n', range);
      setSlashPanel(null);
      setPendingSlashCommand(null);
    },
    [insertContentAtRange]
  );

  const insertSceneHeading = useCallback(() => {
    const location = sceneLocation.trim();
    if (!location) return;
    const time = sceneTime.trim();
    const headingParts = [`${scenePrefix}`.trim(), location.toUpperCase()];
    if (time) {
      headingParts.push(time.toUpperCase());
    }
    const heading = headingParts.length === 3
      ? `${headingParts[0]} ${headingParts[1]} - ${headingParts[2]}`
      : `${headingParts[0]} ${headingParts[1]}`;
    insertContentAtRange(heading + '\n');
    setSlashPanel(null);
    setSceneLocation('');
    setSceneTime('');
    setScenePrefix('INT.');
  }, [insertContentAtRange, sceneLocation, sceneTime, scenePrefix]);

  const canInsertSceneHeading = sceneLocation.trim().length > 0;

  useEffect(() => {
    if (!pendingSlashCommand) return;
    if (pendingSlashCommand.command === 'dialogue') {
      insertDialogueBlock(pendingSlashCommand.range);
    } else if (pendingSlashCommand.command === 'action') {
      insertActionBlock(pendingSlashCommand.range);
    }
  }, [insertActionBlock, insertDialogueBlock, pendingSlashCommand]);

  const remoteParticipants = participants.filter((participant) => !participant.isSelf);
  const avatarSamples = (remoteParticipants.length ? remoteParticipants : participants).slice(0, 3);

  const toolbarButtons = useMemo(
    () => [
      {
        key: 'bold',
        label: 'Bold',
        glyph: 'B',
        isActive: () => editor?.isActive('bold'),
        action: () => editor?.chain().focus().toggleBold().run(),
      },
      {
        key: 'italic',
        label: 'Italic',
        glyph: 'I',
        isActive: () => editor?.isActive('italic'),
        action: () => editor?.chain().focus().toggleItalic().run(),
      },
      {
        key: 'underline',
        label: 'Underline',
        glyph: 'U',
        isActive: () => editor?.isActive('underline'),
        action: () => editor?.chain().focus().toggleUnderline().run(),
      },
      {
        key: 'strike',
        label: 'Strike',
        glyph: 'S',
        isActive: () => editor?.isActive('strike'),
        action: () => editor?.chain().focus().toggleStrike().run(),
      },
      {
        key: 'code',
        label: 'Code',
        glyph: '<>',
        isActive: () => editor?.isActive('codeBlock'),
        action: () => editor?.chain().focus().toggleCodeBlock().run(),
      },
    ],
    [editor]
  );

  const blockButtons = useMemo(
    () => [
      {
        key: 'bullet',
        label: 'Bulleted list',
        glyph: '•',
        isActive: () => editor?.isActive('bulletList'),
        action: () => editor?.chain().focus().toggleBulletList().run(),
      },
      {
        key: 'ordered',
        label: 'Numbered list',
        glyph: '1.',
        isActive: () => editor?.isActive('orderedList'),
        action: () => editor?.chain().focus().toggleOrderedList().run(),
      },
      {
        key: 'quote',
        label: 'Blockquote',
        glyph: '“”',
        isActive: () => editor?.isActive('blockquote'),
        action: () => editor?.chain().focus().toggleBlockquote().run(),
      },
    ],
    [editor]
  );

  const historyButtons = useMemo(
    () => [
      {
        key: 'undo',
        label: 'Undo',
        glyph: '↺',
        action: () => editor?.chain().focus().undo().run(),
      },
      {
        key: 'redo',
        label: 'Redo',
        glyph: '↻',
        action: () => editor?.chain().focus().redo().run(),
      },
    ],
    [editor]
  );

  const currentFontSize = editor?.getAttributes('fontSize').size ?? 'default';

  const handleFontSizeChange = (value: string) => {
    if (!editor) return;
    if (value === 'default') {
      editor.chain().focus().unsetFontSize().run();
    } else {
      editor.chain().focus().setFontSize(value).run();
    }
  };

  if (!editor) return null;

  const connectionLabel =
    connectionStatus === 'connected'
      ? 'Live'
      : connectionStatus === 'connecting'
      ? 'Connecting…'
      : 'Offline';

  return (
    <div className="editor-surface">
      <div className="editor-toolbar">
        <div className="toolbar-group">
          {toolbarButtons.map(({ key, label, glyph, isActive, action }) => (
            <button
              key={key}
              type="button"
              className={`toolbar-button ${isActive?.() ? 'is-active' : ''}`}
              onClick={action}
              aria-label={label}
            >
              {glyph}
            </button>
          ))}
          <span className="toolbar-divider" />
          {blockButtons.map(({ key, label, glyph, isActive, action }) => (
            <button
              key={key}
              type="button"
              className={`toolbar-button ${isActive?.() ? 'is-active' : ''}`}
              onClick={action}
              aria-label={label}
            >
              {glyph}
            </button>
          ))}
          <span className="toolbar-divider" />
          {historyButtons.map(({ key, label, glyph, action }) => (
            <button
              key={key}
              type="button"
              className="toolbar-button"
              onClick={action}
              aria-label={label}
            >
              {glyph}
            </button>
          ))}
        </div>

        <div className="toolbar-meta">
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              const { Document, Packer, Paragraph } = await import('docx');
              const text = editor.getText();
              const lines = text.split('\n');
              const paragraphs = lines.map((line) => new Paragraph(line || ' '));
              const docx = new Document({
                sections: [{ children: paragraphs }],
              });
              const blob = await Packer.toBlob(docx);
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${docId || 'document'}.docx`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }}
          >
            Download .docx
          </button>
          <label className="font-select">
            <span>Size</span>
            <select
              value={currentFontSize}
              onChange={(event) => handleFontSizeChange(event.target.value)}
            >
              <option value="default">Default</option>
              {FONT_SIZES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className={`connection-pill connection-pill--${connectionStatus}`}>
            {connectionLabel}
          </div>
          <div className="avatar-stack" aria-label="Active collaborators">
            {avatarSamples.map((participant) => (
              <span
                key={participant.clientId}
                className="avatar-dot"
                style={{ background: participant.color }}
                title={`${participant.name}${participant.isSelf ? ' (You)' : ''}`}
              />
            ))}
            {remoteParticipants.length > 3 && (
              <span className="avatar-extra">+{remoteParticipants.length - 3}</span>
            )}
          </div>
        </div>
      </div>

      <div
        className="editor-canvas"
        onClick={() => {
          setSlashPanel(null);
          editor.chain().focus().run();
        }}
      >
        {slashPanel && (
          <div
            className="slash-menu"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {slashPanel === 'list' && (
              <div className="slash-menu__content">
                <div className="slash-menu__header">Insert block</div>
                <button
                  type="button"
                  className="slash-menu__item"
                  onClick={() => {
                    setScenePrefix('INT.');
                    setSceneLocation('');
                    setSceneTime('');
                    setSlashPanel('scene');
                  }}
                >
                  <span className="slash-menu__item-title">Scene heading</span>
                  <span className="slash-menu__item-desc">
                    Format like INT. LOCATION - DAY
                  </span>
                </button>
                <button
                  type="button"
                  className="slash-menu__item"
                  onClick={() => insertDialogueBlock()}
                >
                  <span className="slash-menu__item-title">Dialogue</span>
                  <span className="slash-menu__item-desc">
                    Insert a simple dialogue block
                  </span>
                </button>
                <button
                  type="button"
                  className="slash-menu__item"
                  onClick={() => insertActionBlock()}
                >
                  <span className="slash-menu__item-title">Action</span>
                  <span className="slash-menu__item-desc">
                    Describe on-screen action
                  </span>
                </button>
              </div>
            )}
            {slashPanel === 'scene' && (
              <form
                className="slash-menu__content slash-menu__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  insertSceneHeading();
                }}
              >
                <div className="slash-menu__header">Scene heading</div>
                <label className="slash-menu__field">
                  <span>Interior / Exterior</span>
                  <select
                    value={scenePrefix}
                    onChange={(event) =>
                      setScenePrefix(event.target.value as ScenePrefix)
                    }
                  >
                    {SCENE_PREFIX_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="slash-menu__field">
                  <span>Location</span>
                  <input
                    type="text"
                    placeholder="Apartment - Living Room"
                    value={sceneLocation}
                    onChange={(event) => setSceneLocation(event.target.value)}
                    autoFocus
                  />
                </label>
                <label className="slash-menu__field">
                  <span>Time of day</span>
                  <input
                    type="text"
                    placeholder="Night"
                    value={sceneTime}
                    onChange={(event) => setSceneTime(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setSlashPanel(null);
                      }
                    }}
                  />
                </label>
                <div className="slash-menu__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSlashPanel(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={!canInsertSceneHeading}
                  >
                    Insert heading
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        <div className="editor-status-row">
          <span>
            <strong>Document:</strong> {docId}
          </span>
          <span>
            <strong>User:</strong> {user.name}
          </span>
        </div>
        <EditorContent editor={editor} className="tiptap-editor" />
      </div>
    </div>
  );
};
