"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FONTS, FORMATS, PALETTES, SIZES, STORIES, artboardFor, money, type FontId, type FormatId, type PaletteId, type SizeId } from "@/lib/catalog";
import { extractRidges } from "@/lib/fingerprint/extract";
import { loadTypeface } from "@/lib/fingerprint/font-loader";
import { renderArtwork } from "@/lib/fingerprint/render";
import type { RGBA, RidgeSet } from "@/lib/fingerprint/types";

type Slot = {
  id: string;
  previewUrl: string | null;
  dataUrl: string | null;
  rgba: RGBA | null;
  phrases: string[];
  ridges: RidgeSet | null;
};

const emptySlot = (phrases: string[]): Slot => ({
  id: crypto.randomUUID(),
  previewUrl: null,
  dataUrl: null,
  rgba: null,
  phrases,
  ridges: null,
});

async function blobToSlot(blob: Blob, phrases: string[], previous?: Slot): Promise<Slot> {
  const bitmap = await createImageBitmap(blob);
  const maxEdge = 1100;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(2, Math.round(bitmap.width * scale));
  const height = Math.max(2, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not read the photograph.");
  context.drawImage(bitmap, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/png");
  bitmap.close();
  return {
    id: previous?.id ?? crypto.randomUUID(),
    previewUrl: dataUrl,
    dataUrl,
    rgba: { data: image.data, width, height },
    phrases: previous?.phrases ?? phrases,
    ridges: null,
  };
}

export function Studio() {
  const router = useRouter();
  const [prints, setPrints] = useState<Slot[]>([emptySlot(STORIES.memorial.prints[0].phrases)]);
  const [fontId, setFontId] = useState<FontId>("garamond");
  const [ink, setInk] = useState<string>(PALETTES[0].ink);
  const [ink2, setInk2] = useState<string>(PALETTES[0].ink2);
  const [background, setBackground] = useState<string>(PALETTES[0].background);
  const [palette, setPalette] = useState<PaletteId>(PALETTES[0].id);
  const [density, setDensity] = useState(1);
  const [tracking, setTracking] = useState(0.04);
  const [caption, setCaption] = useState(STORIES.memorial.caption);
  const [invert, setInvert] = useState<"auto" | "yes" | "no">("auto");
  const [sizeId, setSizeId] = useState<SizeId>("8x10");
  const [formatId, setFormatId] = useState<FormatId>("digital");
  const [svg, setSvg] = useState("");
  const [status, setStatus] = useState("Preparing a sample print…");
  const [error, setError] = useState("");
  const [cameraFor, setCameraFor] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const booted = useRef(false);

  const price = FORMATS[formatId].prices[sizeId];

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const response = await fetch("/samples/loop.png");
        const blob = await response.blob();
        const slot = await blobToSlot(blob, STORIES.memorial.prints[0].phrases);
        setPrints([slot]);
      } catch {
        setError("The sample print could not be loaded.");
        setStatus("");
      }
    })();
  }, []);

  useEffect(() => {
    const ready = prints.filter((print) => print.rgba);
    if (!ready.length) return;
    let cancel = false;
    const timer = window.setTimeout(async () => {
      setStatus("Setting the words into the ridges…");
      setError("");
      try {
        const font = await loadTypeface(fontId);
        const next = prints.map((print) => {
          if (!print.rgba) return print;
          if (print.ridges) return print;
          return { ...print, ridges: extractRidges(print.rgba, { density, invert }) };
        });
        if (next.some((print, index) => print.ridges !== prints[index].ridges)) setPrints(next);
        const usable = next.filter((print) => print.ridges && print.ridges.paths.length > 0);
        if (!usable.length) {
          setSvg("");
          setError("We couldn't find ridge lines. Try a clearer photo, or switch Invert.");
          setStatus("");
          return;
        }
        const board = artboardFor(sizeId, 1100);
        const art = renderArtwork(
          usable.map((print) => print.ridges as RidgeSet),
          {
            prints: usable.map((print) => ({ image: print.rgba as RGBA, phrases: print.phrases })),
            ink,
            ink2: usable.length > 1 ? ink2 : ink,
            background,
            caption,
            density,
            tracking,
            invert,
            artboard: board,
          },
          font,
        );
        if (!cancel) {
          setSvg(art.svg);
          setStatus(art.glyphCount ? `${art.ridgeCount} ridges · ${art.glyphCount} letters` : "Add words to form the ridges");
        }
      } catch (reason) {
        if (!cancel) {
          setError(reason instanceof Error ? reason.message : "The preview could not be drawn.");
          setStatus("");
        }
      }
    }, 160);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [prints, fontId, ink, ink2, background, density, tracking, caption, invert, sizeId]);

  useEffect(() => {
    if (cameraFor === null) return;
    let stopped = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((stream) => {
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError("The camera is unavailable. You can upload a photo instead."));
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraFor]);

  function updateSlot(index: number, patch: Partial<Slot>) {
    setPrints((current) => current.map((print, i) => (i === index ? { ...print, ...patch } : print)));
  }

  async function onFile(index: number, file: File | Blob | null) {
    if (!file) return;
    const slot = await blobToSlot(file, prints[index]?.phrases ?? [""], prints[index]);
    setPrints((current) => current.map((print, i) => (i === index ? { ...slot, phrases: print.phrases } : print)));
  }

  function applyStory(key: string) {
    const story = STORIES[key];
    setCaption(story.caption);
    setPrints((current) => {
      const count = story.prints.length;
      const next: Slot[] = [];
      for (let i = 0; i < count; i++) {
        const existing = current[i];
        next.push(
          existing
            ? { ...existing, phrases: story.prints[i].phrases, ridges: null }
            : emptySlot(story.prints[i].phrases),
        );
      }
      return next;
    });
    if (story.prints.length > 1) {
      void fetch("/samples/whorl.png")
        .then((response) => response.blob())
        .then((blob) => blobToSlot(blob, story.prints[1].phrases))
        .then((slot) => {
          setPrints((current) => {
            if (current.length < 2 || current[1].rgba) return current;
            const copy = [...current];
            copy[1] = { ...slot, phrases: current[1].phrases };
            return copy;
          });
        })
        .catch(() => undefined);
    }
  }

  function continueToCheckout() {
    const payload = {
      sizeId,
      formatId,
      fontId,
      ink,
      ink2,
      background,
      density,
      tracking,
      caption,
      invert,
      prints: prints
        .filter((print) => print.dataUrl)
        .map((print) => ({ imageDataUrl: print.dataUrl, phrases: print.phrases.map((phrase) => phrase.trim()).filter(Boolean) })),
    };
    sessionStorage.setItem("fl-design", JSON.stringify(payload));
    router.push("/checkout");
  }

  const canOrder = prints.some((print) => print.dataUrl) && prints.every((print) => !print.rgba || print.phrases.some((phrase) => phrase.trim()));
  const second = prints.length > 1;
  const cameraLabel = useMemo(() => (cameraFor === null ? "" : `Print ${cameraFor + 1}`), [cameraFor]);

  return (
    <div className="studio-shell wrap-wide">
      <div className="preview-panel">
        {svg ? (
          <div className="preview-stage" dangerouslySetInnerHTML={{ __html: svg.replace(/^<\?xml[^>]*>\s*/i, "") }} />
        ) : (
          <div className="preview-stage">
            <p className="help">{status || "The print will appear here."}</p>
          </div>
        )}
        <div className="preview-meta">
          <span>{status}</span>
          <span>
            {SIZES[sizeId].label} · {money(price)}
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="controls">
        <section className="panel">
          <h2>The print</h2>
          <p className="help">Use an inked fingerprint on light paper, filling most of the frame. A scan or a phone photo both work.</p>
          <div className="row" style={{ marginTop: 12 }}>
            {Object.entries(STORIES).map(([key, story]) => (
              <button key={key} className="chip" type="button" onClick={() => applyStory(key)}>
                {story.label}
              </button>
            ))}
          </div>
          {prints.map((print, index) => (
            <div key={print.id} style={{ marginTop: 16 }}>
              <div className="label">{prints.length > 1 ? `Print ${index + 1}` : "Photograph"}</div>
              <div className="drop">
                {print.previewUrl && <img className="thumb" src={print.previewUrl} alt="" style={{ margin: "0 auto 10px" }} />}
                <input
                  aria-label={`Upload print ${index + 1}`}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => void onFile(index, event.target.files?.[0] ?? null)}
                />
                <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
                  <button className="ghost" type="button" onClick={() => setCameraFor(index)}>
                    Use camera
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => void fetch(index === 0 ? "/samples/loop.png" : "/samples/whorl.png").then((r) => r.blob()).then((blob) => onFile(index, blob))}
                  >
                    Use sample
                  </button>
                </div>
              </div>
              <div className="label" style={{ marginTop: 12 }}>
                Words for this print
              </div>
              {print.phrases.map((phrase, phraseIndex) => (
                <div className="phrase" key={`${print.id}-${phraseIndex}`}>
                  <input
                    aria-label={`Phrase ${phraseIndex + 1} on print ${index + 1}`}
                    value={phrase}
                    onChange={(event) => {
                      const phrases = [...print.phrases];
                      phrases[phraseIndex] = event.target.value;
                      updateSlot(index, { phrases });
                    }}
                  />
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => updateSlot(index, { phrases: print.phrases.filter((_, i) => i !== phraseIndex) })}
                    aria-label="Remove phrase"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button className="ghost" type="button" style={{ marginTop: 8 }} onClick={() => updateSlot(index, { phrases: [...print.phrases, ""] })}>
                Add a line
              </button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 14 }}>
            {!second ? (
              <button className="ghost" type="button" onClick={() => setPrints((current) => [...current, emptySlot(["", ""])])}>
                Add a second print
              </button>
            ) : (
              <button className="ghost" type="button" onClick={() => setPrints((current) => current.slice(0, 1))}>
                Use one print
              </button>
            )}
          </div>
          <p className="help">Two prints are placed together and turned slightly, for a couple or two generations. A third print can follow the same path later.</p>
        </section>

        <section className="panel">
          <h2>The look</h2>
          <div className="label">Color</div>
          <div className="swatches" style={{ marginTop: 8 }}>
            {PALETTES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="swatch"
                aria-pressed={palette === item.id}
                onClick={() => {
                  setPalette(item.id);
                  setInk(item.ink);
                  setInk2(item.ink2);
                  setBackground(item.background);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="colors">
            <label className="field">
              <span>Ink</span>
              <input type="color" value={ink} onChange={(event) => setInk(event.target.value)} />
            </label>
            <label className="field">
              <span>Paper</span>
              <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
            </label>
            {second && (
              <label className="field">
                <span>Second ink</span>
                <input type="color" value={ink2} onChange={(event) => setInk2(event.target.value)} />
              </label>
            )}
          </div>
          <div className="label" style={{ marginTop: 12 }}>
            Type
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {FONTS.map((font) => (
              <button key={font.id} type="button" className="chip" aria-pressed={fontId === font.id} onClick={() => setFontId(font.id)}>
                {font.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Ridge density {density.toFixed(2)}</span>
            <input
              type="range"
              min={0.8}
              max={1.35}
              step={0.01}
              value={density}
              onChange={(event) => {
                setDensity(Number(event.target.value));
                setPrints((current) => current.map((print) => ({ ...print, ridges: null })));
              }}
            />
          </label>
          <label className="field">
            <span>Letter spacing {tracking.toFixed(2)}</span>
            <input type="range" min={0} max={0.12} step={0.005} value={tracking} onChange={(event) => setTracking(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Invert</span>
            <select
              value={invert}
              onChange={(event) => {
                setInvert(event.target.value as typeof invert);
                setPrints((current) => current.map((print) => ({ ...print, ridges: null })));
              }}
            >
              <option value="auto">Auto</option>
              <option value="no">Dark ink on light paper</option>
              <option value="yes">Light ink on a dark ground</option>
            </select>
          </label>
          <label className="field">
            <span>Caption under the print</span>
            <input value={caption} maxLength={140} onChange={(event) => setCaption(event.target.value)} />
          </label>
        </section>

        <section className="panel">
          <h2>Size & format</h2>
          <label className="field">
            <span>Size</span>
            <select value={sizeId} onChange={(event) => setSizeId(event.target.value as SizeId)}>
              {(Object.keys(SIZES) as SizeId[]).map((id) => (
                <option key={id} value={id}>
                  {SIZES[id].label}
                </option>
              ))}
            </select>
          </label>
          <div className="row" style={{ marginTop: 12 }}>
            {(Object.keys(FORMATS) as FormatId[]).map((id) => (
              <button key={id} type="button" className="chip" aria-pressed={formatId === id} onClick={() => setFormatId(id)}>
                {FORMATS[id].name} · {money(FORMATS[id].prices[sizeId])}
              </button>
            ))}
          </div>
          <p className="help">{FORMATS[formatId].summary}</p>
          <button className="btn full" type="button" disabled={!canOrder || !svg} onClick={continueToCheckout} style={{ marginTop: 16 }}>
            Continue · {money(price)}
          </button>
        </section>
      </div>

      {cameraFor !== null && (
        <div className="camera" role="dialog" aria-label={`Camera for ${cameraLabel}`}>
          <div className="camera-card">
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  const canvas = document.createElement("canvas");
                  canvas.width = video.videoWidth || 1280;
                  canvas.height = video.videoHeight || 720;
                  canvas.getContext("2d")?.drawImage(video, 0, 0);
                  canvas.toBlob((blob) => {
                    if (blob && cameraFor !== null) void onFile(cameraFor, blob);
                    setCameraFor(null);
                  }, "image/jpeg", 0.95);
                }}
              >
                Capture
              </button>
              <button className="btn secondary" type="button" onClick={() => setCameraFor(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
