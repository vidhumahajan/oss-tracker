import { Link } from "react-router-dom";
import Avatar from "./Avatar.jsx";
import { timeAgo } from "../format.js";

// The activity feed, drawn like a git graph: one main line running down,
// and each merged pull request joining it as a node.
export default function MergeGraph({ items }) {
  return (
    <ol className="graph">
      {items.map((item, index) => (
        // --i tells the CSS which position this row has, so the nodes
        // can appear one after another when the page loads.
        <li key={item.id} className="graph-item" style={{ "--i": Math.min(index, 12) }}>
          <Avatar user={item.author} size={28} />
          <div className="graph-body">
            <p className="graph-line">
              <Link to={`/u/${item.author.login}`} className="graph-author">
                {item.author.login}
              </Link>{" "}
              merged{" "}
              <a href={item.url} target="_blank" rel="noreferrer" className="graph-title">
                {item.title}
              </a>
            </p>
            <p className="graph-meta">
              {item.repo}, {timeAgo(item.mergedAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
