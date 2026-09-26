/**
 * Tests for google-calendar.ts — Calendar tool schemas, date handling, response parsing.
 * Mocks googleFetch and getGoogleToken to avoid real API calls.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  executeCalendarList,
  executeCalendarCreate,
  executeCalendarUpdate,
  executeCalendarDelete,
  formatEvent,
} = await import('./google-calendar');

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper tests ──

describe('formatEvent', () => {
  it('formats a full calendar event', () => {
    const event = {
      id: 'evt1',
      summary: 'Team Meeting',
      description: 'Weekly standup',
      location: 'Room 101',
      start: { dateTime: '2026-02-25T10:00:00Z' },
      end: { dateTime: '2026-02-25T11:00:00Z' },
      attendees: [
        { email: 'alice@example.com', responseStatus: 'accepted' },
        { email: 'bob@example.com', responseStatus: 'tentative' },
      ],
      htmlLink: 'https://calendar.google.com/event?eid=xxx',
    };

    const result = formatEvent(event);
    expect(result.id).toBe('evt1');
    expect(result.summary).toBe('Team Meeting');
    expect(result.start).toBe('2026-02-25T10:00:00Z');
    expect(result.end).toBe('2026-02-25T11:00:00Z');
    expect(result.location).toBe('Room 101');
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees[0].email).toBe('alice@example.com');
    expect(result.link).toContain('calendar.google.com');
  });

  it('handles all-day events (date instead of dateTime)', () => {
    const event = {
      id: 'evt2',
      start: { date: '2026-02-25' },
      end: { date: '2026-02-26' },
    };

    const result = formatEvent(event);
    expect(result.start).toBe('2026-02-25');
    expect(result.end).toBe('2026-02-26');
    expect(result.summary).toBe('(no title)');
  });

  it('handles missing optional fields', () => {
    const event = {
      id: 'evt3',
      start: { dateTime: '2026-02-25T09:00:00Z' },
      end: { dateTime: '2026-02-25T10:00:00Z' },
    };

    const result = formatEvent(event);
    expect(result.location).toBe('');
    expect(result.description).toBe('');
    expect(result.attendees).toEqual([]);
    expect(result.link).toBe('');
  });
});

// ── Tool executor tests ──

describe('executeCalendarList', () => {
  it('lists events with defaults', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      items: [
        {
          id: 'evt1',
          summary: 'Meeting',
          start: { dateTime: '2026-02-25T10:00:00Z' },
          end: { dateTime: '2026-02-25T11:00:00Z' },
        },
      ],
      summary: 'My Calendar',
    });

    const result = await executeCalendarList({});
    expect(result.events).toHaveLength(1);
    expect(result.events[0].summary).toBe('Meeting');
    expect(result.calendar).toBe('My Calendar');

    // Verify URL params
    const url = mockGoogleFetch.mock.calls[0][0] as string;
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
  });

  it('returns empty events when no items', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ items: [] });

    const result = await executeCalendarList({});
    expect(result.events).toEqual([]);
  });

  it('uses provided calendarId and time range', async () => {
    mockGoogleFetch.mockResolvedValueOnce({ items: [] });

    await executeCalendarList({
      calendarId: 'work@group.calendar.google.com',
      timeMin: '2026-02-01T00:00:00Z',
      timeMax: '2026-02-28T23:59:59Z',
      maxResults: 5,
    });

    const url = mockGoogleFetch.mock.calls[0][0] as string;
    expect(url).toContain('work%40group.calendar.google.com');
    expect(url).toContain('timeMin=2026-02-01');
    expect(url).toContain('maxResults=5');
  });
});

describe('executeCalendarCreate', () => {
  it('creates an event with all fields', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'new-evt',
      summary: 'Lunch',
      start: { dateTime: '2026-02-25T12:00:00Z' },
      end: { dateTime: '2026-02-25T13:00:00Z' },
      htmlLink: 'https://calendar.google.com/event?eid=new',
    });

    const result = await executeCalendarCreate({
      summary: 'Lunch',
      startTime: '2026-02-25T12:00:00Z',
      endTime: '2026-02-25T13:00:00Z',
      description: 'Team lunch',
      location: 'Cafe',
      attendees: ['alice@example.com'],
    });

    expect(result.status).toBe('created');
    expect(result.id).toBe('new-evt');

    // Verify request body
    const body = JSON.parse(mockGoogleFetch.mock.calls[0][2].body);
    expect(body.summary).toBe('Lunch');
    expect(body.description).toBe('Team lunch');
    expect(body.location).toBe('Cafe');
    expect(body.attendees).toEqual([{ email: 'alice@example.com' }]);
  });

  it('creates an event with minimal fields', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'evt-min',
      summary: 'Quick sync',
      start: { dateTime: '2026-02-25T14:00:00Z' },
      end: { dateTime: '2026-02-25T14:30:00Z' },
    });

    const result = await executeCalendarCreate({
      summary: 'Quick sync',
      startTime: '2026-02-25T14:00:00Z',
      endTime: '2026-02-25T14:30:00Z',
    });

    expect(result.status).toBe('created');
    const body = JSON.parse(mockGoogleFetch.mock.calls[0][2].body);
    expect(body.description).toBeUndefined();
    expect(body.location).toBeUndefined();
    expect(body.attendees).toBeUndefined();
  });
});

describe('executeCalendarUpdate', () => {
  it('patches an event', async () => {
    mockGoogleFetch.mockResolvedValueOnce({
      id: 'evt1',
      summary: 'Updated Meeting',
      start: { dateTime: '2026-02-25T10:00:00Z' },
      end: { dateTime: '2026-02-25T11:30:00Z' },
    });

    const result = await executeCalendarUpdate({
      eventId: 'evt1',
      summary: 'Updated Meeting',
      endTime: '2026-02-25T11:30:00Z',
    });

    expect(result.status).toBe('updated');
    expect(result.summary).toBe('Updated Meeting');

    // Verify PATCH method
    const init = mockGoogleFetch.mock.calls[0][2];
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body);
    expect(body.summary).toBe('Updated Meeting');
    expect(body.end).toEqual({ dateTime: '2026-02-25T11:30:00Z' });
  });
});

describe('executeCalendarDelete', () => {
  it('deletes an event and returns status', async () => {
    mockGoogleFetchRaw.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await executeCalendarDelete({ eventId: 'evt1' });
    expect(result.status).toBe('deleted');
    expect(result.eventId).toBe('evt1');

    // Verify DELETE method
    const init = mockGoogleFetchRaw.mock.calls[0][2];
    expect(init.method).toBe('DELETE');
  });

  it('throws on error response', async () => {
    mockGoogleFetchRaw.mockRejectedValueOnce(new Error('Google API error 404: Not Found'));

    await expect(executeCalendarDelete({ eventId: 'nonexistent' })).rejects.toThrow(
      'Google API error 404',
    );
  });
});
