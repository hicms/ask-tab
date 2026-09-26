import { cn } from '../../utils';
import { mermaid } from '@streamdown/mermaid';
import { Streamdown } from 'streamdown';
import type { ComponentProps } from 'react';

type ResponseProps = ComponentProps<typeof Streamdown>;

const mermaidPlugin = mermaid;

const Response = ({ className, children, plugins, ...props }: ResponseProps) => (
  <Streamdown
    className={cn(
      'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto',
      className,
    )}
    plugins={{ mermaid: mermaidPlugin, ...plugins }}
    {...props}>
    {children}
  </Streamdown>
);

export { Response };
