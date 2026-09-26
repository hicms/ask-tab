import { Button } from './ui';
import { PaperclipIcon } from 'lucide-react';

type AttachmentsButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

const AttachmentsButton = ({ onClick, disabled }: AttachmentsButtonProps) => (
  <Button
    className="size-8"
    data-testid="attachments-button"
    disabled={disabled}
    onClick={onClick}
    size="icon"
    type="button"
    variant="ghost">
    <PaperclipIcon className="size-4 -rotate-45" />
  </Button>
);

export { AttachmentsButton };
export type { AttachmentsButtonProps };
