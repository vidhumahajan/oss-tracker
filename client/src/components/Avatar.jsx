// A user's GitHub picture, or their first letter if there is none.
export default function Avatar({ user, size = 32 }) {
  const style = { width: size, height: size, fontSize: size * 0.45 };

  if (!user.avatarUrl) {
    return (
      <span className="avatar avatar-letter" style={style} aria-hidden="true">
        {user.login.charAt(0).toUpperCase()}
      </span>
    );
  }

  // Ask GitHub for a picture twice the shown size, so it stays sharp on phones.
  const url = new URL(user.avatarUrl);
  url.searchParams.set("s", String(size * 2));

  return (
    <img
      className="avatar"
      style={style}
      src={url.toString()}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
