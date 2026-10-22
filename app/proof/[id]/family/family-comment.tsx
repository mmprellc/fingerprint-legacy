"use client";

import { useState, type FormEvent } from "react";

export function FamilyComment({ id, token }: { id: string; token: string }) {
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNote("");
    const response = await fetch(`/api/designs/${id}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author, text, token }),
    });
    const payload = (await response.json()) as { error?: string; comment?: { author: string; text: string } };
    if (!response.ok || !payload.comment) {
      setNote(payload.error || "The comment could not be saved.");
      return;
    }
    setText("");
    setNote(`${payload.comment.author}: ${payload.comment.text}`);
  }

  return (
    <form onSubmit={submit}>
      <label className="field"><span>Your name</span><input value={author} aria-label="Your name" onChange={(event) => setAuthor(event.target.value)} /></label>
      <label className="field"><span>Comment</span><textarea value={text} aria-label="Comment" onChange={(event) => setText(event.target.value)} /></label>
      <button className="btn-gold" type="submit">Leave a comment</button>
      {note ? <p className="note" role="status">{note}</p> : null}
    </form>
  );
}
