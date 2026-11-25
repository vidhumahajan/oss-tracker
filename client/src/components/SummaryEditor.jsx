import { useState } from "react";
import ConfirmButton from "./ConfirmButton.jsx";

const MAX_CHANGES = 6;

// Concepts are edited one per line as "name: explanation", the same way
// they are shown. The first ": " splits them, so a name like "std::move"
// still works.
function conceptsToText(concepts) {
  return concepts.map((c) => `${c.name}: ${c.explanation}`).join("\n");
}

function textToConcepts(text) {
  return lines(text).map((line) => {
    const at = line.indexOf(": ");
    return at === -1
      ? { name: line, explanation: "" }
      : { name: line.slice(0, at).trim(), explanation: line.slice(at + 2).trim() };
  });
}

// The non-empty lines of a text box.
function lines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// The form that replaces a saved summary while its author or an admin edits it.
// The server checks everything again, so these checks are only for a quicker,
// clearer message.
export default function SummaryEditor({ prId, summary, busy, error, onSave, onCancel, onRestore }) {
  const [problem, setProblem] = useState(summary.problem);
  const [solution, setSolution] = useState(summary.solution);
  const [concepts, setConcepts] = useState(conceptsToText(summary.concepts));
  const [changes, setChanges] = useState(summary.changes.map((c) => ({ ...c })));
  const [questions, setQuestions] = useState(summary.questions.join("\n"));
  const [localError, setLocalError] = useState("");

  function setChange(index, field, value) {
    setChanges((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function submit(event) {
    event.preventDefault();
    const conceptList = textToConcepts(concepts);
    if (conceptList.some((c) => !c.explanation)) {
      setLocalError("Write each concept on its own line as name: explanation.");
      return;
    }
    setLocalError("");
    onSave({
      problem,
      solution,
      concepts: conceptList,
      // Rows left completely empty are dropped.
      changes: changes.filter((row) => row.file.trim() || row.change.trim()),
      questions: lines(questions),
    });
  }

  const shownError = localError || error;
  const id = (name) => `summary-${prId}-${name}`;

  return (
    <form className="form" onSubmit={submit}>
      <label htmlFor={id("problem")}>The problem</label>
      <textarea id={id("problem")} rows={4} value={problem} maxLength={800} onChange={(e) => setProblem(e.target.value)} />

      <label htmlFor={id("solution")}>What the pull request changed</label>
      <textarea id={id("solution")} rows={4} value={solution} maxLength={1000} onChange={(e) => setSolution(e.target.value)} />

      <label htmlFor={id("concepts")}>Concepts used, one per line as name: explanation (3 to 6)</label>
      <textarea id={id("concepts")} rows={6} value={concepts} onChange={(e) => setConcepts(e.target.value)} />

      {changes.map((row, index) => (
        <div key={index} className="form">
          <label htmlFor={id(`file-${index}`)}>File {index + 1}: path</label>
          <input
            id={id(`file-${index}`)}
            value={row.file}
            maxLength={300}
            onChange={(e) => setChange(index, "file", e.target.value)}
          />
          <label htmlFor={id(`change-${index}`)}>File {index + 1}: what changed, in one sentence</label>
          <textarea
            id={id(`change-${index}`)}
            rows={2}
            value={row.change}
            maxLength={400}
            onChange={(e) => setChange(index, "change", e.target.value)}
          />
          <button
            type="button"
            className="button button-quiet button-small"
            onClick={() => setChanges((rows) => rows.filter((_, i) => i !== index))}
          >
            Remove file {index + 1}
          </button>
        </div>
      ))}
      {changes.length < MAX_CHANGES && (
        <button
          type="button"
          className="button button-quiet button-small"
          onClick={() => setChanges((rows) => [...rows, { file: "", change: "" }])}
        >
          Add a file
        </button>
      )}

      <label htmlFor={id("questions")}>Questions an interviewer could ask, one per line (exactly 3)</label>
      <textarea id={id("questions")} rows={5} value={questions} onChange={(e) => setQuestions(e.target.value)} />

      {shownError && (
        <p className="status status-error" role="alert">
          {shownError}
        </p>
      )}

      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <ConfirmButton confirmLabel="Confirm restore" onConfirm={onRestore} disabled={busy}>
          Restore AI version
        </ConfirmButton>
      </div>
    </form>
  );
}
