/**
 * Sheet (spreadsheet / CSV) artifact definition.
 *
 * Ported from ai-chatbot `artifacts/sheet/client.tsx`.
 * - Removed `'use client'` directive
 * - Replaced `@/` imports with `@extension/ui` and relative paths
 * - Uses local `SheetEditor` from `../components/editors/sheet-editor`
 */

import { Artifact } from '../components/create-artifact';
import { SheetEditor } from '../components/editors/sheet-editor';
import { CopyIcon, LineChartIcon, RedoIcon, SparklesIcon, UndoIcon } from '../components/icons';
import { parse, unparse } from 'papaparse';
import { toast } from 'sonner';

type Metadata = Record<string, never>;

export const sheetArtifact = new Artifact<'sheet', Metadata>({
  kind: 'sheet',
  description: 'Useful for working with spreadsheets',
  initialize: () => undefined,
  onStreamPart: ({ setArtifact, streamPart }) => {
    const part = streamPart as { type: string; data: unknown };

    if (part.type === 'data-sheetDelta') {
      setArtifact(draftArtifact => ({
        ...draftArtifact,
        content: part.data as string,
        isVisible: true,
        status: 'streaming',
      }));
    }
  },
  content: ({ content, status, isCurrentVersion }) => (
    <SheetEditor content={content} isCurrentVersion={isCurrentVersion} status={status} />
  ),
  actions: [
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
      icon: <CopyIcon />,
      description: 'Copy as .csv',
      onClick: ({ content }) => {
        const parsed = parse<string[]>(content, { skipEmptyLines: true });

        const nonEmptyRows = parsed.data.filter(row => row.some(cell => cell.trim() !== ''));

        const cleanedCsv = unparse(nonEmptyRows);

        navigator.clipboard.writeText(cleanedCsv);
        toast.success('Copied csv to clipboard!');
      },
    },
  ],
  toolbar: [
    {
      description: 'Format and clean data',
      icon: <SparklesIcon />,
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [{ type: 'text', text: 'Can you please format and clean the data?' }],
        });
      },
    },
    {
      description: 'Analyze and visualize data',
      icon: <LineChartIcon />,
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'Can you please analyze and visualize the data by creating a new code artifact in python?',
            },
          ],
        });
      },
    },
  ],
});
