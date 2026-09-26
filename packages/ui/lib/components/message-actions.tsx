import { Button } from './ui';
import { CopyIcon, PencilIcon } from 'lucide-react';
import { useCallback } from 'react';
import { toast } from 'sonner';

type MessageActionsProps = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  onEdit?: () => void;
};

const MessageActions = ({ role, content, onEdit }: MessageActionsProps) => {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      toast.success('Copied to clipboard');
    });
  }, [content]);

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
      <Button
        className="size-7"
        data-testid="message-copy-button"
        onClick={handleCopy}
        size="icon"
        variant="ghost">
        <CopyIcon className="size-3.5" />
      </Button>
      {role === 'user' && onEdit && (
        <Button
          className="size-7"
          data-testid="message-edit-button"
          onClick={onEdit}
          size="icon"
          variant="ghost">
          <PencilIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
};

export { MessageActions };
export type { MessageActionsProps };
