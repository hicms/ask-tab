import { createContext, useContext, useMemo, useState } from 'react';
import type React from 'react';

/**
 * A single data stream part (delta) coming from the LLM stream.
 *
 * The `type` field uses a `data-` prefix convention matching the ai-chatbot
 * protocol (e.g. `data-id`, `data-title`, `data-kind`, `data-clear`,
 * `data-finish`, `data-chat-title`, or content deltas like `textDelta`,
 * `codeDelta`, etc.).
 */
export type DataStreamDelta = {
  type: string;
  data: unknown;
};

type DataStreamContextValue = {
  dataStream: DataStreamDelta[];
  setDataStream: React.Dispatch<React.SetStateAction<DataStreamDelta[]>>;
};

const DataStreamContext = createContext<DataStreamContextValue | null>(null);

export function DataStreamProvider({ children }: { children: React.ReactNode }) {
  const [dataStream, setDataStream] = useState<DataStreamDelta[]>([]);

  const value = useMemo(() => ({ dataStream, setDataStream }), [dataStream]);

  return <DataStreamContext.Provider value={value}>{children}</DataStreamContext.Provider>;
}

export function useDataStream() {
  const context = useContext(DataStreamContext);
  if (!context) {
    throw new Error('useDataStream must be used within a DataStreamProvider');
  }
  return context;
}
