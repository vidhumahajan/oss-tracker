// Previous / next buttons for a list that comes in pages.
export default function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button
        type="button"
        className="button button-quiet"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="button button-quiet"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
