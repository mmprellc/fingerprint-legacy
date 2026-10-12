"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewSvg, mapPrint } from "@/lib/fingerprint/preview";
import { INK_PRESETS, type PrintStyle, type Ridge, type RidgeFontId } from "@/lib/fingerprint/types";
import type { StudioPiece } from "@/lib/pieces";
import { formatMoney, buyableProducts, productById } from "@/lib/products";
import type { Occasion } from "@/lib/content";

type Draft = {
  key: string;
  label: string;
  src: string;
  width: number;
  height: number;
  period: number;
  ridges: Ridge[];
  lines: string[];
  tx: number;
  ty: number;
  rotation: number;
  scale: number;
};

type SampleFile = { width: number; height: number; period: number; ridges: Ridge[] };

export function StudioClient({
  initialOccasion,
  initialPiece,
  initialProduct,
  autoload,
  couple,
  occasions,
}: {
  initialOccasion?: Occasion;
  initialPiece?: StudioPiece;
  initialProduct: string;
  autoload: boolean;
  couple: boolean;
  occasions: Occasion[];
}) {
  const [prints, setPrints] = useState<Draft[]>([]);
  const [style, setStyle] = useState<PrintStyle>(
    initialPiece?.style ?? {
      font: "baskerville",
      preset: "charcoal",
      textScale: 1,
      title: initialOccasion?.honoree ?? "",
      script: initialOccasion ? "" : "Always with you.",
      ...(initialOccasion ? { centerName: initialOccasion.honoree, names: initialOccasion.lines, footer: initialOccasion.script } : {}),
    },
  );
  const [productId, setProductId] = useState(initialProduct);
  const [sizeId, setSizeId] = useState(productById(initialProduct).sizes[0].id);
  const [view, setView] = useState<"words" | "lines" | "overlay" | "side">("words");
  const [zoom, setZoom] = useState(1);
  const [tone, setTone] = useState<"auto" | "dark" | "light">("auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retake, setRetake] = useState<{ title: string; detail: string; steps: string[] } | null>(null);
  const [seedLines, setSeedLines] = useState(initialOccasion?.lines ?? ["A name", "A date", "A place they loved"]);
  const [occasionSlug, setOccasionSlug] = useState(initialOccasion?.slug ?? "");
  const [linesOpen, setLinesOpen] = useState(() => !hasList(initialPiece?.style.names) && !hasList(initialPiece?.style.scriptures) && !hasList(initialOccasion?.lines));
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialPiece) {
      if (initialPiece.printUrl && initialPiece.imageUrl) void loadAddress(initialPiece.printUrl, initialPiece.imageUrl, "Randy's print", 0);
      else void loadNamed(initialPiece.sample, [], 0);
      return;
    }
    if (couple) {
      void loadCouple(initialOccasion);
    } else if (autoload) {
      void loadNamed(initialOccasion?.sample ?? "loop", initialOccasion?.lines ?? ["A name", "A date", "A place they loved"], 0);
    } else if (initialOccasion) {
      setPrints([]);
    }
  }, [autoload, couple, initialOccasion, initialPiece]);

  useEffect(() => () => stopCamera(), []);

  const product = productById(productId);
  const preset = INK_PRESETS.find((item) => item.id === style.preset) ?? INK_PRESETS[0];
  const period = prints[0]?.period ?? 12;

  const svg = useMemo(() => {
    if (!prints.length) return "";
    const aligned = view !== "words";
    const previewStyle = aligned ? { ...style, title: "", script: "", footer: "" } : style;
    const built = buildPreviewSvg(
      prints.map(toPreview),
      previewStyle,
      period,
      { transparent: view === "overlay" || view === "lines", fontFamily: "inherit" },
    );
    if (view === "lines") {
      const strokes = prints.flatMap((print) => mapPrint(toPreview(print))).map((ridge) => {
        const d = ridge.points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        return `<path d="${d}" fill="none" stroke="${preset.ink}" stroke-width="${Math.max(1, period * 0.16)}" stroke-linecap="round"/>`;
      });
      return built.svg.replace(/<text[\s\S]*?<\/text>/g, "").replace(/<g class="ridge-ink">[\s\S]*?<\/g>/, "").replace("</svg>", `${strokes.join("")}</svg>`);
    }
    return built.svg;
  }, [prints, style, period, view, preset.ink]);

  async function loadAddress(jsonUrl: string, imageUrl: string, label: string, slot: number) {
    setBusy(true);
    setError("");
    try {
      const data = (await fetch(jsonUrl).then((response) => response.json())) as SampleFile;
      const draft: Draft = {
        key: `${jsonUrl}-${slot}-${Date.now()}`,
        label,
        src: imageUrl,
        width: data.width,
        height: data.height,
        period: data.period,
        ridges: data.ridges,
        lines: [],
        tx: 0,
        ty: 0,
        rotation: 0,
        scale: 1,
      };
      setRetake(null);
      setPrints((current) => {
        const next = current.slice(0, 2);
        next[slot] = draft;
        return next.filter(Boolean);
      });
    } catch {
      setError("The print could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function loadNamed(name: string, lines: string[], slot: number) {
    setBusy(true);
    setError("");
    try {
      const data = (await fetch(`/samples/${name}.json`).then((response) => response.json())) as SampleFile;
      const draft: Draft = {
        key: `${name}-${slot}-${Date.now()}`,
        label: name === "whorl" ? "Sample whorl" : "Sample loop",
        src: `/samples/${name}.png`,
        width: data.width,
        height: data.height,
        period: data.period,
        ridges: data.ridges,
        lines,
        tx: slot ? data.width * 0.32 : 0,
        ty: slot ? 20 : 0,
        rotation: slot ? -8 : 0,
        scale: slot ? 0.94 : 1,
      };
      setRetake(null);
      setPrints((current) => {
        const next = current.slice(0, 2);
        next[slot] = draft;
        return next.filter(Boolean);
      });
    } catch {
      setError("The sample print could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function loadCouple(occasion?: Occasion) {
    setBusy(true);
    setError("");
    try {
      const [loop, whorl] = await Promise.all([
        fetch("/samples/loop.json").then((response) => response.json()) as Promise<SampleFile>,
        fetch("/samples/whorl.json").then((response) => response.json()) as Promise<SampleFile>,
      ]);
      const firstLines = occasion?.lines ?? ["Elena Voss", "June 14", "the orchard", "I choose you"];
      const secondLines = ["Jonah Ellis", "June 14", "the orchard", "I choose you", "the song we danced"];
      setRetake(null);
      setPrints([
        draftFrom("loop", "First print", loop, firstLines, 0),
        draftFrom("whorl", "Second print", whorl, secondLines, 1),
      ]);
    } catch {
      setError("The paired samples could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | null, slot: number) {
    if (!file) return;
    setBusy(true);
    setError("");
    stopCamera();
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("ridges", tone);
      body.set("style", JSON.stringify(style));
      const response = await fetch("/api/studio/extract", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The print could not be read.");
      if (!payload.accepted) {
        setRetake(payload.retake ?? { title: "Retake the photo.", detail: "We could not read a fingerprint from that photo.", steps: [] });
        setPrints((current) => current.filter((_, index) => index !== slot));
        return;
      }
      setRetake(null);
      if (typeof payload.textScale === "number" && Math.abs(payload.textScale - style.textScale) > 0.02) {
        setStyle((current) => ({ ...current, textScale: payload.textScale }));
      }
      const src = URL.createObjectURL(file);
      const draft: Draft = {
        key: `upload-${slot}-${Date.now()}`,
        label: file.name || "Your print",
        src,
        width: payload.width,
        height: payload.height,
        period: payload.period,
        ridges: payload.ridges,
        lines: prints[slot]?.lines?.length ? prints[slot].lines : seedLines,
        tx: slot ? payload.width * 0.3 : 0,
        ty: 0,
        rotation: slot ? -8 : 0,
        scale: 1,
      };
      setPrints((current) => {
        const next = current.slice();
        next[slot] = draft;
        return next.filter(Boolean);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The print could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function openCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setError("The camera is unavailable. You can upload a photo instead.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function snap() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 800;
    canvas.height = video.videoHeight || 1000;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      void onFile(new File([blob], "camera.jpg", { type: "image/jpeg" }), prints.length > 1 ? 0 : 0);
    }, "image/jpeg", 0.92);
  }

  function updateLines(slot: number, lines: string[]) {
    setPrints((current) => current.map((print, index) => (index === slot ? { ...print, lines } : print)));
  }

  async function checkout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prints: prints.map(toPreview),
          style,
          period,
          productId,
          sizeId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The design could not be saved.");
      window.location.href = `/checkout?design=${payload.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The design could not be saved.");
      setBusy(false);
    }
  }

  const ready = prints.some((print) => print.ridges.length > 8) && (
    hasList(style.names) || hasList(style.scriptures) || Boolean(style.centerName?.trim()) || prints.some((print) => print.lines.some((line) => line.trim()))
  );
  const fontClass = style.font === "cormorant" ? "font-cormorant" : "font-baskerville";

  return (
    <div className="studio">
      <section className="stage">
        <div className="stage-tools" role="toolbar" aria-label="Preview">
          {(["words", "lines", "overlay", "side"] as const).map((mode) => (
            <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>
              {mode === "words" ? "Words" : mode === "lines" ? "Ridge lines" : mode === "overlay" ? "Overlay" : "Side by side"}
            </button>
          ))}
          <label>
            Zoom
            <input type="range" min={0.6} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
        </div>
        {!prints.length ? (
          <p className="lede">Upload a print, or begin with the sample. The ridges you see are the ones the words will follow.</p>
        ) : view === "side" ? (
          <div className="compare">
            {prints.map((print) => (
              <figure key={print.key}>
                <figcaption>Original · {print.label}</figcaption>
                <img src={print.src} alt={`Original fingerprint, ${print.label}`} />
              </figure>
            ))}
            <figure>
              <figcaption>Word-filled ridges</figcaption>
              <div className={`svg-hold ${fontClass}`} style={{ background: preset.paper }} dangerouslySetInnerHTML={{ __html: svg }} />
            </figure>
          </div>
        ) : (
          <div className="preview-scroll">
            <div className="preview-zoom" style={{ transform: `scale(${zoom})` }}>
              {view === "overlay" && prints[0] ? (
                <div className="overlay-stack">
                  <img src={prints[0].src} alt="Original fingerprint under the portrait" />
                  <div className={`svg-hold ${fontClass}`} dangerouslySetInnerHTML={{ __html: svg }} />
                </div>
              ) : (
                <div className={`svg-hold ${fontClass}`} style={{ background: view === "lines" ? preset.paper : preset.paper }} dangerouslySetInnerHTML={{ __html: svg }} />
              )}
            </div>
          </div>
        )}
        {prints[0] ? <p className="note">{prints.reduce((sum, print) => sum + print.ridges.length, 0)} ridge lines. Step closer with the zoom.</p> : null}
      </section>

      <aside className="controls">
        {retake ? (
          <div className="alert retake" role="alert">
            <strong>{retake.title}</strong>
            <p>{retake.detail}</p>
            {retake.steps?.length ? (
              <ul>
                {retake.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {busy ? <p>Reading the ridges…</p> : null}
        <h2>The print</h2>
        <div className="stage-tools">
          <button type="button" onClick={() => loadNamed("loop", seedLines, 0)}>Try the sample print</button>
          <button type="button" onClick={() => loadCouple(initialOccasion)}>Two intertwined prints</button>
        </div>
        <label className="file-btn">
          Upload a photo
          <input type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0] ?? null, 0)} />
        </label>
        <label className="file-btn">
          Take a photo
          <input type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0] ?? null, 0)} />
        </label>
        <button className="icon-btn" type="button" onClick={openCamera}>Use the camera</button>
        {cameraOn ? (
          <div className="camera">
            <video ref={videoRef} playsInline muted />
            <button className="btn-dark" type="button" onClick={snap}>Capture</button>
            <button className="btn-ghost" type="button" onClick={stopCamera}>Close camera</button>
          </div>
        ) : null}
        <label className="field">
          <span>Ridges in the photo</span>
          <select value={tone} onChange={(event) => setTone(event.target.value as typeof tone)}>
            <option value="auto">Detect automatically</option>
            <option value="dark">Dark ridges on light paper</option>
            <option value="light">Light ridges on a dark ground</option>
          </select>
        </label>
        {prints.length < 2 ? (
          <div>
            <label className="file-btn">
              Add a second print
              <input type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0] ?? null, 1)} />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>Overlap of the second print</span>
            <input type="range" min={0} max={prints[0].width} value={prints[1].tx} onChange={(event) => setPrints((current) => current.map((print, index) => index === 1 ? { ...print, tx: Number(event.target.value) } : print))} />
          </label>
        )}

        <h2>Their words</h2>
        <label className="field"><span>Title above the portrait</span><input type="text" value={style.title} onChange={(event) => setStyle({ ...style, title: event.target.value })} /></label>
        <label className="field"><span>Center dedication, on the innermost ridges</span><input type="text" value={style.centerName ?? ""} aria-label="Center name" onChange={(event) => setStyle({ ...style, centerName: event.target.value })} /></label>
        <label className="field"><span>With the center dedication</span><input type="text" value={style.centerDetail ?? ""} aria-label="Center date or detail" onChange={(event) => setStyle({ ...style, centerDetail: event.target.value })} /></label>
        <label className="field"><span>Secondary dedication, on the next ridges</span><input type="text" value={style.secondaryName ?? ""} aria-label="Secondary name" onChange={(event) => setStyle({ ...style, secondaryName: event.target.value })} /></label>
        <label className="field"><span>With the secondary dedication</span><input type="text" value={style.secondaryDetail ?? ""} aria-label="Secondary date or detail" onChange={(event) => setStyle({ ...style, secondaryDetail: event.target.value })} /></label>
        <label className="field">
          <span>Names along the ridges, one per line</span>
          <textarea className="names" value={(style.names ?? []).join("\n")} onChange={(event) => setStyle({ ...style, names: event.target.value.split("\n") })} />
        </label>
        <label className="field">
          <span>Scriptures, one verse per line</span>
          <textarea className="verses" value={(style.scriptures ?? []).join("\n")} onChange={(event) => setStyle({ ...style, scriptures: event.target.value.split("\n") })} />
        </label>
        <p className="note">Every ridge is text. The center dedication follows the innermost loop, a little larger. The secondary dedication follows the next ridges. Names stay whole, and the verses repeat between them.</p>
        <label className="field"><span>Line under the portrait</span><input type="text" value={style.footer ?? ""} onChange={(event) => setStyle({ ...style, footer: event.target.value })} /></label>
        <label className="field"><span>Script line, if the footer is empty</span><input type="text" value={style.script} onChange={(event) => setStyle({ ...style, script: event.target.value })} /></label>
        <details open={linesOpen} onToggle={(event) => setLinesOpen(event.currentTarget.open)}>
          <summary>Short lines, when the name list is empty</summary>
          {prints.map((print, slot) => (
            <div key={print.key}>
              <p className="note">{print.label}</p>
              {print.lines.map((line, index) => (
                <div className="line-row" key={`${print.key}-${index}`}>
                  <input
                    type="text"
                    value={line}
                    aria-label={`Line ${index + 1} for ${print.label}`}
                    onChange={(event) => {
                      const lines = print.lines.slice();
                      lines[index] = event.target.value;
                      updateLines(slot, lines);
                    }}
                  />
                  <button className="icon-btn" type="button" onClick={() => updateLines(slot, print.lines.filter((_, lineIndex) => lineIndex !== index))} aria-label="Remove line">Remove</button>
                </div>
              ))}
              <button className="icon-btn" type="button" onClick={() => updateLines(slot, [...print.lines, ""])}>Add a line</button>
            </div>
          ))}
          {!prints.length ? <p className="note">Lines appear once a print is loaded.</p> : null}
        </details>

        <h2>Finish</h2>
        <div className="swatches" role="radiogroup" aria-label="Color">
          {INK_PRESETS.map((item) => (
            <button key={item.id} type="button" aria-pressed={style.preset === item.id} onClick={() => setStyle({ ...style, preset: item.id })}>
              <i className="swatch" style={{ background: item.ink, boxShadow: `inset 0 0 0 6px ${item.paper}` }} /> {item.label}
            </button>
          ))}
        </div>
        <div className="stage-tools">
          <button type="button" aria-pressed={style.font === "baskerville"} onClick={() => setStyle({ ...style, font: "baskerville" as RidgeFontId })}>Baskerville</button>
          <button type="button" aria-pressed={style.font === "cormorant"} onClick={() => setStyle({ ...style, font: "cormorant" as RidgeFontId })}>Cormorant</button>
        </div>
        <label className="field">
          <span>Text size</span>
          <input type="range" min={0.75} max={1.25} step={0.05} value={style.textScale} onChange={(event) => setStyle({ ...style, textScale: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Format</span>
          <select value={productId} onChange={(event) => { setProductId(event.target.value); setSizeId(productById(event.target.value).sizes[0].id); }}>
            {buyableProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.priceCents)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Size</span>
          <select value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
            {product.sizes.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Start from an occasion</span>
          <select
            value={occasionSlug}
            onChange={(event) => {
              const slug = event.target.value;
              setOccasionSlug(slug);
              const next = occasions.find((item) => item.slug === slug);
              if (!next) return;
              setSeedLines(next.lines);
              setStyle((current) => ({
                ...current,
                title: next.honoree,
                script: "",
                footer: next.script,
                centerName: next.honoree,
                centerDetail: "",
                secondaryName: "",
                secondaryDetail: "",
                names: next.lines,
                scriptures: [],
              }));
              if (prints[0]) updateLines(0, next.lines);
            }}
          >
            <option value="">Choose</option>
            {occasions.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
          </select>
        </label>
        <div className="checkout-bar">
          <strong>{formatMoney(product.priceCents)}</strong>
          <button className="btn-gold" type="button" disabled={!ready || busy} onClick={checkout}>Continue to checkout</button>
        </div>
      </aside>
      <style>{`
        .font-baskerville svg text.ridge, .font-baskerville svg text.plaque-name { font-family: var(--font-ridge), "Libre Baskerville", serif; }
        .font-cormorant svg text.ridge, .font-cormorant svg text.plaque-name { font-family: var(--font-ridge-alt), "Cormorant Garamond", serif; }
        .svg-hold svg text.piece-title, .svg-hold svg text.piece-footer, .svg-hold svg text.plaque-detail { font-family: var(--font-serif), "Cormorant Garamond", serif; }
        .svg-hold svg text.piece-script { font-family: var(--font-script), cursive; }
      `}</style>
    </div>
  );
}

function hasList(values: string[] | undefined) {
  return Boolean(values?.some((value) => value.trim()));
}

function toPreview(print: Draft) {
  return {
    ridges: print.ridges,
    width: print.width,
    height: print.height,
    lines: print.lines,
    tx: print.tx,
    ty: print.ty,
    rotation: print.rotation,
    scale: print.scale,
  };
}

function draftFrom(name: string, label: string, data: SampleFile, lines: string[], slot: number): Draft {
  return {
    key: `${name}-${slot}`,
    label,
    src: `/samples/${name}.png`,
    width: data.width,
    height: data.height,
    period: data.period,
    ridges: data.ridges,
    lines,
    tx: slot ? data.width * 0.32 : 0,
    ty: slot ? 20 : 0,
    rotation: slot ? -8 : 0,
    scale: slot ? 0.94 : 1,
  };
}
