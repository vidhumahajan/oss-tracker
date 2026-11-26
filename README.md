# OSS Tracker

Live: https://oss-tracker.onrender.com

OSS Tracker is a platform for open source communities to track the pull requests their members get merged. Members sign in with GitHub, their public pull requests sync automatically, and a leaderboard ranks everyone by merged work. 

## Features

### Tracking

- Sign in with GitHub. No passwords, and only public data is read.
- Pull requests sync on first login and refresh in the background every few hours.
- Profiles show merged count, repos contributed to, a 12-month activity chart and the full pull request list.
- Leaderboard for this week, this month and all time, plus a feed of recent merges.
- Only merged pull requests count, and pull requests to a member's own repos are ignored.

### Interview prep

- An AI summary for any merged pull request: the problem, the solution, the concepts used, the files changed and three likely interview questions.
- The author can edit a summary at any time or restore the original.
- A public Mentors page where members request a free 1-on-1 session and join on Google Meet once an admin confirms a time.
- Email notifications for requests, confirmations and changes, with reminders 30 minutes before a session and at its start.

### GitHub profile badge

- A live badge with a member's merged count and rank.
- One click adds it to the member's GitHub profile README. The write permission is requested only for that action and revoked right after.


### Privacy

- Members can delete their account and data.
- One active login per account. Signing in on a new device signs out the old one.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, Vite |
| Backend | Node.js, Express 5 |
| Database | MongoDB Atlas, Mongoose |
| Authentication | GitHub OAuth 2.0, JWT in httpOnly cookies |
| Security | Helmet, express-rate-limit, AES-256-GCM encryption |
| AI | Groq API with structured JSON output |
| Email | Brevo API, Nodemailer |
| Testing | Node.js test runner, Supertest |
| Deployment | Render |

## Architecture

- A monolith. One Express server holds the API and serves the built React app, so everything runs on a single address with no CORS setup.
- Background sync uses the database as its queue. Every minute the server refreshes the members who were synced longest ago, with no Redis or separate worker.
- Each member is synced with their own GitHub token, so one person's rate limit never affects anyone else.
- One counting rule produces every number on the site, so profiles, the leaderboard and the feed always agree.

## Security

- Sessions live in httpOnly, SameSite cookies, and every OAuth flow is protected with a `state` check.
- GitHub tokens are encrypted at rest with AES-256-GCM.
- Every admin route checks the role on the server, from the database.
- All input is validated, request sizes are capped, and the API is rate limited per IP.
- Pull request content sent to the AI is treated as untrusted, and the reply must match a fixed schema before it is saved.
- Mentor meeting links and member email addresses are never exposed publicly.

## Local development

Requires Node.js 20+, a MongoDB database and a GitHub OAuth app. Copy `server/.env.example` to `server/.env` and fill in the values.

```
cd server
npm install
npm run dev
```

```
cd client
npm install
npm run dev
```

Run the test suite with `npm test` inside `server/`.

## Project structure

```
server/
  src/routes/        API endpoints
  src/services/      GitHub, AI, email, sync and badge logic
  src/models/        database schemas
  src/middleware/    auth, rate limits, error handling
  src/jobs/          background sync and session reminders
  tests/             automated tests
client/
  src/pages/         one file per page
  src/components/    shared components
```
