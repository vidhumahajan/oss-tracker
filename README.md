# OSS Tracker

A website where an open source community tracks the pull requests its members get merged. Members log in with GitHub, the site collects their public pull requests, and a leaderboard shows who is shipping.

Built with MongoDB, Express, React and Node (MERN), in plain JavaScript.

## Features

- **Login with GitHub.** No passwords. The site asks GitHub for public information only.
- **Automatic sync.** Each member's pull requests are fetched on first login and refreshed every few hours.
- **Profiles.** Merged count, repos contributed to, a 12-month activity chart and the full pull request list.
- **Leaderboard.** This week, this month and all time.
- **Fair play.** Only merged pull requests count. Pull requests to your own repos are ignored. Admins can block a repo or exclude a single pull request.
- **Admin panel.** Member search, ban, admin roles, CSV export, repo review, announcements, and a log of every admin action.
- **Privacy.** Members can hide their profile or delete their account and data.

## How it works

There are three pieces:

1. **The React app** (`client/`) runs in the browser and draws the pages.
2. **The API** (`server/`) answers the React app's requests, talks to GitHub, and reads and writes the database.
3. **MongoDB** stores users, pull requests, blocked repos, announcements and the admin log.

It is a monolith: one server holds every feature. Once deployed, that server also serves the built React files, so the whole product lives on one address. During development, Vite serves the React app and forwards every `/api` request to the server. Either way the browser talks to a single address, so there is no CORS setup.

### Login

1. The Log in button opens `/api/auth/github`. The server creates a random `state` value, saves it in a cookie, and sends the browser to GitHub.
2. The person approves on GitHub, and GitHub sends the browser back with a one-time `code` and the same `state`.
3. The server checks the `state` against the cookie. A mismatch means the login did not start on this site, so it is rejected.
4. The server swaps the `code` for an access token and asks GitHub who it belongs to.
5. The server saves the user and stores the token encrypted.
6. The server signs a JWT with the user's id and puts it in an `httpOnly` cookie. The browser sends that cookie on every later request.

### Sync

Sync copies a member's pull requests from GitHub into the database.

- It searches GitHub with `author:NAME type:pr is:public -user:NAME`. The last part leaves out the member's own repos.
- Results come 100 per page, so sync loops through the pages.
- Each pull request is saved with an upsert keyed on GitHub's id, so syncing twice never creates a duplicate.
- The first sync fetches everything. Later syncs ask only for what changed since the last one.

Sync runs on a member's first visit, when they click Sync now (with a 2 minute cooldown), and in the background. Once a minute the server syncs the 5 members who were synced longest ago, which gives 1200 members a turn every 4 hours. The queue is the users collection sorted by last sync time, so there is no Redis and no separate worker. Each member is synced with their own GitHub token, so one person's rate limit never blocks anyone else.

### What counts

One rule produces every number on the site, so profiles, the leaderboard and the feed always agree. A pull request counts if it is merged, an admin has not excluded it, and its repo is not blocked. Banned members and private profiles are left out of the leaderboard, the feed and the public totals.

## Security

| Risk | What stops it |
|---|---|
| A script steals the login cookie | The cookie is `httpOnly`, so scripts cannot read it |
| Another website sends requests as a logged-in member | The cookie is `SameSite=Lax` and the API shares the site's address |
| A forged login callback | The `state` check during login |
| A member opens admin URLs directly | Every admin route checks the role on the server, from the database |
| The database leaks | GitHub tokens are encrypted, and the key lives only in the server's settings |
| A script floods the API | Rate limits per IP address |
| Malformed input | Every input is type-checked, and request bodies over 10kb are rejected |
| Scripts loaded from other sites | A Content Security Policy header, set by Helmet |
| A redirect to another site after login | Only paths on this site are accepted as the return address |
| A mistaken or bad admin action | Every admin action is logged, and owners cannot be changed from the panel |

## Run it locally

You need Node 20 or newer, a MongoDB Atlas database and a GitHub OAuth app.

1. **Create the GitHub OAuth app.** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: `http://localhost:5173/api/auth/github/callback`
2. **Fill in the settings.** Copy `server/.env.example` to `server/.env` and follow the comments inside it.
3. **Start the server.**
   ```
   cd server
   npm install
   npm run dev
   ```
4. **Start the React app** in a second terminal.
   ```
   cd client
   npm install
   npm run dev
   ```
5. Open `http://localhost:5173` and log in.

To see the site with made-up members before real people join, run `npm run seed` inside `server/`. Remove them again with `npm run seed:clear`.

### Admins

The usernames in the `ADMIN_LOGINS` setting are owners. They become admins when they log in, and nobody can demote or ban them from the panel. Owners can make other members admins from the Members page. After changing `ADMIN_LOGINS`, that person has to log out and log in again.

## Deploy

The site runs as one web service plus a hosted database. These steps use Render and MongoDB Atlas, but any host that runs Node works the same way.

1. **Database.** In Atlas, create a cluster and a database user. Under Network Access, allow connections from anywhere (`0.0.0.0/0`). Copy the connection string and add a database name before the `?`, for example `...mongodb.net/oss-tracker?retryWrites=true`.
2. **A second GitHub OAuth app.** An OAuth app allows one callback address, so the live site needs its own.
   - Homepage URL: `https://YOUR-SITE`
   - Authorization callback URL: `https://YOUR-SITE/api/auth/github/callback`
3. **The web service.** Create it from this repo with:
   - Build command: `npm run build`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. **Settings.** Add these environment variables:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | the connection string from step 1 |
   | `GITHUB_CLIENT_ID` | from the OAuth app in step 2 |
   | `GITHUB_CLIENT_SECRET` | from the OAuth app in step 2 |
   | `JWT_SECRET` | a new random value (see `server/.env.example`) |
   | `TOKEN_ENCRYPTION_KEY` | a new random value, 64 hex characters |
   | `ADMIN_LOGINS` | your GitHub username |
   | `APP_URL` | `https://YOUR-SITE`, with no slash at the end |

Before inviting people:

- **Use an always-on plan.** Free plans on most hosts put the server to sleep when nobody is visiting, and the background sync stops while it sleeps.
- **Check your backups.** Free Atlas clusters do not include automatic backups.
- **Keep `TOKEN_ENCRYPTION_KEY` safe.** If it is lost, every member must log in again before their pull requests can sync.
- **Add an uptime check** on `/api/health`. The site does not send alerts on its own.

## Tests

```
cd server
npm test
```

The tests need a MongoDB to talk to. By default they use `mongodb://127.0.0.1:27017/oss_tracker_test`. To use another one, set `TEST_MONGODB_URI`. The tests wipe that database, so never point them at a real one.

## Project structure

```
server/            the API (Express + MongoDB)
  src/index.js       starts everything
  src/app.js         middleware and routes, in order
  src/routes/        one file per group of URLs
  src/services/      GitHub calls, sync, and all the counting
  src/models/        what is stored in the database
  src/middleware/    login checks, rate limits, error handling
  src/jobs/          the background sync
  tests/             automated tests
client/            the website (React + Vite)
  src/pages/         one file per page
  src/components/    pieces shared between pages
  src/styles.css     all the styling
```

## Known limits

- **Projects that do not merge on GitHub.** Some projects, such as `dart-lang/sdk`, land changes through another system and then close the pull request. GitHub reports those as closed, so they do not count here.
- **More than 1000 pull requests.** GitHub's search returns at most 1000 results, so a first sync gets a member's 1000 most recently updated pull requests.
- **One server only.** The "sync already running" check and the rate limiter keep their state in memory. Running several copies of the server would need that state moved to the database or Redis.
