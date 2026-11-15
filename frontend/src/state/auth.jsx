import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => window.localStorage.getItem('raceproof_token'));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem('raceproof_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(token));

  const logout = useCallback(() => {
    window.localStorage.removeItem('raceproof_token');
    window.localStorage.removeItem('raceproof_user');
    setToken(null);
    setUser(null);
    setLoading(false);
  }, []);

  const establish = useCallback((nextToken, nextUser) => {
    window.localStorage.setItem('raceproof_token', nextToken);
    window.localStorage.setItem('raceproof_user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    authApi.me().then((profile) => {
      if (!active) return;
      setUser(profile);
      window.localStorage.setItem('raceproof_user', JSON.stringify(profile));
    }).catch(logout).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token, logout]);

  useEffect(() => {
    window.addEventListener('raceproof:unauthorized', logout);
    return () => window.removeEventListener('raceproof:unauthorized', logout);
  }, [logout]);

  const value = useMemo(() => ({ token, user, loading, login: establish, logout, setUser }), [token, user, loading, establish, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
