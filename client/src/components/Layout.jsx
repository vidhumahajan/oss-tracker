import { Link, NavLink } from "react-router-dom";
import { useAuth, loginUrl } from "../auth.jsx";
import Avatar from "./Avatar.jsx";
import Logo from "./Logo.jsx";

// The frame around every page: navigation on top, footer below.
export default function Layout({ children }) {
  const { user, loading, logout } = useAuth();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header">
        <div className="wrap site-header-row">
          <Link to="/" className="brand">
            <Logo />
            <span>OSS Tracker</span>
          </Link>

          <nav className="site-nav" aria-label="Main">
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/mentors">Mentors</NavLink>
            {user && <NavLink to={`/u/${user.login}`}>My profile</NavLink>}
            {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
          </nav>

          <div className="site-account">
            {loading ? null : user ? (
              <>
                <NavLink to="/settings" className="account-link" title="Settings">
                  <Avatar user={user} size={28} />
                  <span className="account-name">{user.login}</span>
                </NavLink>
                <button type="button" className="button button-quiet" onClick={logout}>
                  Log out
                </button>
              </>
            ) : (
              <a className="button" href={loginUrl()}>
                Log in with GitHub
              </a>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="wrap site-main">
        {children}
      </main>

      <footer className="site-footer">
        <div className="wrap site-footer-row">
          <span>OSS Tracker reads public GitHub data only.</span>
          <Link to="/privacy">Privacy</Link>
        </div>
      </footer>
    </>
  );
}
