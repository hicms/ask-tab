import { LoaderIcon } from './icons';
import { Button } from './ui';

export function SubmitButton({
  children,
  isSuccessful,
  isPending = false,
}: {
  children: React.ReactNode;
  isSuccessful: boolean;
  isPending?: boolean;
}) {
  const disabled = isPending || isSuccessful;

  return (
    <Button
      aria-disabled={disabled}
      className="relative"
      disabled={disabled}
      type={isPending ? 'button' : 'submit'}>
      {children}

      {disabled && (
        <span className="absolute right-4 animate-spin">
          <LoaderIcon />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {disabled ? 'Loading' : 'Submit form'}
      </output>
    </Button>
  );
}
