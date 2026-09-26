import { CheckCircleFillIcon, ChevronDownIcon } from './icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui';
import { cn } from '../utils';
import { LockIcon, GlobeIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type VisibilityType = 'private' | 'public';

const visibilities: Array<{
  id: VisibilityType;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: 'private',
    label: 'Private',
    description: 'Only you can access this chat',
    icon: <LockIcon className="size-4" />,
  },
  {
    id: 'public',
    label: 'Public',
    description: 'Anyone with the link can access this chat',
    icon: <GlobeIcon className="size-4" />,
  },
];

export function VisibilitySelector({
  chatId,
  className,
  selectedVisibilityType,
  onVisibilityChange,
}: {
  chatId: string;
  selectedVisibilityType: VisibilityType;
  onVisibilityChange?: (chatId: string, visibility: VisibilityType) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [visibilityType, setVisibilityType] = useState<VisibilityType>(selectedVisibilityType);

  const selectedVisibility = useMemo(
    () => visibilities.find(visibility => visibility.id === visibilityType),
    [visibilityType],
  );

  const handleSelect = (id: VisibilityType) => {
    setVisibilityType(id);
    onVisibilityChange?.(chatId, id);
    setOpen(false);
  };

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground w-fit',
          className,
        )}>
        <Button
          className="hidden h-8 md:flex md:h-fit md:px-2"
          data-testid="visibility-selector"
          variant="outline">
          {selectedVisibility?.icon}
          <span className="md:sr-only">{selectedVisibility?.label}</span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-[300px]">
        {visibilities.map(visibility => (
          <DropdownMenuItem
            className="group/item flex flex-row items-center justify-between gap-4"
            data-active={visibility.id === visibilityType}
            data-testid={`visibility-selector-item-${visibility.id}`}
            key={visibility.id}
            onSelect={() => handleSelect(visibility.id)}>
            <div className="flex flex-col items-start gap-1">
              {visibility.label}
              {visibility.description && (
                <div className="text-muted-foreground text-xs">{visibility.description}</div>
              )}
            </div>
            <div className="text-foreground dark:text-foreground opacity-0 group-data-[active=true]/item:opacity-100">
              <CheckCircleFillIcon />
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
