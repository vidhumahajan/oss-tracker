# OSS Tracker

A website where an open source community tracks the pull requests its members get merged. Members log in with GitHub, the site collects their public pull requests, and a leaderboard shows who is shipping.

Built with MongoDB, Express, React and Node (MERN), in plain JavaScript.

## Features

- **Login with GitHub.** No passwords. The site asks GitHub for public information only.
- **One active login per account.** Logging in on a new device logs out the old one, which is told why.
- **Automatic sync.** Each member's pull requests are fetched on first login and refreshed every few hours.
- **Profiles.** Merged count, repos contributed to, a 12-month activity chart and the full pull request list.
- **Pull request summaries.** Before a GSoC or LFX interview, a member opens one of their merged pull requests and gets a short AI-written explanation: the problem, the solution, the concepts used, the files changed and three questions an interviewer could ask.
- **Editing summaries.** The author or an admin can edit a saved summary at any time, or put the AI's original back. An edited summary says who edited it.
- **Leaderboard.** This week, this month and all time.
- **GitHub profile badge.** A small live badge with a member's merged count and rank, for their GitHub profile README, linking back to their profile here. One click adds it for them, or they copy one line by hand.
- **Fair play.** Only merged pull requests count. Pull requests to your own repos are ignored. Admins can block a repo or exclude a single pull request.
- **Mentors.** A public Mentors page lists a few experienced members. Members request a free 1-on-1 session, an admin confirms a time, and the member gets the Google Meet link. There is no payment.
- **Session emails.** Nobody has to keep checking the site. Admins get an email for every new request, members hear when a session is confirmed, declined, moved or cancelled, and everyone gets a reminder 30 minutes before and at the start. A count on the Mentors link shows members what changed since they last looked.
- **Weekly post.** On the admin Overview, one click writes a plain-text message with this week's top 5, totals and first-time mergers, ready to paste into the community's WhatsApp group.
- **Admin panel.** Member search, ban, admin roles, CSV export, repo review, announcements, mentors and session requests, and a log of every admin action.
- **Privacy.** Members can hide their profile or delete their account and data.

## How it works

There are three pieces:

1. **The React app** (`client/`) runs in the browser and draws the pages.
2. **The API** (`server/`) answers the React app's requests, talks to GitHub and the AI service, and reads and writes the database.
3. **MongoDB** stores users, pull requests (with their summaries), blocked repos, announcements, mentors, session requests and the admin log.

Two outside services are optional: an email sender for session emails (a Brevo API key or an SMTP account), and a second GitHub OAuth app for the profile badge.

It is a monolith: one server holds every feature. Once deployed, that server also serves the built React files, so the whole product lives on one address. During development, Vite serves the React app and forwards every `/api` request to the server. Either way the browser talks to a single address, so there is no CORS setup.

### Login

1. The Log in button opens `/api/auth/github`. The server creates a random `state` value, saves it in a cookie, and sends the browser to GitHub.
2. The person approves on GitHub, and GitHub sends the browser back with a one-time `code` and the same `state`.
3. The server checks the `state` against the cookie. A mismatch means the login did not start on this site, so it is rejected.
4. The server swaps the `code` for an access token and asks GitHub who it belongs to.
5. The server saves the user and stores the token encrypted.
6. The server creates a new random `sessionId`, saves it on the user, and signs a JWT holding the user's id and that `sessionId`. The JWT goes in an `httpOnly` cookie, which the browser sends on every later request.

On every request the server compares the `sessionId` in the cookie with the one saved on the user. Only the newest login matches, so logging in somewhere else ends the older session. When `/api/auth/me` sees such an older cookie, it answers `{ user: null, reason: "signed_in_elsewhere" }` and the home page explains what happened. Logging out removes the saved `sessionId`, so a copied cookie stops working too.

### Sync

Sync copies a member's pull requests from GitHub into the database.

- It searches GitHub with `author:NAME type:pr is:public -user:NAME`. The last part leaves out the member's own repos.
- Results come 100 per page, so sync loops through the pages.
- Each pull request is saved with an upsert keyed on GitHub's id, so syncing twice never creates a duplicate.
- The first sync fetches everything. Later syncs ask only for what changed since the last one.

