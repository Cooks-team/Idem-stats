import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, cacheUser, readCachedUser, readPersistedToken, setToken } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  ready: boolean;
  login: (pseudo: string, password: string) => Promise<void>;
  register: (pseudo: string, password: string) => Promise<void>;
  logout: () => void;
  // Exposé pour qu'un sous-composant (ProfilePage upload) puisse mettre à jour le user
  // courant après un POST /me/avatar — évite un round-trip via /me.
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Restauration optimiste : si on a un user en cache localStorage, on l'affiche
  // tout de suite pour éviter le flash login → home. La validation se fait en
  // arrière-plan via /me.
  const [user, setUserState] = useState<User | null>(() => {
    const tok = readPersistedToken();
    if (!tok) return null;
    return readCachedUser();
  });
  const [ready, setReady] = useState(false);

  // setUser sync les caches localStorage en plus du state React, pour que
  // le solde de coins / pseudo modifié survive au reload.
  const setUser = useCallback((u: User) => {
    setUserState(u);
    cacheUser(u);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tok = readPersistedToken();
      if (!tok) { setReady(true); return; }
      try {
        const me = await api.me();
        if (alive) setUser(me);
      } catch (e) {
        // Distingue les cas pour ne pas virer le token à la moindre erreur :
        //  - 401 (token invalide / user disparu)        → on dégage
        //  - 403 (interdit, ne devrait pas arriver ici) → on dégage aussi
        //  - autre (réseau, 500, timeout, CORS…)         → on garde, on
        //    revalidera plus tard. L'user reste connecté via le cache.
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 401 || status === 403) {
          setToken(null);
          cacheUser(null);
          if (alive) setUserState(null);
        }
        // Sinon : on ne touche à rien, l'user reste sur l'app avec ses données
        // cachées. La prochaine requête réussie le confirmera.
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [setUser]);

  const login = useCallback(async (pseudo: string, password: string) => {
    const { token, user } = await api.login(pseudo, password);
    setToken(token);
    setUser(user);
  }, [setUser]);

  const register = useCallback(async (pseudo: string, password: string) => {
    const { token, user } = await api.register(pseudo, password);
    setToken(token);
    setUser(user);
  }, [setUser]);

  const logout = useCallback(() => {
    setToken(null);
    cacheUser(null);
    setUserState(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, setUser }),
    [user, ready, login, register, logout, setUser],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
