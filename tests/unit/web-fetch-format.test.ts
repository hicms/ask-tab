import { webFetchToolDef } from '../../chrome-extension/src/background/tools/web-fetch';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../chrome-extension/src/background/logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('webFetchToolDef.formatResult', () => {
  it('returns image content block for image/* binary', () => {
    const result = webFetchToolDef.formatResult!({
      isBase64: true,
      text: 'data:image/png;base64,iVBORw0KGgoAAAA',
      mimeType: 'image/png',
      sizeBytes: 1234,
      status: 200,
    });

    expect(result).toEqual({
      content: [{ type: 'image', data: 'iVBORw0KGgoAAAA', mimeType: 'image/png' }],
      details: { mimeType: 'image/png', sizeBytes: 1234 },
    });
  });

  it('returns text metadata for non-image binary', () => {
    const result = webFetchToolDef.formatResult!({
      isBase64: true,
      text: 'data:application/pdf;base64,JVBERi0xLjQ=',
      mimeType: 'application/pdf',
      sizeBytes: 5678,
      status: 200,
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type !== 'text') throw new Error('Expected text content');
    expect(result.content[0].text).toContain('application/pdf');
    expect(result.content[0].text).toContain('5678 bytes');
  });

  it('returns JSON string for text results', () => {
    const textResult = {
      text: 'Some page content extracted from the website.',
      title: 'Test Page',
      status: 200,
    };
    const result = webFetchToolDef.formatResult!(textResult);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    if (result.content[0].type !== 'text') throw new Error('Expected text content');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe('Test Page');
    expect(parsed.text).toContain('Some page content');
  });
});
