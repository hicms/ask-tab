import { ChatAttachmentIcon } from './chat-action-icons';
import { Button } from './ui';

type AttachmentsButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

const AttachmentsButton = ({ onClick, disabled }: AttachmentsButtonProps) => (
  <Button
    className="chat-action-button bg-muted size-8 rounded-lg [&_svg]:size-5"
    data-testid="attachments-button"
    disabled={disabled}
    onClick={onClick}
    size="icon"
    type="button"
    variant="ghost">
    <ChatAttachmentIcon className="size-5" />
  </Button>
);

export { AttachmentsButton };
export type { AttachmentsButtonProps };
