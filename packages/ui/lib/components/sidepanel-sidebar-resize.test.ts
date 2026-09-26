import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  clampSidebarWidth,
} from './sidepanel-sidebar';
import { describe, it, expect } from 'vitest';

describe('Sidebar resize constants', () => {
  it('SIDEBAR_DEFAULT_WIDTH is 288 (w-72)', () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(288);
  });

  it('SIDEBAR_MIN_WIDTH is 200', () => {
    expect(SIDEBAR_MIN_WIDTH).toBe(200);
  });

  it('SIDEBAR_MAX_WIDTH is 480', () => {
    expect(SIDEBAR_MAX_WIDTH).toBe(480);
  });

  it('min < default < max', () => {
    expect(SIDEBAR_MIN_WIDTH).toBeLessThan(SIDEBAR_DEFAULT_WIDTH);
    expect(SIDEBAR_DEFAULT_WIDTH).toBeLessThan(SIDEBAR_MAX_WIDTH);
  });
});

describe('clampSidebarWidth', () => {
  it('returns value unchanged when within bounds', () => {
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('clamps to min width when value is too small', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(-50)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('clamps to max width when value is too large', () => {
    expect(clampSidebarWidth(500)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('handles edge values at boundaries', () => {
    expect(clampSidebarWidth(199)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(200)).toBe(200);
    expect(clampSidebarWidth(201)).toBe(201);
    expect(clampSidebarWidth(479)).toBe(479);
    expect(clampSidebarWidth(480)).toBe(480);
    expect(clampSidebarWidth(481)).toBe(SIDEBAR_MAX_WIDTH);
  });
});
