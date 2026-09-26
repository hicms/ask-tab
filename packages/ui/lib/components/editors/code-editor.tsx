import { cn } from '../../utils';
import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';

type CodeEditorProps = {
  content: string;
  status: 'streaming' | 'idle';
  isCurrentVersion: boolean;
};

const CodeEditor = ({ content, isCurrentVersion }: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const loadEditor = async () => {
      if (!containerRef.current || viewRef.current) return;

      const { EditorView: View, basicSetup } = await import('codemirror');
      const { EditorState } = await import('@codemirror/state');
      const { javascript } = await import('@codemirror/lang-javascript');
      const { oneDark } = await import('@codemirror/theme-one-dark');

      const isDark = document.documentElement.classList.contains('dark');

      const fontTheme = View.theme({
        '&': { fontSize: '14px' },
        '.cm-gutters': { fontSize: '14px' },
      });

      const state = EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          javascript(),
          View.editable.of(false),
          fontTheme,
          ...(isDark ? [oneDark] : []),
        ],
      });

      viewRef.current = new View({
        state,
        parent: containerRef.current,
      });
    };

    loadEditor();

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update content when it changes
  useEffect(() => {
    if (viewRef.current && content) {
      const currentContent = viewRef.current.state.doc.toString();
      if (currentContent !== content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentContent.length, insert: content },
        });
      }
    }
  }, [content]);

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-auto',
        !isCurrentVersion && 'pointer-events-none opacity-60',
      )}
      ref={containerRef}
    />
  );
};

export { CodeEditor };
