import type { ReactNode } from "react";
import { frameFinishById, frameSizeById, type FrameFinish, type FrameSize } from "@/lib/frames";

export function FrameMockup({
  finish,
  size = "11x14",
  label,
  children,
}: {
  finish: FrameFinish | string;
  size?: FrameSize | string;
  label?: string;
  children: ReactNode;
}) {
  const frame = frameFinishById(finish);
  const chosen = frameSizeById(size);
  const ratio = chosen.inches[0] / chosen.inches[1];
  return (
    <figure className={`frame-scene finish-${frame.id}`} aria-label={label || `${frame.label} frame, ${chosen.label}`}>
      <div className="frame-wall">
        <div className="frame-moulding">
          <div className="frame-lip">
            <div className="frame-mat">
              <div className="frame-opening" style={{ aspectRatio: `${ratio}` }}>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
      {label ? <figcaption>{label}</figcaption> : null}
    </figure>
  );
}
