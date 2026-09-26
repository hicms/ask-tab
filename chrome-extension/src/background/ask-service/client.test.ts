import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@extension/env', () => ({ ASK_SERVICE_URL: 'http://ask.test' }));
vi.mock('@extension/storage', () => ({
  askSessionStorage: { get: vi.fn(async () => null), set: vi.fn(), subscribe: vi.fn() },
  publicModelsStorage: { set: vi.fn() },
  serverModelsStorage: { set: vi.fn() },
}));

const { AskServiceError, requestAnonymous } = await import('./client');

const fetchMock = vi.fn<typeof fetch>();

const reply = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

const failure = async (): Promise<InstanceType<typeof AskServiceError>> => {
  const error = await requestAnonymous('/api/test').catch((err: unknown) => err);
  expect(error).toBeInstanceOf(AskServiceError);
  return error as InstanceType<typeof AskServiceError>;
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('AskServiceError messages', () => {
  it('uses the server error field', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(409, JSON.stringify({ error: 'Telegram is not connected' })),
    );
    const error = await failure();
    expect(error.message).toBe('Telegram is not connected');
    expect(error.status).toBe(409);
  });

  it('uses a Telegram description when there is no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(
        400,
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: can't parse entities",
        }),
      ),
    );
    const error = await failure();
    expect(error.message).toBe("Bad Request: can't parse entities");
    expect(error.status).toBe(400);
  });

  it('prefers the error field over a description', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, JSON.stringify({ error: 'first', description: 'x' })),
    );
    expect((await failure()).message).toBe('first');
  });

  it('falls back to the status for bodies without a message', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, 'not json'));
    expect((await failure()).message).toBe('AskTab server error 500');
    fetchMock.mockResolvedValueOnce(reply(502, JSON.stringify({ description: 42 })));
    expect((await failure()).message).toBe('AskTab server error 502');
  });
});
