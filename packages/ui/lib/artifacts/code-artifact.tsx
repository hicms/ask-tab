/**
 * Code artifact definition.
 *
 * Ported from ai-chatbot `artifacts/code/client.tsx`.
 * - Removed `'use client'` directive
 * - Replaced `@/` imports with `@extension/ui` and relative paths
 * - Removed Pyodide-based code execution (not available in extension context)
 * - Simplified Console output type to a local definition
 */

import { Artifact } from '../components/create-artifact';
import { CodeEditor } from '../components/editors/code-editor';
import { CopyIcon, LogsIcon, MessageIcon, RedoIcon, UndoIcon } from '../components/icons';
import { toast } from 'sonner';

type Metadata = {
  outputs: Array<{
    id: string;
    contents: Array<{ type: 'text' | 'image'; value: string }>;
    status: 'in_progress' | 'loading_packages' | 'completed' | 'failed';
  }>;
};

export const codeArtifact = new Artifact<'code', Metadata>({
  kind: 'code',
  description: 'Useful for code generation; Code execution is only available for python code.',
  initialize: ({ setMetadata }) => {
    setMetadata({
      outputs: [],
    });
  },
  onStreamPart: ({ streamPart, setArtifact }) => {
    const part = streamPart as { type: string; data: unknown };

    if (part.type === 'data-codeDelta') {
      setArtifact(draftArtifact => ({
        ...draftArtifact,
        content: part.data as string,
        isVisible:
          draftArtifact.status === 'streaming' &&
          draftArtifact.content.length > 300 &&
          draftArtifact.content.length < 310
            ? true
            : draftArtifact.isVisible,
        status: 'streaming',
      }));
    }
  },
  content: ({ content, status, isCurrentVersion }) => (
    <div className="px-1">
      <CodeEditor content={content} isCurrentVersion={isCurrentVersion} status={status} />
    </div>
  ),
  actions: [
    // NOTE: The ai-chatbot reference has a "Run" action that uses Pyodide to
    // execute Python in-browser.  That is not applicable in the extension
    // context, so it has been omitted.  It can be re-added later if a sandbox
    // execution environment becomes available.
    {
      icon: <UndoIcon size={18} />,
      description: 'View Previous version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('prev');
      },
      isDisabled: ({ currentVersionIndex }) => currentVersionIndex === 0,
    },
    {
      icon: <RedoIcon size={18} />,
      description: 'View Next version',
      onClick: ({ handleVersionChange }) => {
        handleVersionChange('next');
      },
      isDisabled: ({ isCurrentVersion }) => isCurrentVersion,
    },
    {
      icon: <CopyIcon size={18} />,
      description: 'Copy code to clipboard',
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast.success('Copied to clipboard!');
      },
    },
  ],
  toolbar: [
    {
      icon: <MessageIcon />,
      description: 'Add comments',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Add comments to the code snippet for understanding',
            },
          ],
        });
      },
    },
    {
      icon: <LogsIcon />,
      description: 'Add logs',
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Add logs to the code snippet for debugging',
            },
          ],
        });
      },
    },
  ],
});
