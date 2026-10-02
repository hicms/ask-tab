import { cn } from '../../utils';
import { cjk } from '@streamdown/cjk';
import { mermaid } from '@streamdown/mermaid';
import remarkBreaks from 'remark-breaks';
import { defaultRemarkPlugins, Streamdown } from 'streamdown';
import type { ComponentProps } from 'react';

type ResponseProps = ComponentProps<typeof Streamdown>;

const mermaidPlugin = mermaid;
const userRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks];
const userPlugins = { cjk };

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

// Submitted user text is complete: preserve its Markdown and soft line breaks without
// the streaming renderer repairing literal, unfinished delimiters.
const UserResponse = ({ children }: Pick<ResponseProps, 'children'>) => (
  <Response mode="static" plugins={userPlugins} remarkPlugins={userRemarkPlugins}>
    {children}
  </Response>
);

export { Response, UserResponse };
