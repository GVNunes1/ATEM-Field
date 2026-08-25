export interface AuthUser {
  id: number | string;
  name: string;
  role: 'admin' | 'technician';
  phone?: string;
  email?: string;
  avatar_url?: string;
}

export type LoginSuccessHandler = (user: AuthUser, token: string) => void;
