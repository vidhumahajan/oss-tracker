import { Link } from "react-router-dom";

export default function NotFound({
  title = "Page not found",
  text = "There is nothing at this address.",
}) {
  return (
    <section className="empty-page">
      <h1>{title}</h1>
      <p>{text}</p>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </section>
  );
}