Sync runs on a member's first visit, when they click Sync now (with a 2 minute cooldown), and in the background. Once a minute the server syncs the 5 members who were synced longest ago, which gives 1200 members a turn every 4 hours. The queue is the users collection sorted by last sync time, so there is no Redis and no separate worker. Each member is synced with their own GitHub token, so one person's rate limit never blocks anyone else.

### Summaries

A summary is written once per merged pull request and saved on it, because a merged pull request does not change.

- Only the pull request's author or an admin can ask for one. Anyone who can see the profile can read it.
- The server collects the pull request's title, description and changed files from GitHub with the member's own token, plus the issue it fixes when the description says "fixes #N", "closes #N" or "resolves #N".
- To keep each request small, descriptions are cut to 1000 characters, at most 15 files are sent, the diffs together are cut to about 4000 characters, and lock, minified and generated files are left out. The largest request is about 3000 tokens plus 2000 kept for the reply, which fits inside the free plan's 8000 tokens a minute.
- The AI is told that all of this is untrusted material to summarise, never instructions. It must answer in a fixed JSON shape, and every field is checked for type and length before anything is saved. A reply that fails the check is thrown away (502).
- Each member can ask for 3 summaries in 24 hours, counted from their first one. An attempt that fails before the AI is called, for example because GitHub refused, does not count. One that reaches the AI does, even if it then fails.
- The AI service's own rate limits never count against the member. If the site is over the per-minute limit, the member sees "The summary service is busy. Try again in a minute." If it is over the daily limit, they see "Today's free summaries are used up. Try again tomorrow." Both answer 429.
- Without `AI_API_KEY`, the button is hidden and the route answers 503.

#### The AI service

