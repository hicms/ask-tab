import { t } from '@extension/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@extension/ui';

type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  destructive?: boolean;
  onConfirm: () => void;
};

const emptyConfirm: ConfirmDialogState = {
  open: false,
  title: '',
  description: '',
  onConfirm: () => {},
};

const ConfirmDialog = ({ state, onClose }: { state: ConfirmDialogState; onClose: () => void }) => (
  <Dialog open={state.open} onOpenChange={open => !open && onClose()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{state.title}</DialogTitle>
        <DialogDescription>{state.description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose} variant="outline">
          {t('common_cancel')}
        </Button>
        <Button
          onClick={() => {
            state.onConfirm();
            onClose();
          }}
          variant={state.destructive ? 'destructive' : 'default'}>
          {t('common_confirm')}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export { ConfirmDialog, emptyConfirm };
export type { ConfirmDialogState };
