import { vendorArt } from './model-vendor-art';
import { cn } from '../utils';
import { BotIcon } from 'lucide-react';
import { useId } from 'react';

type ModelVendorIconProps = {
  vendor?: string;
  className?: string;
};

const ModelVendorIcon = ({ vendor, className }: ModelVendorIconProps) => {
  // React 19.1 IDs look like «r0»; keep only characters that are safe inside url(#…).
  const id = `vendor-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const known = vendor && Object.hasOwn(vendorArt, vendor) ? vendorArt[vendor] : undefined;
  const label = known?.company ?? vendor;
  return (
    <span
      className="inline-flex shrink-0 items-center"
      data-vendor={known ? vendor : 'unknown'}
      {...(label ? { 'aria-label': label, role: 'img', title: label } : { 'aria-hidden': true })}>
      {known ? (
        <svg aria-hidden className={cn('size-3.5', className)} viewBox="0 0 24 24" {...known.svg}>
          {known.art(id)}
        </svg>
      ) : (
        <BotIcon aria-hidden className={cn('text-muted-foreground size-3.5', className)} />
      )}
    </span>
  );
};

export { ModelVendorIcon };
