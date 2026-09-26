import { formatFileSize, formatTimeAgo, parseIdentityField } from './agents-config';
import { describe, expect, it } from 'vitest';

describe('AgentsConfig — identity parsing', () => {
  it('parses Name field from IDENTITY.md', () => {
    const content = '- **Name:** Ask\n- **Creature:** AI';
    expect(parseIdentityField(content, 'Name')).toBe('Ask');
  });

  it('parses Emoji field from IDENTITY.md', () => {
    const content = '- **Emoji:** 💬';
    expect(parseIdentityField(content, 'Emoji')).toBe('💬');
  });

  it('parses Creature field from IDENTITY.md', () => {
    const content = '- **Creature:** ghost in the machine';
    expect(parseIdentityField(content, 'Creature')).toBe('ghost in the machine');
  });

  it('parses Vibe field from IDENTITY.md', () => {
    const content = '- **Vibe:** sharp and warm';
    expect(parseIdentityField(content, 'Vibe')).toBe('sharp and warm');
  });

  it('returns (not set) for template placeholders with underscores', () => {
    const content = '- **Name:** _(pick something you like)_';
    expect(parseIdentityField(content, 'Name')).toBe('(not set)');
  });

  it('returns (not set) for missing fields', () => {
    const content = '- **Creature:** AI';
    expect(parseIdentityField(content, 'Name')).toBe('(not set)');
  });

  it('returns (not set) for placeholder with leading underscore only', () => {
    const content = '- **Emoji:** _not decided_';
    expect(parseIdentityField(content, 'Emoji')).toBe('(not set)');
  });
});

describe('AgentsConfig — file metadata helpers', () => {
  it('formatFileSize returns bytes for small content', () => {
    expect(formatFileSize('')).toBe('0 B');
    expect(formatFileSize('hi')).toBe('2 B');
  });

  it('formatFileSize returns KB for larger content', () => {
    const content = 'a'.repeat(2048);
    expect(formatFileSize(content)).toBe('2.0 KB');
  });

  it('formatTimeAgo returns "just now" for recent timestamps', () => {
    expect(formatTimeAgo(Date.now())).toBe('just now');
  });

  it('formatTimeAgo returns minutes for timestamps minutes ago', () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    expect(formatTimeAgo(fiveMinutesAgo)).toBe('5m ago');
  });

  it('formatTimeAgo returns hours for timestamps hours ago', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    expect(formatTimeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('formatTimeAgo returns days for timestamps days ago', () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    expect(formatTimeAgo(threeDaysAgo)).toBe('3d ago');
  });

  it('formatTimeAgo returns months for old timestamps', () => {
    const twoMonthsAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    expect(formatTimeAgo(twoMonthsAgo)).toBe('2mo ago');
  });
});
