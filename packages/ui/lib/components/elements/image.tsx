import { cn } from '../../utils';

export type ImageProps = {
  base64?: string;
  uint8Array?: Uint8Array;
  mediaType?: string;
  className?: string;
  alt?: string;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const Image = ({ base64, uint8Array, mediaType, className, alt, ...props }: ImageProps) => (
  <img
    alt={alt}
    className={cn('h-auto max-w-full overflow-hidden rounded-md', className)}
    src={`data:${mediaType || 'image/png'};base64,${base64}`}
    {...props}
  />
);
