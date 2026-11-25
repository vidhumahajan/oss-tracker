import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

// Holds "who is logged in" for the whole app, so any component can ask
// with useAuth() without passing the user down through every level.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Why the server ended this browser's login, for example "signed_in_elsewhere".
  // The server only says it once, so we keep it here for the home page to show.
  const [loggedOutReason, setLoggedOutReason] = useState(null);

  // Ask the server who we are. The login cookie itself is invisible to
  // JavaScript (httpOnly), so asking is the only way to know.
  const refresh = useCallback(async () => {
    try {
      const data = await api("/auth/me");
      setUser(data.user);
      setLoggedOutReason(data.reason || null);
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
    <AuthContext.Provider value={{ user, setUser, loading, refresh, logout, loggedOutReason }}>
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
