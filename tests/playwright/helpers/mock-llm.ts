import type { Worker } from '@playwright/test';

type TestStream = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  aborted: boolean;
  closed: boolean;
  /** Raw request body, to check what the model was sent. */
  body: string;
};
type StreamWorker = typeof globalThis & { testStreams: TestStream[] };

const catalog = [
  {
    id: 'custom:background-test',
    modelId: 'background-test',
    name: 'Background Test',
    provider: 'custom',
    supportsTools: false,
    supportsReasoning: true,
  },
];

/**
 * Only the provider transport is mocked; ports, worker, React and IndexedDB are real.
 * Each model call opens a stream that stays open until `emit(..., finish)`.
 */
const installProvider = async (
  worker: Worker,
  options: { supportsTools?: boolean; initialReasoning?: string } = {},
) => {
  await worker.evaluate(async ({ supportsTools = false, initialReasoning = '初始推理。' }) => {
    const target = globalThis as StreamWorker;
    target.testStreams = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/models'))
        return Response.json([
          {
            id: 'background-test',
            name: 'Background Test',
            protocol: 'openai-completions',
            kind: 'chat',
            isDefault: true,
            supportsTools,
            supportsReasoning: true,
            supportsImages: false,
            contextWindow: null,
            embeddingSpaceId: null,
            vendor: null,
            tier: null,
            priceMultiplier: null,
            reasoningControls: [],
          },
        ]);
      if (!url.includes('/api/llm/background-test')) return Response.json([]);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const stream: TestStream = {
            controller,
            aborted: false,
            closed: false,
            body: typeof init?.body === 'string' ? init.body : '',
          };
          target.testStreams.push(stream);
          init?.signal?.addEventListener(
            'abort',
            () => {
              stream.aborted = true;
              if (!stream.closed) controller.error(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
          const event = {
            id: 'response',
            object: 'chat.completion.chunk',
            model: 'background-test',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', reasoning_content: initialReasoning },
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    await chrome.storage.local.set({
      'server-models': [],
      'ask-session': {
        token: 'local-test-only',
        userId: 'test',
        email: 'test@example.invalid',
        expiresAt: Date.now() + 3600000,
      },
    });
  }, options);
};

/** Streams reasoning, or with `finish` the final text, into the model call at `index`. */
const emit = async (worker: Worker, index: number, text: string, finish = false) => {
  await worker.evaluate(
    ({ index, text, finish }) => {
      const stream = (globalThis as StreamWorker).testStreams[index];
      const chunk = {
        id: 'response',
        object: 'chat.completion.chunk',
        model: 'background-test',
        choices: [
          {
            index: 0,
            delta: finish ? { content: text } : { reasoning_content: text },
            finish_reason: finish ? 'stop' : null,
          },
        ],
        ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
      };
      stream.controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      if (finish) {
        stream.controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        stream.closed = true;
        stream.controller.close();
      }
    },
    { index, text, finish },
  );
};

const streamCount = (worker: Worker) =>
  worker.evaluate(() => (globalThis as StreamWorker).testStreams.length);

const abortedStreams = (worker: Worker) =>
  worker.evaluate(() => (globalThis as StreamWorker).testStreams.map(s => s.aborted));

const streamBody = (worker: Worker, index: number) =>
  worker.evaluate(index => (globalThis as StreamWorker).testStreams[index]?.body ?? '', index);

const failStream = (worker: Worker, index: number, message: string) =>
  worker.evaluate(
    ({ index, message }) => {
      const stream = (globalThis as StreamWorker).testStreams[index];
      stream.closed = true;
      stream.controller.error(new Error(message));
    },
    { index, message },
  );

const emitToolCalls = async (
  worker: Worker,
  index: number,
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
) => {
  await worker.evaluate(
    ({ index, calls }) => {
      const stream = (globalThis as StreamWorker).testStreams[index];
      const chunk = {
        id: 'response',
        object: 'chat.completion.chunk',
        model: 'background-test',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      stream.controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`),
      );
      stream.closed = true;
      stream.controller.close();
    },
    { index, calls },
  );
};

export {
  abortedStreams,
  catalog,
  emit,
  emitToolCalls,
  failStream,
  installProvider,
  streamBody,
  streamCount,
};
