import { Component, Suspense, useCallback, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { CharacterModel } from "./CharacterModel";
import { WireframeCore } from "./WireframeCore";

class GLBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed
      ? (this.props.fallback ?? null)
      : this.props.children;
  }
}

export function CharacterCanvas({
  url,
  color,
  selectSignal = 0,
  turntable = true,
  className,
}: {
  url: string;
  color: string;
  selectSignal?: number;
  turntable?: boolean;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className={className ?? "ot-char-canvas"}>
      {!ready && <div className="ot-char-loading" aria-hidden />}
      <GLBoundary
        fallback={<div className="ot-char-canvas-err">model unavailable</div>}
      >
        <Canvas
          frameloop="always"
          camera={{ position: [0, 0.1, 3.9], fov: 40 }}
          dpr={[1, 1.75]}
          gl={{ alpha: true, antialias: true, powerPreference: "default" }}
          style={{ background: "transparent" }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[2, 4, 3]} intensity={1.5} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#88c0ff" />
          <WireframeCore color={color} />
          <Suspense fallback={null}>
            <CharacterModel
              url={url}
              selectSignal={selectSignal}
              turntable={turntable}
              fitHeight={1.5}
              onReady={onReady}
            />
          </Suspense>
        </Canvas>
      </GLBoundary>
    </div>
  );
}