Summaries use [Groq](https://console.groq.com)'s free plan through its OpenAI-compatible chat completions address, called with plain fetch. Get a free key at https://console.groq.com/keys. The default model is `openai/gpt-oss-120b`. At the time of writing its free plan allows 30 requests and 8000 tokens a minute, and 1000 requests and 200000 tokens a day, for the whole site. That is roughly 40 to 60 summaries a day across all members. Check the current numbers on your account's Limits page.

To move to another OpenAI-compatible service, change `AI_API_URL`, `AI_API_KEY` and `SUMMARY_MODEL`. No code changes are needed, as long as the service supports `response_format` with `json_schema` and the model accepts `reasoning_effort`.

### Mentors and sessions

Admins add mentors on the admin Mentors tab: name, expertise, bio and a Google Meet link. Only links starting with `https://meet.google.com/` are accepted. Mentors can be edited and hidden, never deleted, so old sessions keep their mentor.

A session moves through these steps:

- **requested**: the member asked, with a topic and the times that suit them.
- **confirmed**: an admin picked a date and time. The member now sees the time in their own time zone and a "Join on Google Meet" link. Or **declined**, with an optional note.
- **done** or **cancelled**: a confirmed session ends one of these two ways.

A member can cancel their own requested or confirmed session. Each member can have one open session (requested or confirmed) per mentor, and at most 2 open sessions in total. Hidden mentors cannot be booked.

The Meet link is private. It is sent only to admins and to the member whose session is confirmed, and never appears on the public Mentors page.

An admin can move a confirmed session to a new time with Change time on the admin Mentors tab.

### Session emails

All sending is in `server/src/services/mail.js`. It sends one of two ways: through [Brevo](https://www.brevo.com)'s HTTP API when `BREVO_API_KEY` is set, or otherwise through any SMTP account with [nodemailer](https://nodemailer.com). See "Sending email" below for which to pick. What each email says is in `server/src/services/sessionMail.js`. Emails are plain text. Dates and times are written in `TIME_ZONE` (India Standard Time by default), with the zone named.

| When | Who gets an email |
|---|---|
| A member requests a session | `ADMIN_EMAIL`: the member, mentor, topic, times and a link to the admin Mentors tab |
| An admin confirms it | The member: mentor, time, a link to the Mentors page and an "Add to Google Calendar" link for 30 minutes. The mentor: member, topic and time |
| An admin declines it | The member, with the admin's note |
| A session is cancelled | The member, with the admin's note if an admin cancelled. The mentor too, if a time had been confirmed. `ADMIN_EMAIL` too, if the member cancelled |
| An admin moves it to a new time | The member and the mentor |
| 30 minutes before | The member, the mentor and `ADMIN_EMAIL` |
| At the start time | The member and the mentor |

Rules:

- **No Meet link in member emails.** They link to the Mentors page, where the member sees the link after logging in. If a member typed a wrong address, the link stays private.
- **Addresses are private.** Members give an address when they request a session, and mentors have an optional one set by admins. Both appear only in admin answers, never in the public mentor list or to other members, and never in the server log. Deleting an account deletes its sessions and their addresses.
- **Email never breaks the site.** Without `BREVO_API_KEY` or the SMTP settings nothing is sent, one line is logged, and everything else works as before. A failed send is logged and the request that caused it still succeeds.
- **Reminders go out once.** `server/src/jobs/reminderLoop.js` runs once a minute, like the sync. When a reminder is sent, the time is saved on the session, so a restart never sends it twice. If the server was down at the exact moment, the 30 minute reminder still goes out as long as the session has not started, and the start reminder goes out up to 10 minutes late, then is skipped. Moving a session to a new time clears both, so they go out again for the new time.
- **The count on the Mentors link** is the member's sessions that an admin changed (status or time) since the member last opened the Mentors page. Opening the page clears it. A member's own request or cancel does not count.

A logged-in member with a confirmed upcoming session also sees one line about it on the home page.

### The GitHub profile badge

`GET /api/badge/USERNAME.svg` is a small two-tone image: "OSS Tracker" on the left, and "12 merged PRs, #3 all time" on the right, or "OSS Tracker member" before the first merge. It is drawn by hand from fixed words and numbers only. A private, banned or unknown profile gets one neutral badge, "view profile", so the badge never reveals whether an account exists. The image is cached for an hour and has its own, more generous rate limit, because GitHub's image proxy asks for it on every profile view.

The badge line a member puts in their profile README is the image wrapped in a link to their profile here:

```
[![OSS Tracker](https://YOUR-SITE/api/badge/USERNAME.svg)](https://YOUR-SITE/u/USERNAME)
```

Until a member has added it, the home page shows a panel with a preview of their badge. It cannot be dismissed, but it never blocks anything else on the site.

**Add it for me.** Login is read-only and stays read-only. Writing to a member's GitHub needs a stronger permission, so it comes from a second, separate GitHub OAuth app, and is asked for only when the member presses the button:

1. `/api/badge/connect` saves a random `state` in a cookie and sends the member to GitHub, asking the badge app for the `public_repo` scope.
2. GitHub sends them back to `/api/badge/callback`. If they pressed Cancel, or the `state` does not match, nothing happens and the home page says "Nothing was changed on your GitHub."
3. The server swaps the code for a token and asks GitHub who it belongs to. If it is not the logged-in member's account, nothing is written.
4. If the member has no repository named exactly like their username, it is created as a public repository with a README.
5. If the README already has the badge, nothing changes. Otherwise the badge line goes at the very top, followed by a blank line, with the commit message "Add OSS Tracker badge". Everything already there stays exactly as it was. A repository with no README gets a `README.md` with just the line.
6. Whatever happened, the server then deletes the app's grant for that token, which cancels the permission, and forgets the token. It is never stored, logged or sent to the browser.
7. The member lands on their profile with "Badge added to your GitHub profile."

"Add it for me" is only offered when both `BADGE_GITHUB_CLIENT_ID` and `BADGE_GITHUB_CLIENT_SECRET` are set and `APP_URL` is not a localhost address, because a badge pointing at localhost would show as broken on GitHub. Otherwise the panel shows the badge line with a Copy button and three short steps.

**I already added it myself.** This link reads the member's public profile README with their normal read-only login token and looks for their badge address. Only when it is there is the badge marked as added.

### What counts

One rule produces every number on the site, so profiles, the leaderboard and the feed always agree. A pull request counts if it is merged, an admin has not excluded it, and its repo is not blocked. Banned members and private profiles are left out of the leaderboard, the feed and the public totals.

## Security

| Risk | What stops it |
|---|---|
| A script steals the login cookie | The cookie is `httpOnly`, so scripts cannot read it |
| Another website sends requests as a logged-in member | The cookie is `SameSite=Lax` and the API shares the site's address |
| A forged login callback | The `state` check during login |
| A stolen or shared login cookie | Each account has one active login. A new login or a logout ends the old cookie at once |
| A member opens admin URLs directly | Every admin route checks the role on the server, from the database |
| The database leaks | GitHub tokens are encrypted, and the key lives only in the server's settings |
| A script floods the API | Rate limits per IP address |
| Malformed input | Every input is type-checked, and request bodies over 10kb are rejected (32kb for an edited summary, which can be long) |
| Scripts loaded from other sites | A Content Security Policy header, set by Helmet |
| A redirect to another site after login | Only paths on this site are accepted as the return address |
| Text in a pull request tries to give the AI instructions | The AI is told the material is untrusted, its reply must match a fixed shape and pass length checks, and it is shown as plain text |
| A member uses up the free AI allowance | 3 summaries per member per day, small inputs, and the AI never rewrites a saved summary. Editing one never calls the AI |
| A mentor's private Meet link leaks | It is sent only to admins and to the member with a confirmed session. Links that are not `https://meet.google.com/...` are rejected |
| A member books every mentor | One open session per mentor and at most 2 in total |
| Members' and mentors' email addresses leak | They are returned only in admin answers and never logged. Deleting an account deletes them |
| A member types someone else's email address | Emails never contain the Meet link, only a link to the Mentors page, which needs the member's login |
| A mail server problem slows or breaks the site | Email is optional, failures are logged and never fail the request, SMTP calls give up after a few seconds and Brevo calls after 10 seconds |
| A name with a line break adds email headers | Subjects are squeezed onto one line before sending |
| "Add it for me" gets more access than it needs | It uses a separate OAuth app with only the `public_repo` scope, asked for only when the member presses the button. The token is used once, never stored, logged or sent to the browser, and the grant is deleted on success and on every failure |
| A member approves "Add it for me" while logged in to GitHub as someone else | The server checks the token belongs to the logged-in member's GitHub account, and writes nothing if not |
| A forged badge callback | The same `state` check as login |
| The badge reveals private accounts or carries injected text | Private, banned and unknown profiles get one identical neutral badge, and the SVG holds only fixed words and numbers |
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

On your laptop, "Add it for me" on the badge panel stays off, because `APP_URL` is localhost. The panel shows the copy line instead.

To see the site with made-up members before real people join, run `npm run seed` inside `server/`. Remove them again with `npm run seed:clear`.

### Admins

The usernames in the `ADMIN_LOGINS` setting are owners. They become admins when they log in, and nobody can demote or ban them from the panel. Owners can make other members admins from the Members page. After changing `ADMIN_LOGINS`, that person has to log out and log in again.

## Deploy

The site runs as one web service plus a hosted database. These steps use Render and MongoDB Atlas, but any host that runs Node works the same way.

1. **Database.** In Atlas, create a cluster and a database user. Under Network Access, allow connections from anywhere (`0.0.0.0/0`). Copy the connection string and add a database name before the `?`, for example `...mongodb.net/oss-tracker?retryWrites=true`.
2. **A second GitHub OAuth app.** An OAuth app allows one callback address, so the live site needs its own.
   - Homepage URL: `https://YOUR-SITE`
   - Authorization callback URL: `https://YOUR-SITE/api/auth/github/callback`
3. **The badge OAuth app (optional).** This turns on "Add it for me" for the profile badge. It must be a separate OAuth app from the login one, because it asks for permission to write to public repos.
   - Application name: something members will recognise, for example `OSS Tracker badge`
   - Homepage URL: `https://YOUR-SITE`
   - Authorization callback URL: `https://YOUR-SITE/api/badge/callback`
4. **The web service.** Create it from this repo with:
   - Build command: `npm run build`
   - Start command: `npm start`
   - Health check path: `/api/health`
5. **Settings.** Add these environment variables:

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
   | `AI_API_KEY` | optional, turns on pull request summaries. Free key at https://console.groq.com/keys |
   | `AI_API_URL` | optional, defaults to `https://api.groq.com/openai/v1/chat/completions` |
   | `SUMMARY_MODEL` | optional, defaults to `openai/gpt-oss-120b` |
   | `BADGE_GITHUB_CLIENT_ID` | optional, from the badge OAuth app in step 3 |
   | `BADGE_GITHUB_CLIENT_SECRET` | optional, from the badge OAuth app in step 3 |
   | `BREVO_API_KEY` | optional, turns on session emails through Brevo's HTTP API. Use this on hosts that block SMTP. When set, the SMTP settings are ignored (see "Sending email" below) |
   | `SMTP_HOST` | optional, turns on session emails over SMTP. For Gmail: `smtp.gmail.com` (see "Sending email" below) |
   | `SMTP_PORT` | optional, defaults to `587` |
   | `SMTP_USER` | optional, the email account that sends |
   | `SMTP_PASS` | optional, its password. For Gmail, an app password |
   | `MAIL_FROM` | the From line, for example `OSS Tracker <you@gmail.com>`. Needed with Brevo. With SMTP it defaults to `SMTP_USER` |
   | `ADMIN_EMAIL` | optional, where new requests and admin reminders go |
   | `TIME_ZONE` | optional, the time zone for times in emails. Defaults to `Asia/Kolkata` |

### Sending email

There are two ways to send, and the server picks one by itself:

| Mode | When it is used | Good for |
|---|---|---|
| Brevo HTTP API | `BREVO_API_KEY` is set. Every email goes through Brevo and the SMTP settings are ignored | Hosts that block SMTP ports (25, 465, 587), which many free hosting plans do. It sends over HTTPS on port 443 like any web request |
| SMTP | `BREVO_API_KEY` is empty and `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` are set | Your laptop, or any host that allows outgoing SMTP |

With neither, no email is sent and the server logs one line about it. Both modes use `MAIL_FROM` for the sender name and address.

If session emails work on your laptop but fail once deployed with a timeout or "connection refused" in the `Email "` log line, your host is blocking SMTP. Switch to Brevo.

#### Brevo (works when SMTP is blocked)

1. **Sign up** at https://www.brevo.com. The free plan has a daily sending limit that is plenty for session emails.
2. **Add and verify a sender.** In Brevo, open **Settings > Senders, Domains, IPs > Senders** and click **Add a sender**. Enter a From name (for example `OSS Tracker`) and the From email you want to send from, then click **Save**. Brevo emails a 6-digit code to that address. Paste it in and click **Verify sender**. Brevo refuses to send from an address that is not verified.
3. **Create an API key.** In Brevo, open **SMTP & API** from the settings menu, go to the **API keys** tab and click **Generate a new API key**. Give it a name such as `OSS Tracker` and copy the key, which starts with `xkeysib-`. It is shown only once.
4. **Add the settings**, with the exact address you verified in `MAIL_FROM`:
   ```
   BREVO_API_KEY=xkeysib-the key you copied
   MAIL_FROM=OSS Tracker <the-address-you-verified@example.com>
   ADMIN_EMAIL=your own address
   ```
5. **Restart the server** and request a session yourself. The admin email should arrive within a minute. If it does not, the server log has a line starting with `Email "` with Brevo's status code and message. A 401 means the key is wrong. A 400 about the sender means `MAIL_FROM` does not match a verified sender.

A sender on a free address such as Gmail works, but some inboxes mark it as spam because Brevo cannot sign for gmail.com. If you own a domain, authenticate it on the **Domains** tab of the same Brevo page for better delivery. If the key leaks, delete it on the **API keys** tab and generate a new one.

#### SMTP

Any SMTP account works. These steps use a Gmail account, which can send a few hundred emails a day for free. That is plenty for session emails. A separate Gmail account just for the site keeps your own inbox out of it.

1. **Turn on 2-Step Verification** for the Gmail account at https://myaccount.google.com/security. Google only offers app passwords when it is on.
2. **Create an app password** at https://myaccount.google.com/apppasswords. Give it a name such as `OSS Tracker`, then copy the 16-letter password Google shows. It is shown only once.
3. **Add the settings:**
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=the-site-account@gmail.com
   SMTP_PASS=the 16-letter app password, without spaces
   MAIL_FROM=OSS Tracker <the-site-account@gmail.com>
   ADMIN_EMAIL=your own address
   ```
4. **Restart the server** and request a session yourself. The admin email should arrive within a minute. If it does not, the server log has a line starting with `Email "` that says why.

Gmail only sends from the account's own address, so keep that address in `MAIL_FROM`. Never use your normal Gmail password here. If the app password leaks, delete it on the same page and create a new one.

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
  src/services/      GitHub, AI and email, sync, summaries, the badge, and all the counting
  src/models/        what is stored in the database
  src/middleware/    login checks, rate limits, error handling
  src/jobs/          the background sync and the session reminders
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
