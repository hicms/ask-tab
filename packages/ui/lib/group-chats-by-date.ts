import type { Chat } from '@extension/shared';

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const oneWeekAgo = new Date(todayStart.getTime() - 7 * 86400000);
  const oneMonthAgo = new Date(todayStart.getTime() - 30 * 86400000);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.updatedAt);

      if (chatDate >= todayStart) {
        groups.today.push(chat);
      } else if (chatDate >= yesterdayStart) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats,
  );
};

export { groupChatsByDate };
export type { GroupedChats };
