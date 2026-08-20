import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

export function createMarkdownEditor({ element, content = '', onChange = () => {} }) {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
        },
      }),
      Image.configure({ allowBase64: false, inline: false }),
      TableKit.configure({
        table: { resizable: true },
      }),
      Markdown.configure({
        markedOptions: { gfm: true, breaks: true },
      }),
    ],
    content,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'writing-surface',
        'aria-label': '게시글 본문 편집기',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    onSelectionUpdate: ({ editor }) => {
      element.dispatchEvent(new CustomEvent('editor-selection-change', { detail: editor }));
    },
  });
}

export function setMarkdown(editor, markdown, emitUpdate = false) {
  return editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate });
}

export function runEditorCommand(editor, command, value) {
  const chain = editor.chain().focus();
  const commands = {
    undo: () => chain.undo().run(),
    redo: () => chain.redo().run(),
    bold: () => chain.toggleBold().run(),
    italic: () => chain.toggleItalic().run(),
    strike: () => chain.toggleStrike().run(),
    heading2: () => chain.toggleHeading({ level: 2 }).run(),
    heading3: () => chain.toggleHeading({ level: 3 }).run(),
    bulletList: () => chain.toggleBulletList().run(),
    orderedList: () => chain.toggleOrderedList().run(),
    blockquote: () => chain.toggleBlockquote().run(),
    code: () => chain.toggleCode().run(),
    codeBlock: () => chain.toggleCodeBlock().run(),
    horizontalRule: () => chain.setHorizontalRule().run(),
    table: () => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    link: () => {
      if (!value) return false;
      return chain.extendMarkRange('link').setLink({ href: value }).run();
    },
    unlink: () => chain.unsetLink().run(),
  };
  return commands[command]?.() ?? false;
}

export function insertEditorImage(editor, { src, alt = '', title = null }) {
  return editor.chain().focus().setImage({ src, alt, title }).run();
}

export function isCommandActive(editor, command) {
  const active = {
    bold: () => editor.isActive('bold'),
    italic: () => editor.isActive('italic'),
    strike: () => editor.isActive('strike'),
    heading2: () => editor.isActive('heading', { level: 2 }),
    heading3: () => editor.isActive('heading', { level: 3 }),
    bulletList: () => editor.isActive('bulletList'),
    orderedList: () => editor.isActive('orderedList'),
    blockquote: () => editor.isActive('blockquote'),
    code: () => editor.isActive('code'),
    codeBlock: () => editor.isActive('codeBlock'),
    link: () => editor.isActive('link'),
  };
  return active[command]?.() ?? false;
}
