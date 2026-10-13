import { FrameMockup } from "./FrameMockup";
import { frameFinishes } from "@/lib/frames";

export function FramedExamples({ src, title }: { src: string; title: string }) {
  return (
    <div className="frame-row">
      {frameFinishes.map((finish) => (
        <FrameMockup key={finish.id} finish={finish.id} size="11x14" label={`${title}, ${finish.label.toLowerCase()} frame`}>
          <img src={src} alt="" />
        </FrameMockup>
      ))}
    </div>
  );
}
