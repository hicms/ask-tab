import { cn } from '../../utils';
import type * as React from 'react';

const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />
);

export { Skeleton };
