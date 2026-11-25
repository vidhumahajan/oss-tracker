import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

// Holds "who is logged in" for the whole app, so any component can ask
// with useAuth() without passing the user down through every level.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Ask the server who we are. The login cookie itself is invisible to
  // JavaScript (httpOnly), so asking is the only way to know.
  const refresh = useCallback(async () => {
    try {
      const data = await api("/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// The address that starts a GitHub login and returns to the given page afterwards.
export function loginUrl(next = window.location.pathname) {
  return `/api/auth/github?next=${encodeURIComponent(next)}`;
}
