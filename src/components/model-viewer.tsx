"use client";

import { OrbitControls, Stage, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";

type ModelViewerProps = {
  assetUrl: string | null;
  assetKind: "image" | "model" | null;
};

function UploadedModel({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const scene = gltf.scene;

  if (!scene) {
    return null;
  }

  return <primitive object={scene} />;
}

function EmptyState() {
  return (
    <group>
      <mesh rotation={[0.55, 0.75, 0]}>
        <boxGeometry args={[1.8, 1.8, 1.8]} />
        <meshStandardMaterial color="#ccd0dd" roughness={0.7} />
      </mesh>
    </group>
  );
}

export function ModelViewer({ assetUrl, assetKind }: ModelViewerProps) {
  return (
    <div className="h-full min-h-[420px] overflow-hidden rounded-2xl border border-[#c9cdd9] bg-[#eef0f6]">
      <Canvas camera={{ position: [3.2, 2.4, 4.4], fov: 42 }}>
        <color attach="background" args={["#eef0f6"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 3]} intensity={2.4} />
        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.6} adjustCamera={false}>
            {assetUrl && assetKind === "model" ? (
              <UploadedModel url={assetUrl} />
            ) : (
              <EmptyState />
            )}
          </Stage>
        </Suspense>
        <gridHelper args={[7, 7, "#babfcf", "#dadee8"]} position={[0, -1.28, 0]} />
        <OrbitControls makeDefault enableDamping minDistance={1.8} maxDistance={8} />
      </Canvas>
    </div>
  );
}
