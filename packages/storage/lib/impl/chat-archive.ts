import { chatDb } from './chat-db.js';
import { deleteChat } from './chat-storage.js';
import type { DbChat } from './chat-db.js';

const setChatArchived = async (id: string, archived: boolean): Promise<void> => {
  const updated = await chatDb.chats.update(
    id,
    archived ? { archivedAt: Date.now() } : { archivedAt: undefined, updatedAt: Date.now() },
  );
  if (!updated) throw new Error(`Chat not found: ${id}`);
};

const listArchivedChats = async (): Promise<DbChat[]> => {
  const chats = await chatDb.chats.filter(chat => chat.archivedAt !== undefined).toArray();
  return chats.sort((a, b) => b.archivedAt! - a.archivedAt!);
};

/** Recheck the archive state in the deletion transaction in case another page restored a chat. */
const deleteArchivedChats = async (ids: string[]): Promise<void> => {
  await chatDb.transaction(
    'rw',
    [chatDb.chats, chatDb.messages, chatDb.modelTranscripts, chatDb.artifacts],
    async () => {
      for (const id of ids) {
        const chat = await chatDb.chats.get(id);
        if (chat?.archivedAt !== undefined) await deleteChat(id);
      }
    },
  );
};

export { setChatArchived, listArchivedChats, deleteArchivedChats };
