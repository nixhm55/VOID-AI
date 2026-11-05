export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type AppSessionRow = {
  id: string;
  user_id: string;
  client_type: 'web' | 'desktop' | 'ios' | 'android';
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  ended_at: string | null;
};

type ConversationRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type MessageRow = {
  id: number;
  conversation_id: string;
  user_id: string;
  client_id: string | null;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  model: string | null;
  metadata: Json;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        Pick<ProfileRow, 'id'> & Partial<Omit<ProfileRow, 'id'>>,
        Partial<ProfileRow>
      >;
      app_sessions: Table<
        AppSessionRow,
        Pick<AppSessionRow, 'id' | 'user_id'> &
          Partial<Omit<AppSessionRow, 'id' | 'user_id'>>,
        Partial<AppSessionRow>
      >;
      conversations: Table<
        ConversationRow,
        Pick<ConversationRow, 'user_id'> &
          Partial<Omit<ConversationRow, 'user_id'>>,
        Partial<ConversationRow>
      >;
      messages: Table<
        MessageRow,
        Pick<MessageRow, 'conversation_id' | 'user_id' | 'role' | 'content'> &
          Partial<Omit<MessageRow, 'conversation_id' | 'user_id' | 'role' | 'content'>>,
        Partial<MessageRow>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
