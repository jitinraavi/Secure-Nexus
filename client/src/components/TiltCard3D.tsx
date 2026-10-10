import { useEffect, useState, useRef, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import { cn } from "../lib/cn";

interface TiltCard3DProps {
  children: ReactNode;
  className?: string;
  maxTilt?: number; // max rotation degrees
  scale?: number; // scale on hover
}

/**
 * 3D Interactive Perspective Tilt Card.
 * Gives rich physical depth, tilt rotation, and specular lighting sheen on cursor movement.
 */
export function TiltCard3D({ children, className, maxTilt = 8, scale = 1.02 }: TiltCard3DProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, opacity: 0 });
  const [motionEnabled, setMotionEnabled] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      setMotionEnabled(!reducedMotion.matches);
      if (reducedMotion.matches) {
        setStyle({});
        setGlarePos({ x: 50, y: 50, opacity: 0 });
      }
    };
    updateMotion();
    reducedMotion.addEventListener("change", updateMotion);
    return () => reducedMotion.removeEventListener("change", updateMotion);
  }, []);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!motionEnabled || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xPct = (x / rect.width) * 100;
    const yPct = (y / rect.height) * 100;

    const rotateX = ((y / rect.height) - 0.5) * -maxTilt * 2;
    const rotateY = ((x / rect.width) - 0.5) * maxTilt * 2;

    setStyle({
      transform: `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(${scale}, ${scale}, ${scale})`,
    });

    setGlarePos({ x: xPct, y: yPct, opacity: 0.15 });
  };

  const handleMouseLeave = () => {
    if (!motionEnabled) return;
    setStyle({
      transform: "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
    });
    setGlarePos((p) => ({ ...p, opacity: 0 }));
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative transition-transform duration-200 ease-out motion-reduce:transition-none",
        className,
      )}
      style={style}
    >
      {children}
      {/* Dynamic Specular Sheen Glow */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
        style={{
          opacity: glarePos.opacity,
          background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,0.4) 0%, transparent 60%)`,
        }}
      />
    </div>
  );
}
