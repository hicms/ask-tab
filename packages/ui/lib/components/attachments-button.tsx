import { ChatAttachmentIcon } from './chat-action-icons';
import { Button } from './ui';

type AttachmentsButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

const AttachmentsButton = ({ onClick, disabled }: AttachmentsButtonProps) => (
  <Button
    className="chat-action-button size-8"
    data-testid="attachments-button"
    disabled={disabled}
    onClick={onClick}
    size="icon"
    type="button"
    variant="ghost">
    <ChatAttachmentIcon className="size-4" />
  </Button>
);

export { AttachmentsButton };
export type { AttachmentsButtonProps };
