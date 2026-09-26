import { cn } from '../../utils';
import { parse } from 'papaparse';
import { useEffect, useMemo, useState } from 'react';

type SheetEditorProps = {
  content: string;
  status: 'streaming' | 'idle';
  isCurrentVersion: boolean;
};

const SheetEditor = ({ content, status, isCurrentVersion }: SheetEditorProps) => {
  const [data, setData] = useState<string[][]>([]);

  useEffect(() => {
    if (!content) {
      setData([]);
      return;
    }
    const result = parse<string[]>(content, { skipEmptyLines: true });
    setData(result.data);
  }, [content]);

  const headers = useMemo(() => data[0] ?? [], [data]);
  const rows = useMemo(() => data.slice(1), [data]);

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {status === 'streaming' ? 'Loading spreadsheet...' : 'No data'}
      </div>
    );
  }

  return (
    <div
      className={cn('h-full overflow-auto', !isCurrentVersion && 'pointer-events-none opacity-60')}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                className="bg-muted border-border sticky top-0 border px-3 py-2 text-left font-medium"
                key={i}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td className="border-border border px-3 py-1.5" key={cellIdx}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export { SheetEditor };
