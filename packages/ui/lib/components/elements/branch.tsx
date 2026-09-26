import { cn } from '../../utils';
import { Button } from '../ui';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ComponentProps, HTMLAttributes, ReactElement } from 'react';

type BranchContextType = {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
};

const BranchContext = createContext<BranchContextType | null>(null);
const useBranch = () => {
  const context = useContext(BranchContext);
  if (!context) throw new Error('Branch components must be used within Branch');
  return context;
};

export type BranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};
export const Branch = ({ defaultBranch = 0, onBranchChange, className, ...props }: BranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);
  const handleBranchChange = (newBranch: number) => {
    setCurrentBranch(newBranch);
    onBranchChange?.(newBranch);
  };
  const goToPrevious = () =>
    handleBranchChange(currentBranch > 0 ? currentBranch - 1 : branches.length - 1);
  const goToNext = () =>
    handleBranchChange(currentBranch < branches.length - 1 ? currentBranch + 1 : 0);
  return (
    <BranchContext.Provider
      value={{
        currentBranch,
        totalBranches: branches.length,
        goToPrevious,
        goToNext,
        branches,
        setBranches,
      }}>
      <div className={cn('grid w-full gap-2 [&>div]:pb-0', className)} {...props} />
    </BranchContext.Provider>
  );
};

export const BranchMessages = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => {
  const { currentBranch, setBranches, branches } = useBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]) as ReactElement[],
    [children],
  );
  useEffect(() => {
    if (branches.length !== childrenArray.length) setBranches(childrenArray);
  }, [childrenArray, branches, setBranches]);
  return (
    <>
      {childrenArray.map((branch, index) => (
        <div
          className={cn(
            'grid gap-2 overflow-hidden [&>div]:pb-0',
            index === currentBranch ? 'block' : 'hidden',
          )}
          key={branch.key}
          {...props}>
          {branch}
        </div>
      ))}
    </>
  );
};

export type BranchSelectorProps = HTMLAttributes<HTMLDivElement> & {
  from: 'user' | 'assistant' | 'system';
};
export const BranchSelector = ({ className, from, ...props }: BranchSelectorProps) => {
  const { totalBranches } = useBranch();
  if (totalBranches <= 1) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-2 self-end px-10',
        from === 'assistant' ? 'justify-start' : 'justify-end',
        className,
      )}
      {...props}
    />
  );
};

export const BranchPrevious = ({
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) => {
  const { goToPrevious, totalBranches } = useBranch();
  return (
    <Button
      aria-label="Previous branch"
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground size-7 shrink-0 rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon"
      type="button"
      variant="ghost"
      {...props}>
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export const BranchNext = ({ className, children, ...props }: ComponentProps<typeof Button>) => {
  const { goToNext, totalBranches } = useBranch();
  return (
    <Button
      aria-label="Next branch"
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-foreground size-7 shrink-0 rounded-full transition-colors disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon"
      type="button"
      variant="ghost"
      {...props}>
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export const BranchPage = ({ className, ...props }: HTMLAttributes<HTMLSpanElement>) => {
  const { currentBranch, totalBranches } = useBranch();
  return (
    <span
      className={cn('text-muted-foreground text-xs font-medium tabular-nums', className)}
      {...props}>
      {currentBranch + 1} of {totalBranches}
    </span>
  );
};
