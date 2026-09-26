/**
 * Google Calendar tools — list, create, update, and delete events via Calendar REST API.
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

const calLog = createLogger('tool');

// ── Scopes ──

const CALENDAR_READONLY = 'https://www.googleapis.com/auth/calendar.events.readonly';
const CALENDAR_READWRITE = 'https://www.googleapis.com/auth/calendar.events';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// ── Schemas ──

const calendarListSchema = Type.Object({
  timeMin: Type.Optional(
    Type.String({ description: 'Start of time range in ISO 8601 format (default: now)' }),
  ),
  timeMax: Type.Optional(
    Type.String({ description: 'End of time range in ISO 8601 format (default: 7 days from now)' }),
  ),
  maxResults: Type.Optional(
    Type.Number({ description: 'Maximum number of events (default 20)', default: 20 }),
  ),
  calendarId: Type.Optional(
    Type.String({ description: 'Calendar ID (default: "primary")', default: 'primary' }),
  ),
});

const calendarCreateSchema = Type.Object({
  summary: Type.String({ description: 'Event title' }),
  startTime: Type.String({ description: 'Event start time in ISO 8601 format' }),
  endTime: Type.String({ description: 'Event end time in ISO 8601 format' }),
  description: Type.Optional(Type.String({ description: 'Event description' })),
  location: Type.Optional(Type.String({ description: 'Event location' })),
  attendees: Type.Optional(
    Type.Array(Type.String({ description: 'Attendee email address' }), {
      description: 'List of attendee email addresses',
    }),
  ),
});

const calendarUpdateSchema = Type.Object({
  eventId: Type.String({ description: 'The event ID to update' }),
  calendarId: Type.Optional(
    Type.String({ description: 'Calendar ID (default: "primary")', default: 'primary' }),
  ),
  summary: Type.Optional(Type.String({ description: 'New event title' })),
  startTime: Type.Optional(Type.String({ description: 'New start time in ISO 8601 format' })),
  endTime: Type.Optional(Type.String({ description: 'New end time in ISO 8601 format' })),
  description: Type.Optional(Type.String({ description: 'New event description' })),
  location: Type.Optional(Type.String({ description: 'New event location' })),
  attendees: Type.Optional(
    Type.Array(Type.String(), { description: 'New list of attendee email addresses' }),
  ),
});

const calendarDeleteSchema = Type.Object({
  eventId: Type.String({ description: 'The event ID to delete' }),
  calendarId: Type.Optional(
    Type.String({ description: 'Calendar ID (default: "primary")', default: 'primary' }),
  ),
});

type CalendarListArgs = Static<typeof calendarListSchema>;
type CalendarCreateArgs = Static<typeof calendarCreateSchema>;
type CalendarUpdateArgs = Static<typeof calendarUpdateSchema>;
type CalendarDeleteArgs = Static<typeof calendarDeleteSchema>;

// ── Calendar API types ──

interface CalendarEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: CalendarEventTime;
  end: CalendarEventTime;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  htmlLink?: string;
  status?: string;
}

interface CalendarEventListResponse {
  items?: CalendarEvent[];
  summary?: string;
}

// ── Helpers ──

/** Format a CalendarEvent to a concise result object. */
const formatEvent = (event: CalendarEvent) => ({
  id: event.id,
  summary: event.summary ?? '(no title)',
  start: event.start.dateTime ?? event.start.date ?? '',
  end: event.end.dateTime ?? event.end.date ?? '',
  location: event.location ?? '',
  description: event.description ?? '',
  attendees: event.attendees?.map(a => ({ email: a.email, status: a.responseStatus ?? '' })) ?? [],
  link: event.htmlLink ?? '',
});

// ── Tool executors ──

const executeCalendarList = async (args: CalendarListArgs) => {
  const calendarId = encodeURIComponent(args.calendarId ?? 'primary');
  const timeMin = args.timeMin ?? new Date().toISOString();
  const timeMax = args.timeMax ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxResults = args.maxResults ?? 20;

  calLog.trace('[calendar_list] execute', { calendarId, timeMin, timeMax, maxResults });

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const data = await googleFetch<CalendarEventListResponse>(
    `${CALENDAR_API}/calendars/${calendarId}/events?${params}`,
    [CALENDAR_READONLY],
  );

  const events = (data.items ?? []).map(formatEvent);
  return { events, calendar: data.summary ?? calendarId };
};

