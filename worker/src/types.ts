export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  REPORT_REALTIME?: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_ORIGINS: string;
  ADMIN_EMAILS: string;
  EDUCATION_PORTALS_INGEST_TOKEN?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export type Variables = {
  user: AuthUser;
};
