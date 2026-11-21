import { CHAT_MESSAGE_MAX_BODY_LENGTH, CHAT_MESSAGE_MAX_MENTIONED_USERS } from '@aula/contracts';

// Approved for issue #38. Enforcement belongs to the REST send path.
export const CHAT_MAX_BODY_LENGTH = CHAT_MESSAGE_MAX_BODY_LENGTH;
export const CHAT_MAX_MENTIONED_USERS = CHAT_MESSAGE_MAX_MENTIONED_USERS;
export const CHAT_RATE_LIMIT_MAX_MESSAGES = 5;
export const CHAT_RATE_LIMIT_WINDOW_MS = 10_000;
export const CHAT_MENTION_SOURCE_TYPE = 'message';

// Inbox (#124): bounded, unpaginated summary list and short previews.
export const CHAT_INBOX_MAX_CLASSROOMS = 100;
export const CHAT_INBOX_PREVIEW_MAX_LENGTH = 120;
