export interface AuthUser {
  id: number | string;
  name: string;
  role: 'admin' | 'technician' | 'manager' | 'supervisor' | string;
  phone?: string;
  email?: string;
  avatar_url?: string;
}

export type LoginSuccessHandler = (user: AuthUser, token: string) => void;
