/**
 * Tests for google-drive.ts — Drive tool schemas, export formats, response parsing.
 * Mocks googleFetch and getGoogleToken to avoid real API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Logger mock ──
vi.mock('../logging/logger-buffer', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── google-auth mock ──
const mockGoogleFetch = vi.fn();
const mockGoogleFetchRaw = vi.fn();
vi.mock('./google-auth', () => ({
  googleFetch: (...args: unknown[]) => mockGoogleFetch(...args),
  googleFetchRaw: (...args: unknown[]) => mockGoogleFetchRaw(...args),
}));

// ── Import after mocks ──
const {
  executeDriveSearch,
  executeDriveRead,
  executeDriveCreate,
  EXPORT_MIME_MAP,
  MAX_DOWNLOAD_SIZE,
} = await import('./google-drive');

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Constants ──

describe('EXPORT_MIME_MAP', () => {
  it('maps Google Docs to text/plain', () => {
    expect(EXPORT_MIME_MAP['application/vnd.google-apps.document']).toBe('text/plain');
  });

  it('maps Google Sheets to text/csv', () => {
    expect(EXPORT_MIME_MAP['application/vnd.google-apps.spreadsheet']).toBe('text/csv');
  });

  it('maps Google Slides to text/plain', () => {
    expect(EXPORT_MIME_MAP['application/vnd.google-apps.presentation']).toBe('text/plain');
  });
});

// ── Tool executor tests ──

describe('executeDriveSearch', () => {
  it('searches files and returns metadata', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      files: [
        {
          id: 'file1',
          name: 'Report.pdf',
          mimeType: 'application/pdf',
          modifiedTime: '2026-02-25T10:00:00Z',
          size: '12345',
          webViewLink: 'https://drive.google.com/file/d/file1/view',
        },
      ],
    });

    const result = await executeDriveSearch({ query: "name contains 'Report'" });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('Report.pdf');
    expect(result.files[0].mimeType).toBe('application/pdf');

    // Verify URL params
    const url = mockGoogleFetch.mock.calls[0][0] as string;
    expect(url).toContain('orderBy=modifiedTime');
  });

  it('returns empty files when no results', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ files: [] });

    const result = await executeDriveSearch({ query: 'nonexistent', maxResults: 5 });
    expect(result.files).toEqual([]);
  });

  it('uses custom maxResults', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ files: [] });

    await executeDriveSearch({ query: 'test', maxResults: 3 });

    const url = mockGoogleFetch.mock.calls[0][0] as string;
    expect(url).toContain('pageSize=3');
  });
});

describe('executeDriveRead', () => {
  it('exports Google Doc as plain text', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'doc1',
      name: 'My Document',
      mimeType: 'application/vnd.google-apps.document',
      size: '0',
    });

    mockGoogleFetchRaw.mockResolvedValueOnce(
      new Response('Document content here', { status: 200 }),
    );

    const result = await executeDriveRead({ fileId: 'doc1' });
    expect(result.name).toBe('My Document');
    expect(result.content).toBe('Document content here');

    const exportUrl = mockGoogleFetchRaw.mock.calls[0][0] as string;
    expect(exportUrl).toContain('/export');
    expect(exportUrl).toContain('mimeType=text%2Fplain');
  });

  it('downloads regular file content', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'file1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: '100',
    });

    mockGoogleFetchRaw.mockResolvedValueOnce(new Response('File content', { status: 200 }));

    const result = await executeDriveRead({ fileId: 'file1' });
    expect(result.content).toBe('File content');

    const downloadUrl = mockGoogleFetchRaw.mock.calls[0][0] as string;
    expect(downloadUrl).toContain('alt=media');
  });

  it('returns error for files exceeding size limit', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'big-file',
      name: 'huge.bin',
      mimeType: 'application/octet-stream',
      size: String(MAX_DOWNLOAD_SIZE + 1),
    });

    const result = await executeDriveRead({ fileId: 'big-file' });
    expect(result.error).toContain('File too large');
    expect(result.content).toBeUndefined();
  });

  it('truncates very large text content', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'doc2',
      name: 'Large Doc',
      mimeType: 'application/vnd.google-apps.document',
    });

    const largeContent = 'x'.repeat(MAX_DOWNLOAD_SIZE + 100);
    mockGoogleFetchRaw.mockResolvedValueOnce(new Response(largeContent, { status: 200 }));

    const result = await executeDriveRead({ fileId: 'doc2' });
    expect(result.truncated).toBe(true);
    expect(result.content!.length).toBe(MAX_DOWNLOAD_SIZE);
  });
});

describe('executeDriveCreate', () => {
  it('creates a file with multipart upload', async () => {
    mockGoogleFetchRaw.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'new-file',
          name: 'test.txt',
          mimeType: 'text/plain',
          webViewLink: 'https://drive.google.com/file/d/new-file/view',
        }),
        { status: 200 },
      ),
    );

    const result = await executeDriveCreate({
      name: 'test.txt',
      content: 'Hello world',
    });

    expect(result.status).toBe('created');
    expect(result.id).toBe('new-file');
    expect(result.name).toBe('test.txt');

    // Verify multipart upload
    const init = mockGoogleFetchRaw.mock.calls[0][2];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toContain('multipart/related');
    expect(init.body).toContain('Hello world');
    expect(init.body).toContain('"name":"test.txt"');
  });

  it('creates a file in a specific folder', async () => {
    mockGoogleFetchRaw.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'new-file-2', name: 'report.md', mimeType: 'text/markdown' }),
        { status: 200 },
      ),
    );

    await executeDriveCreate({
      name: 'report.md',
      content: '# Report',
      mimeType: 'text/markdown',
      folderId: 'folder-123',
    });

    const body = mockGoogleFetchRaw.mock.calls[0][2].body as string;
    expect(body).toContain('"parents":["folder-123"]');
    expect(body).toContain('"mimeType":"text/markdown"');
  });

  it('throws on error response', async () => {
    mockGoogleFetchRaw.mockRejectedValueOnce(new Error('Google API error 403: Quota exceeded'));

    await expect(executeDriveCreate({ name: 'fail.txt', content: 'test' })).rejects.toThrow(
      'Google API error 403',
    );
  });
});
