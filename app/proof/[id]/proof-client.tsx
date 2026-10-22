"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FrameMockup } from "@/components/FrameMockup";
import { isFrameSize } from "@/lib/frames";
import type { PrintStyle } from "@/lib/fingerprint/types";
import { describeVersionChange } from "@/lib/proof/diff";
import type { ProofComment, ProofVersion } from "@/lib/store";

type NameRow = { text: string; freq: "once" | "normal" | "hold" };

type PrintSizeChoice = { id: string; label: string; productId: string };

export type ProofModel = {
  id: string;
  style: PrintStyle;
  sizeId: string;
  productId: string;
  frameId?: string;
  versions: ProofVersion[];
  approvedVersion?: number;
  comments: ProofComment[];
  sharePath: string;
  capacity: string;
  llmReady: boolean;
  sizes: { id: string; label: string }[];
  printSizes: PrintSizeChoice[];
  products: { id: string; name: string; sizes: { id: string; label: string }[] }[];
};

function rowsFrom(style: PrintStyle): NameRow[] {
  const once = new Set((style.nameMax ?? []).filter((item) => item.max <= 1).map((item) => item.name));
  const hold = new Set(style.nameHold ?? []);
  return (style.names ?? []).map((text) => ({
    text,
    freq: hold.has(text) ? "hold" : once.has(text) ? "once" : "normal",
  }));
}

function styleFrom(base: PrintStyle, draft: Draft): PrintStyle {
  const names = draft.names.map((row) => row.text.trim()).filter(Boolean);
  return {
    ...base,
    headerName: draft.headerName.trim(),
    headerDates: draft.headerDates.trim(),
    signature: draft.signatureOn ? draft.signature.trim() || "Fingerprint Legacy" : "",
    plaque: true,
    centerName: draft.centerName.trim(),
    centerDetail: draft.centerDetail.trim(),
    secondaryName: draft.secondaryName.trim(),
    secondaryDetail: draft.secondaryDetail.trim(),
    marriage: draft.marriage.trim(),
    marriageDate: draft.marriageDate.trim(),
    names,
    nameMax: draft.names.filter((row) => row.freq === "once" && row.text.trim()).map((row) => ({ name: row.text.trim(), max: 1 })),
    nameHold: draft.names.filter((row) => row.freq === "hold" && row.text.trim()).map((row) => row.text.trim()),
    scriptures: draft.verses.map((verse) => verse.trim()).filter(Boolean),
    stories: draft.stories.map((story) => story.trim()).filter(Boolean),
    filler: draft.filler,
    nameGap: draft.nameGap,
    textScale: draft.textScale,
  };
}

type Draft = {
  headerName: string;
  headerDates: string;
  signatureOn: boolean;
  signature: string;
  centerName: string;
  centerDetail: string;
  secondaryName: string;
  secondaryDetail: string;
  marriage: string;
  marriageDate: string;
  names: NameRow[];
  verses: string[];
  stories: string[];
  filler: "stories" | "names" | "lines";
  nameGap: "dot" | "space";
  textScale: number;
  sizeId: string;
  productId: string;
};