const executeCalendarCreate = async (args: CalendarCreateArgs) => {
  calLog.trace('[calendar_create] execute', { summary: args.summary, start: args.startTime });

  const eventBody: Record<string, unknown> = {
    summary: args.summary,
    start: { dateTime: args.startTime },
    end: { dateTime: args.endTime },
  };
  if (args.description) eventBody.description = args.description;
  if (args.location) eventBody.location = args.location;
  if (args.attendees?.length) {
    eventBody.attendees = args.attendees.map(email => ({ email }));
  }

  const event = await googleFetch<CalendarEvent>(
    `${CALENDAR_API}/calendars/primary/events`,
    [CALENDAR_READWRITE],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    },
  );

  return { ...formatEvent(event), status: 'created' };
};

const executeCalendarUpdate = async (args: CalendarUpdateArgs) => {
  const calendarId = encodeURIComponent(args.calendarId ?? 'primary');
  const eventId = encodeURIComponent(args.eventId);

  calLog.trace('[calendar_update] execute', { calendarId, eventId });

  const patch: Record<string, unknown> = {};
  if (args.summary !== undefined) patch.summary = args.summary;
  if (args.description !== undefined) patch.description = args.description;
  if (args.location !== undefined) patch.location = args.location;
  if (args.startTime !== undefined) patch.start = { dateTime: args.startTime };
  if (args.endTime !== undefined) patch.end = { dateTime: args.endTime };
  if (args.attendees !== undefined) {
    patch.attendees = args.attendees.map(email => ({ email }));
  }

  const event = await googleFetch<CalendarEvent>(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    [CALENDAR_READWRITE],
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );

  return { ...formatEvent(event), status: 'updated' };
};

const executeCalendarDelete = async (args: CalendarDeleteArgs) => {
  const calendarId = encodeURIComponent(args.calendarId ?? 'primary');
  const eventId = encodeURIComponent(args.eventId);

  calLog.trace('[calendar_delete] execute', { calendarId, eventId });

  await googleFetchRaw(
    `${CALENDAR_API}/calendars/${calendarId}/events/${eventId}`,
    [CALENDAR_READWRITE],
    { method: 'DELETE' },
  );

  return { eventId: args.eventId, status: 'deleted' };
};

// ── Tool registration ──

const calendarToolDefs: ToolRegistration[] = [
  {
    name: 'calendar_list',
    label: 'Calendar List',
    description:
      'List Google Calendar events within a time range. Returns summary, start/end times, location, attendees, and description.',
    schema: calendarListSchema,
    execute: args => executeCalendarList(args as CalendarListArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'calendar_create',
    label: 'Calendar Create',
    description:
      'Create a Google Calendar event. Requires summary, startTime, and endTime in ISO 8601 format.',
    schema: calendarCreateSchema,
    execute: args => executeCalendarCreate(args as CalendarCreateArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'calendar_update',
    label: 'Calendar Update',
    description:
      'Update an existing Google Calendar event. Requires eventId plus any fields to change.',
    schema: calendarUpdateSchema,
    execute: args => executeCalendarUpdate(args as CalendarUpdateArgs),
    formatResult: jsonFormatResult,
  },
  {
    name: 'calendar_delete',
    label: 'Calendar Delete',
    description: 'Delete a Google Calendar event by event ID.',
    schema: calendarDeleteSchema,
    execute: args => executeCalendarDelete(args as CalendarDeleteArgs),
    formatResult: jsonFormatResult,
  },
];

export {
  calendarListSchema,
  calendarCreateSchema,
  calendarUpdateSchema,
  calendarDeleteSchema,
  executeCalendarList,
  executeCalendarCreate,
  executeCalendarUpdate,
  executeCalendarDelete,
  // Exported for testing
  formatEvent,
  calendarToolDefs,
};
export type { CalendarListArgs, CalendarCreateArgs, CalendarUpdateArgs, CalendarDeleteArgs };
