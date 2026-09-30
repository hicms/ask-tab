import { ChatAttachmentIcon } from './chat-action-icons';
import { Button } from './ui';

type AttachmentsButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

const AttachmentsButton = ({ onClick, disabled }: AttachmentsButtonProps) => (
  <Button
    className="chat-action-button bg-muted size-10 shrink-0 rounded-lg [&_svg]:size-7"
    data-testid="attachments-button"
    disabled={disabled}
    onClick={onClick}
    size="icon"
    type="button"
    variant="ghost">
    <ChatAttachmentIcon className="size-7" />
  </Button>
);

export { AttachmentsButton };
export type { AttachmentsButtonProps };
