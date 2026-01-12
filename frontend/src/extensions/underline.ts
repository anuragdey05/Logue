import { Mark, mergeAttributes } from '@tiptap/core';

// declare module '@tiptap/core' {
//   interface Commands<ReturnType> {
//     underline: {
//       toggleUnderline: () => ReturnType;
//     };
//   }
// }

export const Underline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [
      { tag: 'u' },
      { style: 'text-decoration=underline' },
      { style: 'text-decoration-line=underline' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { style: 'text-decoration: underline' }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});
