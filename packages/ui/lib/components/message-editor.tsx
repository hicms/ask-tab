import { Button, Textarea } from './ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

type MessageEditorProps = {
  initialContent: string;
  onSend: (content: string) => void;
  onCancel: () => void;
};

const MessageEditor = ({ initialContent, onSend, onCancel }: MessageEditorProps) => {
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed) return;
    onSend(trimmed);
  }, [content, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="flex w-full flex-col gap-2" data-testid="message-editor">
      <Textarea
        className="min-h-[80px] resize-none"
        ref={textareaRef}
        onChange={e => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        value={content}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          data-testid="message-editor-send-button"
          disabled={!content.trim()}
          onClick={handleSend}
          size="sm">
          Send
        </Button>
      </div>
    </div>
  );
};

export { MessageEditor };
export type { MessageEditorProps };
