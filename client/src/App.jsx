import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Leaderboard from "./pages/Leaderboard.jsx";
import Profile from "./pages/Profile.jsx";
import Settings from "./pages/Settings.jsx";
import Privacy from "./pages/Privacy.jsx";
import Mentors from "./pages/Mentors.jsx";
import NotFound from "./pages/NotFound.jsx";

// The admin panel is loaded only when an admin opens it, so ordinary
// visitors never download that code.
const Admin = lazy(() => import("./pages/admin/Admin.jsx"));

// Wrap a page in this to require a login (and optionally the admin role).
// This only decides what to SHOW. The server checks permissions again on
// every request, so hiding a page here is never the real protection.
function Protected({ adminOnly = false, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="status">Loading…</p>;
  if (!user) return <Navigate to="/" replace state={{ loginFor: location.pathname }} />;
  if (adminOnly && user.role !== "admin") return <NotFound />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/u/:login" element={<Profile />} />
        <Route path="/mentors" element={<Mentors />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route
          path="/settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route
          path="/admin/*"
          element={
            <Protected adminOnly>
              <Suspense fallback={<p className="status">Loading…</p>}>
                <Admin />
              </Suspense>
            </Protected>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
