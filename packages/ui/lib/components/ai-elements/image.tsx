import { cn } from '../../utils';

/** Local stub for ai SDK's Experimental_GeneratedImage */
type Experimental_GeneratedImage = {
  base64: string;
  uint8Array: Uint8Array;
  mediaType: string;
};

export type ImageProps = Experimental_GeneratedImage & {
  className?: string;
  alt?: string;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const Image = ({ base64, uint8Array, mediaType, ...props }: ImageProps) => (
  // biome-ignore lint/performance/noImgElement: base64 data URLs require native img
  <img
    {...props}
    alt={props.alt}
    className={cn('h-auto max-w-full overflow-hidden rounded-md', props.className)}
    src={`data:${mediaType};base64,${base64}`}
  />
);
