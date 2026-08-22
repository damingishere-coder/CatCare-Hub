export type AccessRole = "admin" | "mobile";

export interface AuthSession {
  role: AccessRole;
  expires_at: string;
}
