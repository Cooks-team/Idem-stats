import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, readPersistedToken, setToken } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (pseudo: string, password: string) => Promise<void>;
  register: (pseudo: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tok = readPersistedToken();
      if (!tok) { setReady(true); return; }
      try {
        const me = await api.me();
        if (alive) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async (pseudo: string, password: string) => {
    const { token, user } = await api.login(pseudo, password);
    setToken(token);
    setUser(user);
  }, []);

  const register = useCallback(async (pseudo: string, password: string) => {
    const { token, user } = await api.register(pseudo, password);
    setToken(token);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
