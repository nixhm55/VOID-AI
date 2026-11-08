import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';
import {
  loadChatSessions,
  loadLegacyChatSessions,
  removeLegacyChatSessions,
  saveChatSessions,
  type ChatMessage,
  type ChatSession,
} from './chat-storage';
import type { Database, Json } from './database.types';

type ConversationRow = Database['public']['Tables']['conversations']['Row'];
type MessageRow = Database['public']['Tables']['messages']['Row'];

const PAGE_SIZE = 500;
const MESSAGE_BATCH_SIZE = 250;
const persistedMessageHashes = new Map<string, string>();
const sessionWriteQueues = new Map<string, Promise<void>>();

function metadataAttachments(metadata: Json): string[] | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  const attachments = (metadata as Record<string, unknown>).attachments;
  return Array.isArray(attachments)
    ? attachments.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function mergeSessionLists(...lists: ChatSession[][]): ChatSession[] {
  const byId = new Map<string, ChatSession>();
  for (const list of lists) {
    for (const session of list) {
      const previous = byId.get(session.id);
      if (!previous) {
        byId.set(session.id, {
          ...session,
          agentMode:
            session.agentMode ??
            session.messages.some((m) => Boolean(m.agentMode)),
        });
        continue;
      }

      const messages = new Map(previous.messages.map((message) => [message.id, message]));
      for (const message of session.messages) messages.set(message.id, message);
      const mergedMessages = [...messages.values()].sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
      );
      byId.set(session.id, {
        ...previous,
        ...session,
        messages: mergedMessages,
        agentMode:
          previous.agentMode ??
          session.agentMode ??
          mergedMessages.some((m) => Boolean(m.agentMode)),
        pinned: previous.pinned || session.pinned,
        createdAt: Math.min(previous.createdAt, session.createdAt),
        updatedAt: Math.max(previous.updatedAt, session.updatedAt),
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function rowsToSessions(
  conversations: ConversationRow[],
  messages: MessageRow[],
): ChatSession[] {
  const messagesByConversation = new Map<string, ChatMessage[]>();
  for (const row of messages) {
    const metadata = row.metadata;
    const isMetaObj =
      Boolean(metadata) && typeof metadata === 'object' && !Array.isArray(metadata);
    const metaRecord = isMetaObj ? (metadata as Record<string, unknown>) : {};
    const messageId =
      typeof metaRecord.client_message_id === 'string'
        ? metaRecord.client_message_id
        : row.client_id ?? String(row.id);
    const mapped: ChatMessage = {
      id: messageId,
      role: row.role === 'user' ? 'user' : 'assistant',
      text: row.content,
      attachments: metadataAttachments(metadata),
      agentMode: Boolean(metaRecord.agent_mode),
      createdAt: new Date(row.created_at).getTime(),
    };
    const bucket = messagesByConversation.get(row.conversation_id) ?? [];
    bucket.push(mapped);
    messagesByConversation.set(row.conversation_id, bucket);
  }

  return conversations.map((row) => {
    const sortedMsgs = (messagesByConversation.get(row.id) ?? []).sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
    return {
      id: row.client_id ?? row.id,
      title: row.title,
      messages: sortedMsgs,
      agentMode: sortedMsgs.some((m) => Boolean(m.agentMode)),
      pinned: row.pinned,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  });
}

async function readRemoteSessions(userId: string): Promise<ChatSession[]> {
  const supabase = getSupabaseClient();
  const conversations: ConversationRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,user_id,client_id,title,pinned,created_at,updated_at,archived_at')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    conversations.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const messages: MessageRow[] = [];
  for (let offset = 0; offset < conversations.length; offset += PAGE_SIZE) {
    const ids = conversations.slice(offset, offset + PAGE_SIZE).map((row) => row.id);
    for (let rowOffset = 0; ; rowOffset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('messages')
        .select('id,conversation_id,user_id,client_id,role,content,model,metadata,created_at')
        .eq('user_id', userId)
        .in('conversation_id', ids)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(rowOffset, rowOffset + PAGE_SIZE - 1);
      if (error) throw error;
      messages.push(...data);
      if (data.length < PAGE_SIZE) break;
    }
  }
  return rowsToSessions(conversations, messages);
}

async function persistSession(
  userId: string,
  session: ChatSession,
  onlyChangedMessages: boolean,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .upsert(
      {
        user_id: userId,
        client_id: session.id,
        title: session.title || 'New chat',
        pinned: session.pinned,
        created_at: new Date(session.createdAt).toISOString(),
        updated_at: new Date(session.updatedAt).toISOString(),
      },
      { onConflict: 'user_id,client_id' },
    )
    .select('id')
    .single();
  if (conversationError) throw conversationError;

  const messages = session.messages.filter((message) => {
    const key = `${userId}:${session.id}:${message.id}`;
    const hash = JSON.stringify(message);
    return !onlyChangedMessages || persistedMessageHashes.get(key) !== hash;
  });

  for (let offset = 0; offset < messages.length; offset += MESSAGE_BATCH_SIZE) {
    const batch = messages.slice(offset, offset + MESSAGE_BATCH_SIZE).map((message) => ({
      conversation_id: conversation.id,
      user_id: userId,
      client_id: `${session.id}:${message.id}`,
      role: message.role,
      content: message.text,
      model: session.modelKey ?? null,
      metadata: {
        client_message_id: message.id,
        attachments: message.attachments ?? [],
        agent_mode: Boolean(message.agentMode ?? session.agentMode),
      } as Json,
      created_at: new Date(message.createdAt ?? session.updatedAt).toISOString(),
    }));

    const { error } = await supabase
      .from('messages')
      .upsert(batch, { onConflict: 'user_id,client_id' });
    if (error) throw error;
    for (const message of messages.slice(offset, offset + MESSAGE_BATCH_SIZE)) {
      persistedMessageHashes.set(
        `${userId}:${session.id}:${message.id}`,
        JSON.stringify(message),
      );
    }
  }
}

function enqueueSessionWrite(
  userId: string,
  session: ChatSession,
  onlyChangedMessages: boolean,
): Promise<void> {
  const queueKey = `${userId}:${session.id}`;
  const previous = sessionWriteQueues.get(queueKey) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => persistSession(userId, session, onlyChangedMessages));
  sessionWriteQueues.set(queueKey, current);
  void current.then(
    () => {
      if (sessionWriteQueues.get(queueKey) === current) {
        sessionWriteQueues.delete(queueKey);
      }
    },
    () => {
      if (sessionWriteQueues.get(queueKey) === current) {
        sessionWriteQueues.delete(queueKey);
      }
    },
  );
  return current;
}

export async function persistChatSessions(
  userId: string,
  sessions: ChatSession[],
): Promise<void> {
  for (const session of sessions) {
    await enqueueSessionWrite(userId, session, false);
  }
}

export async function persistChangedChatSessions(
  userId: string,
  sessions: ChatSession[],
): Promise<void> {
  for (const session of sessions) {
    await enqueueSessionWrite(userId, session, true);
  }
}

export async function loadAndMigrateChatHistory(
  userId: string,
): Promise<{ sessions: ChatSession[]; warning: string | null }> {
  const userCache = loadChatSessions(userId);
  const legacyCache = loadLegacyChatSessions();
  const localSessions = mergeSessionLists(userCache, legacyCache);

  try {
    await persistChatSessions(userId, localSessions);
    if (legacyCache.length > 0) removeLegacyChatSessions();
    const remoteSessions = await readRemoteSessions(userId);
    const sessions = mergeSessionLists(remoteSessions, localSessions);
    saveChatSessions(sessions, userId);
    return { sessions, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat history sync failed.';
    saveChatSessions(localSessions, userId);
    return {
      sessions: localSessions,
      warning: `Chat history is saved on this device and will retry syncing. ${message}`,
    };
  }
}

export async function refreshChatHistory(userId: string): Promise<ChatSession[]> {
  return readRemoteSessions(userId);
}

export function subscribeToChatHistory(
  userId: string,
  onChange: () => void,
): RealtimeChannel {
  return getSupabaseClient()
    .channel(`chat-history:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${userId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `user_id=eq.${userId}` },
      onChange,
    )
    .subscribe();
}

export async function deleteChatHistoryItem(
  userId: string,
  clientConversationId: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('conversations')
    .delete()
    .eq('user_id', userId)
    .eq('client_id', clientConversationId);
  if (error) throw error;
  const keyPrefix = `${userId}:${clientConversationId}:`;
  for (const key of persistedMessageHashes.keys()) {
    if (key.startsWith(keyPrefix)) persistedMessageHashes.delete(key);
  }
  saveChatSessions(
    loadChatSessions(userId).filter((session) => session.id !== clientConversationId),
    userId,
  );
}

export async function deleteAllChatHistory(userId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('conversations')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
  const keyPrefix = `${userId}:`;
  for (const key of persistedMessageHashes.keys()) {
    if (key.startsWith(keyPrefix)) persistedMessageHashes.delete(key);
  }
  saveChatSessions([], userId);
}

export function mergeChatHistory(
  current: ChatSession[],
  incoming: ChatSession[],
): ChatSession[] {
  return mergeSessionLists(current, incoming);
}
