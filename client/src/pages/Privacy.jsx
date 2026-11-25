// Plain-language privacy page. Before you launch, read it once and make
// sure every sentence is still true for your setup.
export default function Privacy() {
  return (
    <article className="narrow prose">
      <h1>Privacy</h1>

      <h2>What we read from GitHub</h2>
      <p>
        When you log in, GitHub tells us your username, display name and profile picture. We then
        search GitHub for pull requests you opened in public repositories. Logging in asks GitHub
        for no extra permissions, so we cannot see private repositories, and we cannot change
        anything on your account.
      </p>

      <h2>Your GitHub badge</h2>
      <p>
        If you choose Add it for me, GitHub asks you separately for permission to write to your
        public repositories. We use it once, to add the badge line to the top of the README in
        your profile repository (the one named like your username), creating that repository if
        you do not have one. Then we cancel the permission straight away. We never store it. The
        badge itself shows only your merged pull request count and rank.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Your GitHub username, display name and picture address.</li>
        <li>
          Your public pull requests: title, repository, link, state and dates. Pull requests to
          your own repositories are not stored.
        </li>
        <li>Summaries of your merged pull requests, if you or an admin asked for one.</li>
        <li>
          Mentor sessions you request: the mentor, your topic, the times you suggested, and the
          session's status and time. Only you and the admins can see them.
        </li>
        <li>
          The email address you give when you request a mentor session. Only the admins can see
          it.
        </li>
        <li>
          An access token from GitHub, encrypted, which we use only to refresh your pull requests.
        </li>
      </ul>
      <p>We do not use tracking or advertising cookies.</p>

      <h2>Session emails</h2>
      <p>
        When you request a mentor session, we ask for your email address. We use it only to email
        you about that session: when it is confirmed, declined, moved or cancelled, and reminders
        30 minutes before and at the start. We never use it for anything else, and we never share
        it. Only the admins can see it. The emails do not contain the Google Meet link. You see
        that on the Mentors page after logging in. The mentor and the admins also get emails about
        the session, with your username and topic, but never your email address.
      </p>

      <h2>Pull request summaries</h2>
      <p>
        When a member asks for a summary of one of their merged pull requests, the pull request's
        public title, description and code changes, and the issue it fixes if it names one, are
        sent to an AI service, which writes the summary. Nothing
        private is sent: these are the same public pages anyone can open on GitHub. The summary
        is saved with the pull request, and anyone who can see the profile can read it. An admin
        can delete a summary.
      </p>

      <h2>Cookies</h2>
      <p>
        One cookie keeps you logged in for 7 days. It is not readable by scripts and is not shared
        with anyone.
      </p>

      <h2>Who can see your profile</h2>
      <p>
        Profiles are public by default. In Settings you can make yours private, which hides it
        from everyone except you and the admins and removes you from the leaderboard and the feed.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Settings has a Delete my account button. It removes your account, all the pull requests and
        summaries we stored for you, and your mentor sessions with the email addresses you gave
        for them, immediately.
      </p>

      <h2>Admins</h2>
      <p>
        Admins can see every profile, remove accounts that break the rules, and stop specific pull
        requests or repositories from counting. Every admin action is logged.
      </p>

      <h2>Questions</h2>
      <p>Ask the admins of the community that shared this site with you.</p>
    </article>
  );
}
