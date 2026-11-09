export const DEFAULT_INITIAL_DESK_COUNT = 12;

export const DEFAULT_PET_NAME = 'Michi';

export const DEFAULT_PET_SPECIES = 'cat';

export const DEFAULT_CLASSROOM_CONTROL_STATES = {
  adultMode: false,
  chatMuted: false,
  collaborationLocked: false,
  gamesDisabled: false,
} as const;

export const CLASSROOM_ACCESS_ROLES = ['OWNER', 'ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as const;

export const CLASSROOM_CAPABILITIES = [
  'manage_school',
  'configure_classroom',
  'invite_members',
  'publish_content',
  'moderate_chat',
  'configure_bot',
  'view_metrics',
  'participate_activities',
  'chat_classmates',
  'list_directory',
  'message_teacher',
] as const;