function draftFrom(style: PrintStyle, sizeId: string, productId: string): Draft {
  return {
    headerName: style.headerName ?? "",
    headerDates: style.headerDates ?? "",
    signatureOn: Boolean(style.signature),
    signature: style.signature || "Fingerprint Legacy",
    centerName: style.centerName ?? "",
    centerDetail: style.centerDetail ?? "",
    secondaryName: style.secondaryName ?? "",
    secondaryDetail: style.secondaryDetail ?? "",
    marriage: style.marriage ?? "",
    marriageDate: style.marriageDate ?? "",
    names: rowsFrom(style),
    verses: [...(style.scriptures ?? [])],
    stories: [...(style.stories ?? [])],
    filler: style.filler === "names" || style.filler === "lines" ? style.filler : "stories",
    nameGap: style.nameGap === "space" ? "space" : "dot",
    textScale: (style.textScale || 1) < 0.82 ? 0.77 : style.textScale || 0.86,
    sizeId,
    productId,
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function ProofClient({ model }: { model: ProofModel }) {
  const [versions, setVersions] = useState(model.versions);
  const [approved, setApproved] = useState(model.approvedVersion);
  const [comments] = useState(model.comments);
  const [current, setCurrent] = useState(model.versions.at(-1)?.number ?? 1);
  const [compare, setCompare] = useState(() => {
    const latest = model.versions.at(-1)?.number ?? 1;
    return model.versions.find((version) => version.number !== latest)?.number ?? latest;
  });
  const [zoom, setZoom] = useState(1);
  const [closeup, setCloseup] = useState<"print" | "core" | "ridge">("print");
  const [draft, setDraft] = useState<Draft>(() => draftFrom(model.style, model.sizeId, model.productId));
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState("");
  const [revertStatus, setRevertStatus] = useState("");
  const [request, setRequest] = useState("");
  const [capacity, setCapacity] = useState(model.capacity);
  const approveQueued = useRef(false);
  const versionsRef = useRef(versions);
  const currentRef = useRef(current);
  const savingRef = useRef(false);
  const approvingRef = useRef(false);
  const shown = versions.find((version) => version.number === current) ?? versions.at(-1);
  const other = versions.find((version) => version.number === compare);
  const warnings = shown?.warnings ?? [];
  const sound = warnings.length === 1 && warnings[0].startsWith("No cut-off");
  const changes = shown && other && other.number !== shown.number
    ? describeVersionChange(
        { style: other.style, sizeId: other.sizeId },
        { style: shown.style, sizeId: shown.sizeId },
      )
    : [];

  const share = useMemo(() => {
    if (typeof window === "undefined") return model.sharePath;
    return `${window.location.origin}${model.sharePath}`;
  }, [model.sharePath]);

  useEffect(() => {
    if (!shown) return;
    if (compare !== shown.number) return;
    const fallback = [...versions].reverse().find((version) => version.number !== shown.number);
    if (fallback) setCompare(fallback.number);
  }, [compare, shown, versions]);

  function applyVersion(version: ProofVersion, nextCapacity?: string) {
    currentRef.current = version.number;
    setCurrent(version.number);
    setDraft(draftFrom(version.style, version.sizeId, version.productId));
    if (nextCapacity) setCapacity(nextCapacity);
  }

  function adopt(version: ProofVersion, nextCapacity?: string, previous?: number) {
    const items = versionsRef.current;
    const next = items.some((item) => item.number === version.number) ? items : [...items, version];
    versionsRef.current = next;
    currentRef.current = version.number;
    setVersions(next);
    applyVersion(version, nextCapacity);
    if (previous && previous !== version.number) setCompare(previous);
  }

  async function markApproved(number: number | undefined) {
    if (approvingRef.current) return;
    if (!number) {
      setMessage("Choose a version to approve.");
      return;
    }
    approvingRef.current = true;
    setApproving(true);
    setMessage(`Approving Version ${number}.`);
    try {
      const response = await fetch(`/api/designs/${model.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number }),
      });
      const payload = await readJson<{ error?: string; approvedVersion?: number }>(response);
      if (!response.ok || !payload.approvedVersion) throw new Error(payload.error || "The proof could not be approved.");
      setApproved(payload.approvedVersion);
      const version = versionsRef.current.find((item) => item.number === payload.approvedVersion);
      if (version) applyVersion(version);
      else {
        currentRef.current = payload.approvedVersion;
        setCurrent(payload.approvedVersion);
      }
      setMessage(`Approved: Version ${payload.approvedVersion}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The proof could not be approved.");
    } finally {
      approvingRef.current = false;
      setApproving(false);
    }
  }

  async function save() {
    if (savingRef.current) return;
    const previous = currentRef.current;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    let queuedNumber: number | undefined;
    try {
      const style = styleFrom(model.style, draft);
      const response = await fetch(`/api/designs/${model.id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style, sizeId: draft.sizeId, productId: draft.productId }),
      });
      const payload = await readJson<{ error?: string; version?: ProofVersion; capacity?: string }>(response);
      if (!response.ok || !payload.version) throw new Error(payload.error || "The revision could not be saved.");
      adopt(payload.version, payload.capacity, previous);
      setMessage(payload.version.changes.join(" "));
      if (approveQueued.current) queuedNumber = payload.version.number;
    } catch (error) {
      approveQueued.current = false;
      setMessage(error instanceof Error ? error.message : "The revision could not be saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (queuedNumber) {
      approveQueued.current = false;
      await markApproved(queuedNumber);
    }
  }

  async function revert() {
    const sourceVersion = versionsRef.current.find((item) => item.number === currentRef.current) ?? versionsRef.current.at(-1);
    if (!sourceVersion || savingRef.current) return;
    const previous = currentRef.current;
    const source = sourceVersion.number;
    savingRef.current = true;
    setSaving(true);
    setRevertStatus("Saving...");
    setMessage("Saving...");
    let queuedNumber: number | undefined;
    try {
      const response = await fetch(`/api/designs/${model.id}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revertTo: source }),
      });
      const payload = await readJson<{ error?: string; version?: ProofVersion; capacity?: string }>(response);
      if (!response.ok || !payload.version) throw new Error(payload.error || "The version could not be restored.");
      adopt(payload.version, payload.capacity, previous);
      const note = payload.version.note || `Reverted to Version ${source} (saved as Version ${payload.version.number})`;
      setRevertStatus(note);
      setMessage(note);
      if (approveQueued.current) queuedNumber = payload.version.number;
    } catch (error) {
      approveQueued.current = false;
      const note = error instanceof Error ? error.message : "The version could not be restored.";
      setRevertStatus(note);
      setMessage(note);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (queuedNumber) {
      approveQueued.current = false;
      await markApproved(queuedNumber);
    }
  }

  async function interpret() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    let queuedNumber: number | undefined;
    try {
      const response = await fetch(`/api/designs/${model.id}/interpret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });
      const payload = await readJson<{ ok?: boolean; reason?: string; error?: string; version?: ProofVersion; env?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "The request could not be read.");
      if (!payload.ok || !payload.version) {
        approveQueued.current = false;
        setMessage(payload.reason || `Free-text changes need ${payload.env || "OPENAI_API_KEY"}. The controls below still save a revision.`);
        return;
      }
      adopt(payload.version, undefined, currentRef.current);
      setMessage(payload.version.changes.join(" "));
      setRequest("");
      if (approveQueued.current) queuedNumber = payload.version.number;
    } catch (error) {
      approveQueued.current = false;
      setMessage(error instanceof Error ? error.message : "The request could not be read.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (queuedNumber) {
      approveQueued.current = false;
      await markApproved(queuedNumber);
    }
  }

  function approve(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault();
    event.stopPropagation();
    if (approvingRef.current) return;
    if (savingRef.current) {
      approveQueued.current = true;
      setMessage("This version will be approved as soon as the save finishes.");
      return;
    }
    const number = currentRef.current || versionsRef.current.at(-1)?.number;
    void markApproved(number);
  }

  const picture = closeup === "print" ? `v${shown?.number ?? 1}.png` : closeup === "core" ? `core${shown?.number ?? 1}.png` : `ridge${shown?.number ?? 1}.png`;
  const sizeChoices = model.printSizes.some((size) => size.id === draft.sizeId)
    ? model.printSizes
    : [...model.printSizes, { id: draft.sizeId, label: draft.sizeId, productId: draft.productId }];

  return (
    <div className="proof">
      <div className="proof-stage">
        <div className="proof-toolbar">
          <button type="button" className={closeup === "print" ? "btn-gold" : "btn-ghost"} onClick={() => setCloseup("print")}>Full print</button>
          <button type="button" className={closeup === "core" ? "btn-gold" : "btn-ghost"} onClick={() => setCloseup("core")}>Core</button>
          <button type="button" className={closeup === "ridge" ? "btn-gold" : "btn-ghost"} onClick={() => setCloseup("ridge")}>Ridge</button>
          <label className="zoom">Zoom <input type="range" min={1} max={3} step={0.1} value={zoom} aria-label="Zoom" onChange={(event) => setZoom(Number(event.target.value))} /></label>
        </div>
        <div className="proof-zoom">
          {draft.productId === "framed" && isFrameSize(draft.sizeId) && closeup === "print" ? (
            <FrameMockup finish={model.frameId || "black"} size={draft.sizeId} label="Framed preview">
              <img src={`/api/designs/${model.id}/asset/${picture}`} alt="Framed proof" style={{ transform: `scale(${zoom})` }} />
            </FrameMockup>
          ) : (
            <img src={`/api/designs/${model.id}/asset/${picture}`} alt={closeup === "print" ? "Full proof" : closeup === "core" ? "Core close-up" : "Ridge close-up"} style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} />
          )}
        </div>
        <p className="note">{capacity}</p>
        <ul className={sound ? "proof-ok" : "proof-warn"}>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
        {message ? <p className="note" role="status">{message}</p> : null}
        <div className="proof-actions">
          <button className="btn-gold" type="button" disabled={approving} onClick={approve}>
            {approving ? "Approving..." : approved === shown?.number && shown ? `Approved: Version ${shown.number}` : "Approve proof"}
          </button>
          {approved ? <a className="btn-gold" href={`/checkout?design=${model.id}`}>Continue to checkout</a> : <p className="note">Approve a version before checkout.</p>}
          {approved ? <p className="note">Approved: Version {approved}</p> : null}
        </div>
      </div>
      <form className="proof-controls" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <h2>Revise</h2>
        <label className="field"><span>Header name</span><input value={draft.headerName} aria-label="Header name" onChange={(event) => setDraft({ ...draft, headerName: event.target.value })} /></label>
        <label className="field"><span>Dates</span><input value={draft.headerDates} aria-label="Header dates" onChange={(event) => setDraft({ ...draft, headerDates: event.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={draft.signatureOn} onChange={(event) => setDraft({ ...draft, signatureOn: event.target.checked })} /> Signature</label>
        {draft.signatureOn ? <label className="field"><span>Signature</span><input value={draft.signature} aria-label="Signature" onChange={(event) => setDraft({ ...draft, signature: event.target.value })} /></label> : null}
        <label className="field"><span>Center name</span><input value={draft.centerName} aria-label="Center name" onChange={(event) => setDraft({ ...draft, centerName: event.target.value })} /></label>
        <label className="field"><span>Center date</span><input value={draft.centerDetail} aria-label="Center date" onChange={(event) => setDraft({ ...draft, centerDetail: event.target.value })} /></label>
        <label className="field"><span>Second plaque name</span><input value={draft.secondaryName} aria-label="Secondary name" onChange={(event) => setDraft({ ...draft, secondaryName: event.target.value })} /></label>
        <label className="field"><span>Second date</span><input value={draft.secondaryDetail} aria-label="Secondary date" onChange={(event) => setDraft({ ...draft, secondaryDetail: event.target.value })} /></label>
        <label className="field"><span>Marriage</span><input value={draft.marriage} aria-label="Marriage line" onChange={(event) => setDraft({ ...draft, marriage: event.target.value })} /></label>
        <label className="field"><span>Marriage date</span><input value={draft.marriageDate} aria-label="Marriage date" onChange={(event) => setDraft({ ...draft, marriageDate: event.target.value })} /></label>
        <fieldset>
          <legend>Names</legend>
          {draft.names.map((row, index) => (
            <div className="name-row" key={index}>
              <input aria-label={`Name ${index + 1}`} value={row.text} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, names: currentDraft.names.map((item, at) => at === index ? { ...item, text: event.target.value } : item) }))} />
              <select aria-label={`How often ${row.text || "this name"} repeats`} value={row.freq} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, names: currentDraft.names.map((item, at) => at === index ? { ...item, freq: event.target.value as NameRow["freq"] } : item) }))}>
                <option value="normal">Normal</option>
                <option value="once">Once</option>
                <option value="hold">Exclude from repeats</option>
              </select>
              <button type="button" onClick={() => index > 0 && setDraft((currentDraft) => ({ ...currentDraft, names: swap(currentDraft.names, index, index - 1) }))}>Up</button>
              <button type="button" onClick={() => index < draft.names.length - 1 && setDraft((currentDraft) => ({ ...currentDraft, names: swap(currentDraft.names, index, index + 1) }))}>Down</button>
              <button type="button" onClick={() => setDraft((currentDraft) => ({ ...currentDraft, names: currentDraft.names.filter((_, at) => at !== index) }))}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft((currentDraft) => ({ ...currentDraft, names: [...currentDraft.names, { text: "", freq: "normal" }] }))}>Add a name</button>
        </fieldset>
        <fieldset>
          <legend>Verses</legend>
          {draft.verses.map((verse, index) => (
            <textarea key={index} aria-label={`Verse ${index + 1}`} value={verse} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, verses: currentDraft.verses.map((item, at) => at === index ? event.target.value : item) }))} />
          ))}
          <button type="button" onClick={() => setDraft((currentDraft) => ({ ...currentDraft, verses: [...currentDraft.verses, ""] }))}>Add a verse</button>
        </fieldset>
        <fieldset>
          <legend>Stories</legend>
          {draft.stories.map((story, index) => (
            <textarea key={index} aria-label={`Story ${index + 1}`} value={story} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, stories: currentDraft.stories.map((item, at) => at === index ? event.target.value : item) }))} />
          ))}
          <button type="button" onClick={() => setDraft((currentDraft) => ({ ...currentDraft, stories: [...currentDraft.stories, ""] }))}>Add a story</button>
        </fieldset>
        <label className="field"><span>When the words run out</span>
          <select aria-label="Filler" value={draft.filler} onChange={(event) => setDraft({ ...draft, filler: event.target.value as Draft["filler"] })}>
            <option value="stories">Repeat stories</option>
            <option value="names">Repeat names</option>
            <option value="lines">Rare edge line</option>
          </select>
        </label>
        <label className="field"><span>Between names</span>
          <select aria-label="Name spacing" value={draft.nameGap} onChange={(event) => setDraft({ ...draft, nameGap: event.target.value as Draft["nameGap"] })}>
            <option value="dot">Centered dot</option>
            <option value="space">Word space</option>
          </select>
        </label>
        <label className="field"><span>Text size</span>
          <select aria-label="Text size" value={draft.textScale < 0.82 ? "small" : "standard"} onChange={(event) => setDraft({ ...draft, textScale: event.target.value === "small" ? 0.77 : 0.86 })}>
            <option value="standard">Standard</option>
            <option value="small">Smaller</option>
          </select>
        </label>
        <label className="field"><span>Format</span>
          <select aria-label="Format" value={draft.productId} onChange={(event) => {
            const next = model.products.find((item) => item.id === event.target.value) ?? model.products[0];
            const sizeId = next.sizes.some((size) => size.id === draft.sizeId) ? draft.sizeId : next.sizes[0].id;
            setDraft({ ...draft, productId: next.id, sizeId });
          }}>
            {model.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Print size</span>
          <select aria-label="Print size" value={draft.sizeId} onChange={(event) => {
            setDraft({ ...draft, sizeId: event.target.value });
          }}>
            {sizeChoices.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        <button className="btn-gold" type="submit" disabled={saving}>Save revision</button>
        <label className="field"><span>Or describe a change</span>
          <textarea aria-label="Change request" value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Make the center bolder, or keep Hanadi only once." />
        </label>
        <button className="btn-ghost" type="button" disabled={saving || request.trim().length < 3} onClick={() => void interpret()}>Apply written request</button>
        {model.llmReady ? null : <p className="note">Free-text changes need OPENAI_API_KEY. The controls above still save a revision.</p>}
      </form>
      <section className="proof-history">
        <h2>Versions</h2>
        <div className="version-row">
          {versions.map((version) => (
            <button type="button" key={version.number} className={version.number === current ? "version on" : "version"} onClick={() => applyVersion(version)}>
              <img src={`/api/designs/${model.id}/asset/v${version.number}.png`} alt="" />
              <span>Version {version.number}{approved === version.number ? ", approved" : ""}</span>
            </button>
          ))}
        </div>
        <label className="field"><span>Compare with</span>
          <select aria-label="Compare version" value={other && other.number !== shown?.number ? compare : ""} onChange={(event) => setCompare(Number(event.target.value))}>
            {versions.filter((version) => version.number !== shown?.number).map((version) => (
              <option key={version.number} value={version.number}>Version {version.number}</option>
            ))}
          </select>
        </label>
        {shown && other && other.number !== shown.number ? (
          <>
            <div className="compare">
              <figure>
                <img src={`/api/designs/${model.id}/asset/v${shown.number}.png`} alt={`Version ${shown.number}`} />
                <figcaption>Version {shown.number}</figcaption>
              </figure>
              <figure>
                <img src={`/api/designs/${model.id}/asset/v${other.number}.png`} alt={`Version ${other.number}`} />
                <figcaption>Version {other.number}</figcaption>
              </figure>
            </div>
            <ul className="compare-notes">
              {changes.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </>
        ) : (
          <p className="note">Choose another version to see them side by side.</p>
        )}
        {revertStatus ? <p className="note" role="status">{revertStatus}</p> : null}
        {shown ? <button className="btn-ghost" type="button" disabled={saving} onClick={() => void revert()}>{revertStatus === "Saving..." ? "Saving..." : "Revert to this version"}</button> : null}
        <p className="note">Family link: <a href={share}>{share}</a></p>
        <ul>{comments.map((comment) => <li key={comment.id}><strong>{comment.author}</strong> {comment.text}</li>)}</ul>
      </section>
    </div>
  );
}

function swap<T>(items: T[], from: number, to: number) {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
