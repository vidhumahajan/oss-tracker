import { useEffect, useState } from "react";

// A button for actions that are hard to undo. The first click changes the
// label to a confirmation; only a second click within 4 seconds runs it.
export default function ConfirmButton({ children, confirmLabel, onConfirm, className = "", disabled }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer); // tidy up if the button disappears first
  }, [armed]);

  function handleClick() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onConfirm();
  }

  return (
    <button
      type="button"
      className={`button ${armed ? "button-danger" : "button-quiet"} ${className}`}
      onClick={handleClick}
      disabled={disabled}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
