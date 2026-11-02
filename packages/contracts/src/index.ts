export interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export type UserRole = 'TEACHER' | 'STUDENT' | 'PARENT' | 'SCHOOL_ADMIN';
