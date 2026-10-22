"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreviewSvg, mapPrint } from "@/lib/fingerprint/preview";
import { INK_PRESETS, type PrintStyle, type Ridge, type RidgeFontId } from "@/lib/fingerprint/types";
import type { StudioPiece } from "@/lib/pieces";
import { FrameMockup } from "@/components/FrameMockup";
import { frameFinishes, isFrameSize, type FrameFinish } from "@/lib/frames";
import { formatMoney, buyableProducts, productById } from "@/lib/products";
import type { Occasion } from "@/lib/content";
import { clearSampleRidgeStyle, hasDrawableWords, hasRidgeWords, isSampleRidgeStyle, studioRidgeStyle } from "@/lib/studio-default";

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

type MatchCheck = { id: string; passed: boolean; score: number | null; detail: string };
type MatchAttempt = { profile: string; passed: boolean; ridges?: number; checks?: MatchCheck[] };

function formatScore(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(3) : "n/a";
}

function MatchDetails({ attempts }: { attempts: MatchAttempt[] }) {
  if (!attempts.length) return null;
  const shape = attempts
    .map((attempt) => (attempt.checks ?? []).find((check) => check.id === "shape"))
    .find((check) => typeof check?.score === "number");
  const lines = attempts.flatMap((attempt) => {
    const checks = attempt.checks ?? [];
    const attemptShape = checks.find((check) => check.id === "shape");
    const failed = checks.filter((check) => !check.passed);
    return [
      `${attempt.profile}: ${attempt.ridges ?? 0} ridges, shape ${formatScore(attemptShape?.score)}`,
      ...failed.map((check) => `${attempt.profile} ${check.id} ${formatScore(check.score)}. ${check.detail}`),
    ];
  });
  return (
    <details className="match-details" open>
      <summary>Match details. Shape {formatScore(shape?.score)}</summary>
      <ul>
        {lines.map((line, index) => (
          <li key={`${index}-${line}`}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

const UPLOAD_EDGE = 1600;
const UPLOAD_BUDGET = 3_800_000;

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Vercel rejects request bodies over 4.5 MB. The server already scales the long edge to 1600. */
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const timedOut = response.status === 504 || /timeout|an error occurred/i.test(text);
    throw new Error(timedOut ? "The portrait took too long to finish. Try the photo once more." : "The portrait service returned an unexpected response. Try again.");
  }
}

async function shrinkForUpload(file: File) {
  if (file.size <= UPLOAD_BUDGET) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That photo is too large to upload. Export a JPEG and try again.");
  }
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > UPLOAD_EDGE ? UPLOAD_EDGE / long : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.86;
  let blob = await canvasToJpeg(canvas, quality);
  while (blob && blob.size > UPLOAD_BUDGET && quality > 0.5) {
    quality -= 0.12;
    blob = await canvasToJpeg(canvas, quality);
  }
  if (!blob || blob.size > UPLOAD_BUDGET) {
    throw new Error("That photo is too large to upload. Export a JPEG and try again.");
  }
  return new File([blob], "print.jpg", { type: "image/jpeg" });
}

export function StudioClient({
  initialOccasion,
  initialPiece,
  initialProduct,
  initialFrame,
  autoload,
  couple,
  occasions,
  sampleLettering = false,
  waitlist = false,
}: {
  initialOccasion?: Occasion;
  initialPiece?: StudioPiece;
  initialProduct: string;
  initialFrame: FrameFinish;
  autoload: boolean;
  couple: boolean;
  occasions: Occasion[];
  /** The sample view starts with the sample family. A customer's own photo does not. */
  sampleLettering?: boolean;
  waitlist?: boolean;
}) {
  const [prints, setPrints] = useState<Draft[]>([]);
  const [style, setStyle] = useState<PrintStyle>(
    initialPiece?.style ?? {
      font: "cormorant",
      preset: "ink",
      textScale: 1,
      title: initialOccasion?.honoree ?? "",
      script: initialOccasion ? "" : "Always with you.",
      ...(initialOccasion
        ? { centerName: initialOccasion.honoree, names: initialOccasion.lines, footer: initialOccasion.script }
        : sampleLettering
          ? studioRidgeStyle
          : { signature: "Fingerprint Legacy", plaque: true, script: "" }),
    },
  );
  const [productId, setProductId] = useState(initialProduct);
  const [sizeId, setSizeId] = useState(initialProduct === "framed" ? "11x14" : productById(initialProduct).sizes[0].id);
  const [frameId, setFrameId] = useState<FrameFinish>(initialFrame);
  const [printfulUrl, setPrintfulUrl] = useState("");
  const [view, setView] = useState<"words" | "lines" | "overlay" | "side">("words");
  const [zoom, setZoom] = useState(1);
  const [tone, setTone] = useState<"auto" | "dark" | "light">("auto");
  const [toneReady, setToneReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retake, setRetake] = useState<{ title: string; detail: string; steps: string[] } | null>(null);
  const [attempts, setAttempts] = useState<MatchAttempt[]>([]);
  const [notice, setNotice] = useState("");
  const lastUpload = useRef<{ file: File; slot: number } | null>(null);
  const [portraitUrl, setPortraitUrl] = useState("");
  const [portraitReady, setPortraitReady] = useState(false);
  const portraitUrlRef = useRef("");
  const readGen = useRef(0);
  const portraitGen = useRef(0);
  const [seedLines, setSeedLines] = useState(initialOccasion?.lines ?? ["A name", "A date", "A place they loved"]);
  const [occasionSlug, setOccasionSlug] = useState(initialOccasion?.slug ?? "");
  const [linesOpen, setLinesOpen] = useState(() => !hasList(initialPiece?.style.names) && !hasList(initialPiece?.style.scriptures) && !hasList(initialOccasion?.lines));
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const started = useRef(false);
  const pendingFile = useRef<File | null>(null);
  const pendingSlot = useRef(0);
  const [waitingSrc, setWaitingSrc] = useState("");

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

  useEffect(() => {
    setToneReady(true);
    setTone("auto");
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setTone("auto");
      setRetake(null);
      setAttempts([]);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

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

  function beginRead() {
    const gen = readGen.current + 1;
    readGen.current = gen;
    setPortraitReady(false);
    setBusy(true);
    return gen;
  }

  function endRead(gen: number) {
    if (gen !== readGen.current) return;
    setBusy(false);
  }

  async function loadAddress(jsonUrl: string, imageUrl: string, label: string, slot: number) {
    const gen = beginRead();
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
      setAttempts([]);
      setPrints((current) => {
        const next = current.slice(0, 2);
        next[slot] = draft;
        return next.filter(Boolean);
      });
    } catch {
      setError("The print could not be loaded.");
    } finally {
      endRead(gen);
    }
  }

  async function loadNamed(name: string, lines: string[], slot: number) {
    const gen = beginRead();
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
      setAttempts([]);
      setPrints((current) => {
        const next = current.slice(0, 2);
        next[slot] = draft;
        return next.filter(Boolean);
      });
    } catch {
      setError("The sample print could not be loaded.");
    } finally {
      endRead(gen);
    }
  }

  async function loadCouple(occasion?: Occasion) {
    const gen = beginRead();
    setError("");
    try {
      const [loop, whorl] = await Promise.all([
        fetch("/samples/loop.json").then((response) => response.json()) as Promise<SampleFile>,
        fetch("/samples/whorl.json").then((response) => response.json()) as Promise<SampleFile>,
      ]);
      const firstLines = occasion?.lines ?? ["Elena Voss", "June 14", "the orchard", "I choose you"];
      const secondLines = ["Jonah Ellis", "June 14", "the orchard", "I choose you", "the song we danced"];
      setRetake(null);
      setAttempts([]);
      setPrints([
        draftFrom("loop", "First print", loop, firstLines, 0),
        draftFrom("whorl", "Second print", whorl, secondLines, 1),
      ]);
    } catch {
      setError("The paired samples could not be loaded.");
    } finally {
      endRead(gen);
    }
  }

  function forgetPortrait() {
    if (portraitUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(portraitUrlRef.current);
    portraitUrlRef.current = "";
    setPortraitUrl("");
    setPortraitReady(false);
  }

  function holdForWords(file: File, slot: number, nextStyle: PrintStyle) {
    pendingFile.current = file;
    pendingSlot.current = slot;
    setStyle(nextStyle);
    setWaitingSrc((current) => {
      if (current.startsWith("blob:")) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setPrints([]);
    forgetPortrait();
    setRetake(null);
    setError("");
    setNotice("Add a name and a verse. Those words are the ridges of this print. The sample names are left off a photo you upload.");
  }

  async function onFile(file: File | null, slot: number, ridges?: "auto" | "dark" | "light") {
    if (!file) return;
    const chosen = ridges ?? "auto";
    if (!ridges) setTone("auto");
    setError("");
    setAttempts([]);
    stopCamera();
    const nextStyle = clearSampleRidgeStyle(style);
    if (!hasRidgeWords(nextStyle)) {
      holdForWords(file, slot, nextStyle);
      return;
    }
    const gen = beginRead();
    if (isSampleRidgeStyle(style)) setStyle(nextStyle);
    pendingFile.current = null;
    lastUpload.current = { file, slot };
    try {
      const prepared = await shrinkForUpload(file);
      const body = new FormData();
      body.set("file", prepared);
      body.set("ridges", chosen);
      body.set("style", JSON.stringify(nextStyle));
      const response = await fetch("/api/studio/extract", { method: "POST", body, cache: "no-store" });
      const payload = await readJson<{
        accepted?: boolean;
        error?: string;
        portraitPng?: string;
        warnings?: string[];
        textScale?: number;
        width?: number;
        height?: number;
        period?: number;
        ridges?: Draft["ridges"];
        attempts?: MatchAttempt[];
        retake?: { title: string; detail: string; steps: string[] } | null;
      }>(response);
      if (gen !== readGen.current) return;
      if (!response.ok) throw new Error(payload.error || "The print could not be read.");
      setAttempts(Array.isArray(payload.attempts) ? payload.attempts : []);
      if (!payload.accepted || !payload.portraitPng) {
        setRetake(payload.retake ?? { title: "Retake the photo.", detail: "We could not read a fingerprint from that photo.", steps: [] });
        setNotice("");
        setPrints((current) => current.filter((_, index) => index !== slot));
        return;
      }
      setRetake(null);
      setNotice(Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean).join(" ") : "");
      setWaitingSrc((current) => {
        if (current.startsWith("blob:")) URL.revokeObjectURL(current);
        return "";
      });
      rememberPortrait(payload.portraitPng);
      const textScale = payload.textScale;
      if (typeof textScale === "number" && Math.abs(textScale - style.textScale) > 0.02) {
        setStyle((current) => ({ ...current, textScale }));
      }
      const src = URL.createObjectURL(file);
      const width = payload.width ?? 1;
      const draft: Draft = {
        key: `upload-${slot}-${Date.now()}`,
        label: file.name || "Your print",
        src,
        width,
        height: payload.height ?? 1,
        period: payload.period ?? 12,
        ridges: payload.ridges ?? [],
        lines: prints[slot]?.lines?.length ? prints[slot].lines : seedLines,
        tx: slot ? width * 0.3 : 0,
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
      if (gen === readGen.current) setError(reason instanceof Error ? reason.message : "The print could not be read.");
    } finally {
      endRead(gen);
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
    if (busy || !portraitReady) return;
    const gen = readGen.current;
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
          ...(framed ? { frameId } : {}),
        }),
      });
      const payload = await readJson<{ error?: string; id?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "The design could not be saved.");
      window.location.href = `/proof/${payload.id}`;
    } catch (reason) {
      if (gen === readGen.current) {
        setError(reason instanceof Error ? reason.message : "The design could not be saved.");
        setBusy(false);
      }
    }
  }

  function rememberPortrait(png: string) {
    const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    if (portraitUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(portraitUrlRef.current);
    portraitUrlRef.current = url;
    setPortraitUrl(url);
  }

  useEffect(() => {
    const file = pendingFile.current;
    if (!file || !hasDrawableWords(style)) return;
    const handle = window.setTimeout(() => {
      if (pendingFile.current !== file) return;
      pendingFile.current = null;
      void onFile(file, pendingSlot.current);
    }, 700);
    return () => window.clearTimeout(handle);
  }, [style]);

  useEffect(() => {
    if (!prints.some((print) => print.ridges.length > 8)) {
      setPortraitReady(false);
      return;
    }
    const gen = portraitGen.current + 1;
    portraitGen.current = gen;
    const seenRead = readGen.current;
    setPortraitReady(false);
    const handle = window.setTimeout(() => {
      void fetch("/api/studio/portrait", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prints: prints.map(toPreview), style, period }),
      })
        .then((response) => readJson<{ portraitPng?: string; error?: string }>(response))
        .then((payload) => {
          if (gen !== portraitGen.current || seenRead !== readGen.current) return;
          if (typeof payload.portraitPng === "string" && payload.portraitPng) {
            rememberPortrait(payload.portraitPng);
            setPortraitReady(true);
          } else if (portraitUrlRef.current) {
            setPortraitReady(true);
          } else {
            setPortraitReady(false);
            setError(String(payload.error || "The portrait could not be drawn."));
          }
        })
        .catch((reason) => {
          if (gen !== portraitGen.current || seenRead !== readGen.current) return;
          if (portraitUrlRef.current) setPortraitReady(true);
          else {
            setPortraitReady(false);
            setError(reason instanceof Error ? reason.message : "The portrait could not be drawn.");
          }
        });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [prints, style, period]);

  const framed = productId === "framed";
  const frameSize = isFrameSize(sizeId) ? sizeId : "11x14";

  useEffect(() => {
    if (!framed || !svg) {
      setPrintfulUrl("");
      return;
    }
    const handle = window.setTimeout(() => {
      void fetch("/api/frames/mockup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ svg, finish: frameId, size: frameSize }),
      })
        .then((response) => response.json())
        .then((payload: { mockupUrl?: string }) => setPrintfulUrl(payload.mockupUrl || ""))
        .catch(() => setPrintfulUrl(""));
    }, 800);
    return () => window.clearTimeout(handle);
  }, [framed, svg, frameId, frameSize]);

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
          waitingSrc ? (
            <figure>
              <img src={waitingSrc} alt="Your fingerprint, waiting for its words" />
              {notice ? <figcaption className="note">{notice}</figcaption> : null}
            </figure>
          ) : (
            <p className="lede">Upload a print, or begin with the sample. The ridges you see are the ones the words will follow.</p>
          )
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
              {portraitUrl ? (
                <img className="portrait-still" src={portraitUrl} alt="Portrait whose ridges are words" />
              ) : (
                <p className="lede">Drawing the ridges…</p>
              )}
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
              ) : view === "words" ? (
                portraitUrl ? (
                  framed && printfulUrl ? (
                    <img className="frame-photo" src={printfulUrl} alt="The portrait photographed in the selected Printful frame" />
                  ) : framed ? (
                    <FrameMockup finish={frameId} size={frameSize} label={`${frameFinishes.find((item) => item.id === frameId)?.label} frame`}>
                      <img className="portrait-still" src={portraitUrl} alt="Portrait whose ridges are words" />
                    </FrameMockup>
                  ) : (
                    <img className="portrait-still" src={portraitUrl} alt="Portrait whose ridges are words" />
                  )
                ) : (
                  <p className="lede">Drawing the ridges…</p>
                )
              ) : framed ? (
                <FrameMockup finish={frameId} size={frameSize} label={`${frameFinishes.find((item) => item.id === frameId)?.label} frame`}>
                  <div className={`svg-hold ${fontClass}`} style={{ background: preset.paper }} dangerouslySetInnerHTML={{ __html: svg }} />
                </FrameMockup>
              ) : (
                <div className={`svg-hold ${fontClass}`} style={{ background: preset.paper }} dangerouslySetInnerHTML={{ __html: svg }} />
              )}
            </div>
          </div>
        )}
        {prints[0] ? <p className="note">{prints.reduce((sum, print) => sum + print.ridges.length, 0)} ridge lines. The words are the ridges.{notice ? ` ${notice}` : ""}{framed ? (printfulUrl ? " This photograph is from Printful." : " The frame is drawn here. Printful’s photograph replaces it when a print key and a public file are set.") : ""}</p> : null}
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
            <MatchDetails attempts={attempts} />
          </div>
        ) : null}
        {!retake && attempts.length ? <MatchDetails attempts={attempts} /> : null}
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {busy ? <p>Reading the ridges…</p> : null}
        <h2>The print</h2>
        <div className="stage-tools">
          <button type="button" onClick={() => {
            pendingFile.current = null;
            setWaitingSrc((current) => {
              if (current.startsWith("blob:")) URL.revokeObjectURL(current);
              return "";
            });
            setStyle((current) => (hasRidgeWords(current) && !isSampleRidgeStyle(current) ? current : { ...current, ...studioRidgeStyle }));
            void loadNamed("loop", seedLines, 0);
          }}>Try the sample print</button>
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
          {toneReady ? (
            <select
              value={tone}
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value as typeof tone;
                setTone(next);
                const pending = lastUpload.current;
                if (pending) void onFile(pending.file, pending.slot, next);
              }}
            >
              <option value="auto">Detect automatically</option>
              <option value="dark">Dark ridges on light paper</option>
              <option value="light">Light ridges on a dark ground</option>
            </select>
          ) : (
            <select value="auto" autoComplete="off" disabled>
              <option value="auto">Detect automatically</option>
            </select>
          )}
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
        <label className="field"><span>Name above the portrait</span><input type="text" value={style.headerName ?? ""} aria-label="Header name" onChange={(event) => setStyle({ ...style, headerName: event.target.value })} /></label>
        <label className="field"><span>Birth and death, under the name</span><input type="text" value={style.headerDates ?? ""} aria-label="Header dates" onChange={(event) => setStyle({ ...style, headerDates: event.target.value })} /></label>
        <label className="field"><span>Signature, bottom right</span><input type="text" value={style.signature ?? ""} aria-label="Signature" onChange={(event) => setStyle({ ...style, signature: event.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={Boolean(style.plaque)} onChange={(event) => setStyle({ ...style, plaque: event.target.checked })} /> Center plaque for the dedications</label>
        <label className="field"><span>First name on the plaque</span><input type="text" value={style.centerName ?? ""} aria-label="Center name" onChange={(event) => setStyle({ ...style, centerName: event.target.value })} /></label>
        <label className="field"><span>Date under that name</span><input type="text" value={style.centerDetail ?? ""} aria-label="Center date or detail" onChange={(event) => setStyle({ ...style, centerDetail: event.target.value })} /></label>
        <label className="field"><span>Second name on the plaque</span><input type="text" value={style.secondaryName ?? ""} aria-label="Secondary name" onChange={(event) => setStyle({ ...style, secondaryName: event.target.value })} /></label>
        <label className="field"><span>Date under that name</span><input type="text" value={style.secondaryDetail ?? ""} aria-label="Secondary date or detail" onChange={(event) => setStyle({ ...style, secondaryDetail: event.target.value })} /></label>
        <label className="field"><span>Marriage line</span><input type="text" value={style.marriage ?? ""} aria-label="Marriage line" onChange={(event) => setStyle({ ...style, marriage: event.target.value })} /></label>
        <label className="field"><span>Marriage date</span><input type="text" value={style.marriageDate ?? ""} aria-label="Marriage date" onChange={(event) => setStyle({ ...style, marriageDate: event.target.value })} /></label>
        <label className="field">
          <span>Names along the ridges, one per line</span>
          <textarea className="names" value={(style.names ?? []).join("\n")} onChange={(event) => setStyle({ ...style, names: event.target.value.split("\n") })} />
        </label>
        <label className="field">
          <span>Scriptures, one verse per line</span>
          <textarea className="verses" value={(style.scriptures ?? []).join("\n")} onChange={(event) => setStyle({ ...style, scriptures: event.target.value.split("\n") })} />
        </label>
        <label className="field">
          <span>Family stories, one paragraph per block. A paragraph is used whole.</span>
          <textarea className="verses" aria-label="Family stories" value={(style.stories ?? []).join("\n\n")} onChange={(event) => setStyle({ ...style, stories: event.target.value.split(/\n\s*\n/).map((story) => story.trim()).filter(Boolean) })} />
        </label>
        <p className="note">Every ridge is text, in one size, packed in even rows that follow the print. Verses run whole and end with their reference. Names stay whole. The center plaque holds the dedications. Stories continue as whole paragraphs, then thin ridges. A sentence is never cut.</p>
        <label className="field"><span>Title, used when the name above is empty</span><input type="text" value={style.title} onChange={(event) => setStyle({ ...style, title: event.target.value })} /></label>
        <label className="field"><span>Line under the portrait, used when the signature is empty</span><input type="text" value={style.footer ?? ""} onChange={(event) => setStyle({ ...style, footer: event.target.value })} /></label>
        <label className="field"><span>Script line, if the footer and signature are empty</span><input type="text" value={style.script} onChange={(event) => setStyle({ ...style, script: event.target.value })} /></label>
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
          <select value={productId} onChange={(event) => {
            const next = event.target.value;
            setProductId(next);
            setSizeId(next === "framed" ? "11x14" : productById(next).sizes[0].id);
          }}>
            {buyableProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.priceCents)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Size</span>
          <select value={sizeId} onChange={(event) => setSizeId(event.target.value)}>
            {product.sizes.map((size) => <option key={size.id} value={size.id}>{size.label}</option>)}
          </select>
        </label>
        {framed ? (
          <div className="swatches" role="radiogroup" aria-label="Frame">
            {frameFinishes.map((finish) => (
              <button key={finish.id} type="button" aria-pressed={frameId === finish.id} onClick={() => setFrameId(finish.id)}>
                <i className={`swatch finish-${finish.id}`} /> {finish.label}
              </button>
            ))}
          </div>
        ) : null}
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
        {waitlist ? <p className="note">Orders open soon. Joining the list saves your email. Nothing is charged, and nothing is sent to print.</p> : null}
        <div className="checkout-bar">
          <strong>{formatMoney(product.priceCents)}</strong>
          <button className="btn-gold" type="button" disabled={!ready || busy || !portraitReady} onClick={checkout}>Review the proof</button>
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
