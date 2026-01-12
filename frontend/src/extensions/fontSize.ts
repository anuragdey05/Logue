import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Mark.create({
  name: 'fontSize',

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-font-size') || element.style.fontSize || null,
        renderHTML: (attributes) => {
          if (!attributes.size) return {};
          return {
            'data-font-size': attributes.size,
            style: `font-size: ${attributes.size}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-font-size]' },
      { style: 'font-size' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { size, ...rest } = HTMLAttributes;
    if (!size) {
      return ['span', mergeAttributes(rest), 0];
    }
    return [
      'span',
      mergeAttributes(rest, {
        'data-font-size': size,
        style: `font-size: ${size}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark(this.name, { size }).run(),
      unsetFontSize: () => ({ chain }) => chain().unsetMark(this.name).run(),
    };
  },
});
