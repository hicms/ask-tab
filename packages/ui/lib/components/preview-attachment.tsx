import { cn } from '../utils';
import { Loader2Icon, XIcon } from 'lucide-react';
import type { Attachment } from '@extension/shared';

type PreviewAttachmentProps = {
  attachment: Attachment;
  isUploading?: boolean;
  onRemove?: () => void;
};

const PreviewAttachment = ({ attachment, isUploading, onRemove }: PreviewAttachmentProps) => {
  const { name, url, contentType } = attachment;
  const isImage = contentType.startsWith('image/');

  return (
    <div className="group relative" data-testid="input-attachment-preview">
      <div className="border-border bg-muted relative flex size-16 items-center justify-center overflow-hidden rounded-md border">
        {isImage ? (
          <img alt={name} className="size-full object-cover" src={url} />
        ) : (
          <span className="text-muted-foreground text-xs font-medium">File</span>
        )}

        {isUploading && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/50"
            data-testid="input-attachment-loader">
            <Loader2Icon className="size-4 animate-spin text-white" />
          </div>
        )}
      </div>

      {onRemove && !isUploading && (
        <button
          className={cn(
            'absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full',
            'bg-destructive text-destructive-foreground opacity-0 transition-opacity',
            'group-hover:opacity-100',
          )}
          onClick={onRemove}
          type="button">
          <XIcon className="size-3" />
        </button>
      )}

      <div className="text-muted-foreground mt-0.5 max-w-16 truncate text-center text-[10px]">
        {name}
      </div>
    </div>
  );
};

export { PreviewAttachment };
export type { PreviewAttachmentProps };
