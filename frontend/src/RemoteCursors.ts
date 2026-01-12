// src/RemoteCursors.ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { WebsocketProvider } from 'y-websocket';

type UserInfo = {
  id: string;
  name: string;
  color: string;
};

export interface RemoteCursorsOptions {
  provider: WebsocketProvider;
  user: UserInfo;
}

const pluginKey = new PluginKey('remoteCursors');

export const RemoteCursors = Extension.create<RemoteCursorsOptions>({
  name: 'remoteCursors',

  addProseMirrorPlugins() {
    const provider = this.options.provider;
    const awareness = provider.awareness;

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, old) {
            const meta = tr.getMeta(pluginKey);
            if (meta && meta.decorations) {
              return meta.decorations as DecorationSet;
            }

            // map old decorations through document changes
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
        view(editorView: EditorView) {
          const updateDecorations = () => {
            const { state } = editorView;
            const doc = state.doc;
            const decorations: Decoration[] = [];

            awareness.getStates().forEach((awarenessState: any, clientId: number) => {
              // skip self
              if (clientId === awareness.clientID) return;

              const user = awarenessState.user;
              const cursor = awarenessState.cursor;
              if (!user || !cursor) return;

              const anchor = cursor.anchor;
              const head = cursor.head;
              const from = Math.min(anchor, head);
              const to = Math.max(anchor, head);

              // --- selection highlight ---
              if (from !== to) {
                decorations.push(
                  Decoration.inline(from, to, {
                    style: `
                      background-color: ${user.color}33;
                      border-radius: 2px;
                    `,
                    'data-remote-selection': user.id,
                  } as any)
                );
              }

              // --- cursor + label widget ---
              decorations.push(
                Decoration.widget(head, () => {
                  const wrapper = document.createElement('span');
                  wrapper.style.position = 'relative';

                  const caret = document.createElement('span');
                  caret.style.borderLeft = `2px solid ${user.color}`;
                  caret.style.marginLeft = '-1px';
                  caret.style.marginRight = '-1px';
                  caret.style.height = '1em';
                  caret.style.display = 'inline-block';
                  caret.style.position = 'relative';
                  caret.style.zIndex = '10';

                  const label = document.createElement('div');
                  label.textContent = user.name;
                  label.style.position = 'absolute';
                  label.style.top = '-1.4em';
                  label.style.left = '0';
                  label.style.backgroundColor = user.color;
                  label.style.color = '#fff';
                  label.style.fontSize = '10px';
                  label.style.padding = '2px 4px';
                  label.style.borderRadius = '4px';
                  label.style.whiteSpace = 'nowrap';
                  label.style.boxShadow = '0 1px 2px rgba(0,0,0,0.3)';
                  label.style.transform = 'translateY(-2px)';

                  wrapper.appendChild(caret);
                  wrapper.appendChild(label);

                  return wrapper;
                })
              );
            });

            const decoSet = DecorationSet.create(doc, decorations);
            editorView.dispatch(
              editorView.state.tr.setMeta(pluginKey, { decorations: decoSet })
            );
          };

          const onAwarenessChange = () => {
            updateDecorations();
          };

          awareness.on('update', onAwarenessChange);

          // initial render
          updateDecorations();

          return {
            destroy() {
              awareness.off('update', onAwarenessChange);
            },
          };
        },
      }),
    ];
  },
});
