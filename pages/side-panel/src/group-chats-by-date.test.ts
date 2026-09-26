import { groupChatsByDate } from '@extension/ui';
import { describe, it, expect } from 'vitest';
import type { Chat } from '@extension/shared';

const makeChat = (id: string, updatedAt: number): Chat => ({
  id,
  title: `Chat ${id}`,
  createdAt: updatedAt,
  updatedAt,
});

describe('groupChatsByDate', () => {
  it('groups a chat from today into "today"', () => {
    const now = Date.now();
    const chats = [makeChat('1', now)];
    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(1);
    expect(groups.yesterday).toHaveLength(0);
    expect(groups.lastWeek).toHaveLength(0);
    expect(groups.lastMonth).toHaveLength(0);
    expect(groups.older).toHaveLength(0);
  });

  it('groups a chat from yesterday into "yesterday"', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayChat = todayStart.getTime() - 1; // 1ms before today
    const chats = [makeChat('1', yesterdayChat)];
    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(0);
    expect(groups.yesterday).toHaveLength(1);
  });

  it('groups a chat from 3 days ago into "lastWeek"', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const threeDaysAgo = todayStart.getTime() - 3 * 86400000;
    const chats = [makeChat('1', threeDaysAgo)];
    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(0);
    expect(groups.yesterday).toHaveLength(0);
    expect(groups.lastWeek).toHaveLength(1);
  });

  it('groups a chat from 15 days ago into "lastMonth"', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fifteenDaysAgo = todayStart.getTime() - 15 * 86400000;
    const chats = [makeChat('1', fifteenDaysAgo)];
    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(0);
    expect(groups.yesterday).toHaveLength(0);
    expect(groups.lastWeek).toHaveLength(0);
    expect(groups.lastMonth).toHaveLength(1);
  });

  it('groups a chat from 60 days ago into "older"', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sixtyDaysAgo = todayStart.getTime() - 60 * 86400000;
    const chats = [makeChat('1', sixtyDaysAgo)];
    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(0);
    expect(groups.yesterday).toHaveLength(0);
    expect(groups.lastWeek).toHaveLength(0);
    expect(groups.lastMonth).toHaveLength(0);
    expect(groups.older).toHaveLength(1);
  });

  it('correctly distributes multiple chats across groups', () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const chats = [
      makeChat('today1', Date.now()),
      makeChat('today2', Date.now() - 1000),
      makeChat('yesterday', todayStart.getTime() - 3600000),
      makeChat('week', todayStart.getTime() - 4 * 86400000),
      makeChat('month', todayStart.getTime() - 20 * 86400000),
      makeChat('old1', todayStart.getTime() - 45 * 86400000),
      makeChat('old2', todayStart.getTime() - 90 * 86400000),
    ];

    const groups = groupChatsByDate(chats);

    expect(groups.today).toHaveLength(2);
    expect(groups.yesterday).toHaveLength(1);
    expect(groups.lastWeek).toHaveLength(1);
    expect(groups.lastMonth).toHaveLength(1);
    expect(groups.older).toHaveLength(2);
  });

  it('returns empty groups for empty input', () => {
    const groups = groupChatsByDate([]);

    expect(groups.today).toHaveLength(0);
    expect(groups.yesterday).toHaveLength(0);
    expect(groups.lastWeek).toHaveLength(0);
    expect(groups.lastMonth).toHaveLength(0);
    expect(groups.older).toHaveLength(0);
  });
});
