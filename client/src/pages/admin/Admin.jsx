import { NavLink, Route, Routes } from "react-router-dom";
import Overview from "./Overview.jsx";
import Members from "./Members.jsx";
import Repos from "./Repos.jsx";
import Announcements from "./Announcements.jsx";
import Mentors from "./Mentors.jsx";
import Log from "./Log.jsx";

// The admin panel: a row of sections, each one its own page under /admin.
export default function Admin() {
  return (
    <>
      <h1>Admin</h1>
      <nav className="tabs" aria-label="Admin sections">
        <NavLink to="/admin" end className="tab">
          Overview
        </NavLink>
        <NavLink to="/admin/members" className="tab">
          Members
        </NavLink>
        <NavLink to="/admin/repos" className="tab">
          Repos
        </NavLink>
        <NavLink to="/admin/announcements" className="tab">
          Announcements
        </NavLink>
        <NavLink to="/admin/mentors" className="tab">
          Mentors
        </NavLink>
        <NavLink to="/admin/log" className="tab">
          Log
        </NavLink>
      </nav>

      <Routes>
        <Route index element={<Overview />} />
        <Route path="members" element={<Members />} />
        <Route path="repos" element={<Repos />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="mentors" element={<Mentors />} />
        <Route path="log" element={<Log />} />
      </Routes>
    </>
  );
}
