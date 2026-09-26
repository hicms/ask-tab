/**
 * Google Drive tools — search, read, and create files via Drive REST API.
 *
 * Uses chrome.identity OAuth via the shared google-auth helper.
 * Scopes are requested lazily at tool execution time.
 */

import { googleFetch, googleFetchRaw } from './google-auth';
import { jsonFormatResult } from './tool-registration';
import { createLogger } from '../logging/logger-buffer';
import { Type } from '@sinclair/typebox';
import type { ToolRegistration } from './tool-registration';
import type { Static } from '@sinclair/typebox';

const driveLog = createLogger('tool');

// ── Scopes ──

const DRIVE_METADATA_READONLY = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const DRIVE_READONLY = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Max content size for file downloads (1 MB). */
const MAX_DOWNLOAD_SIZE = 1_048_576;

// ── Schemas ──

const driveSearchSchema = Type.Object({
  query: Type.String({
    description:
      'Drive search query (supports Drive search syntax like "name contains \'report\'", "mimeType=\'application/pdf\'")',
  }),
  maxResults: Type.Optional(
    Type.Number({ description: 'Maximum number of results (default 20)', default: 20 }),
  ),
});

const driveReadSchema = Type.Object({
  fileId: Type.String({ description: 'The Google Drive file ID to read' }),
});

const driveCreateSchema = Type.Object({
  name: Type.String({ description: 'File name' }),
  content: Type.String({ description: 'File content (text)' }),
  mimeType: Type.Optional(
    Type.String({ description: 'MIME type (default: text/plain)', default: 'text/plain' }),
  ),
  folderId: Type.Optional(Type.String({ description: 'Parent folder ID (default: root)' })),
});

type DriveSearchArgs = Static<typeof driveSearchSchema>;
type DriveReadArgs = Static<typeof driveReadSchema>;
type DriveCreateArgs = Static<typeof driveCreateSchema>;

// ── Drive API types ──

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

interface DriveFileListResponse {
  files?: DriveFile[];
}

// ── Helpers ──

/** Google Workspace MIME types that can be exported as plain text. */
const EXPORT_MIME_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

// ── Tool executors ──

const executeDriveSearch = async (args: DriveSearchArgs) => {
  const maxResults = args.maxResults ?? 20;
  driveLog.trace('[drive_search] execute', { query: args.query, maxResults });

  const params = new URLSearchParams({
    q: args.query,
    pageSize: String(maxResults),
    fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const data = await googleFetch<DriveFileListResponse>(`${DRIVE_API}/files?${params}`, [
    DRIVE_METADATA_READONLY,
  ]);

  const files = (data.files ?? []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime ?? '',
    size: f.size ?? '',
    webViewLink: f.webViewLink ?? '',
  }));

  return { files };
};

const executeDriveRead = async (args: DriveReadArgs) => {
  driveLog.trace('[drive_read] execute', { fileId: args.fileId });

  // First get file metadata to determine type
  const meta = await googleFetch<DriveFile>(
    `${DRIVE_API}/files/${encodeURIComponent(args.fileId)}?fields=id,name,mimeType,size`,
    [DRIVE_READONLY],
  );

  const exportMime = EXPORT_MIME_MAP[meta.mimeType];

  let content: string;

  if (exportMime) {
    // Google Workspace file — export as text
    const response = await googleFetchRaw(
      `${DRIVE_API}/files/${encodeURIComponent(args.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      [DRIVE_READONLY],
    );
    content = await response.text();
  } else {
    // Regular file — download content
    const fileSize = parseInt(meta.size ?? '0', 10);
    if (fileSize > MAX_DOWNLOAD_SIZE) {
      return {
        id: meta.id,
        name: meta.name,
        mimeType: meta.mimeType,
        error: `File too large (${fileSize} bytes). Maximum supported size is ${MAX_DOWNLOAD_SIZE} bytes.`,
      };
    }

    const response = await googleFetchRaw(
      `${DRIVE_API}/files/${encodeURIComponent(args.fileId)}?alt=media`,
      [DRIVE_READONLY],
    );
    content = await response.text();
  }

  // Truncate if very large
  const truncated = content.length > MAX_DOWNLOAD_SIZE;
  if (truncated) {
    content = content.slice(0, MAX_DOWNLOAD_SIZE);
  }

  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    content,
    truncated,
  };
};

const executeDriveCreate = async (args: DriveCreateArgs) => {
  driveLog.trace('[drive_create] execute', { name: args.name, mimeType: args.mimeType });

  const mimeType = args.mimeType ?? 'text/plain';
  const metadata: Record<string, unknown> = { name: args.name, mimeType };
  if (args.folderId) {
    metadata.parents = [args.folderId];
  }

  // Use multipart upload
  const boundary = '----AskTabBoundary' + Date.now();

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    args.content,
    `--${boundary}--`,
  ].join('\r\n');

  const response = await googleFetchRaw(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    [DRIVE_FILE],
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );

  const file = (await response.json()) as DriveFile;

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? '',
    status: 'created',
  };
};

// ── Tool registration ──

const driveToolDefs: ToolRegistration[] = [
  {
    name: 'drive_search',
    label: 'Drive Search',
    description:
      'Search Google Drive for files. Supports Drive search syntax. Returns file ID, name, mimeType, modifiedTime, size, and webViewLink.',
    schema: driveSearchSchema,
    execute: args => executeDriveSearch(args as DriveSearchArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'drive_read',
    label: 'Drive Read',
    description:
      'Read content from a Google Drive file. For Google Docs/Sheets/Slides, exports as plain text. For other files, downloads content (with size limit).',
    schema: driveReadSchema,
    execute: args => executeDriveRead(args as DriveReadArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'drive_create',
    label: 'Drive Create',
    description:
      'Create a new file in Google Drive. Requires name and content. Optional mimeType and folderId.',
    schema: driveCreateSchema,
    execute: args => executeDriveCreate(args as DriveCreateArgs),
    formatResult: jsonFormatResult,
  },
];

export {
  driveSearchSchema,
  driveReadSchema,
  driveCreateSchema,
  executeDriveSearch,
  executeDriveRead,
  executeDriveCreate,
  // Exported for testing
  EXPORT_MIME_MAP,
  MAX_DOWNLOAD_SIZE,
  driveToolDefs,
};
export type { DriveSearchArgs, DriveReadArgs, DriveCreateArgs };
