import { Extension } from '@tiptap/core';

export type SlashCommandId = 'scene' | 'dialogue' | 'action';

type CommandRange = { from: number; to: number };

type CommandContext = {
  /** Raw text that followed the slash command keyword */
  query: string;
};

export interface SlashCommandsOptions {
  onOpenMenu: (range: CommandRange) => void;
  onSelectCommand: (
    command: SlashCommandId,
    range: CommandRange,
    context?: CommandContext
  ) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slashCommands: {
      /**
       * Open the slash-command menu UI in the host application.
       */
      openSlashMenu: () => ReturnType;
    };
  }
}

/**
 * Minimal extension that listens for the `\` key and asks the
 * hosting React component to show a slash-commands menu.
 */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return {
      onOpenMenu: () => {},
      onSelectCommand: () => {},
    };
  },

  addCommands() {
    return {
      openSlashMenu:
        () => () => {
          const { state } = this.editor;
          const { from, to } = state.selection;
          this.options.onOpenMenu({ from, to });
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const getCommandMatch = () => {
      const { state } = this.editor;
      const { $from } = state.selection;
      const parent = $from.parent;
      if (parent.type.name !== 'paragraph') return null;
      const text = parent.textContent ?? '';
      const trimmed = text.trim();
      if (!trimmed.startsWith('\\')) return null;
      const body = trimmed.slice(1);
      const [raw] = body.split(/\s+/);
      if (!raw) return null;
      const key = raw.toLowerCase() as SlashCommandId;
      if (!['scene', 'dialogue', 'action'].includes(key)) return null;
      const query = body.slice(raw.length).trim();
      return {
        command: key,
        range: { from: $from.start(), to: $from.end() },
        context: { query },
      };
    };

    return {
      '\\': () => this.editor.commands.openSlashMenu(),
      Enter: () => {
        const match = getCommandMatch();
        if (!match) return false;
        this.options.onSelectCommand(match.command, match.range, match.context);
        return true;
      },
    };
  },
});
