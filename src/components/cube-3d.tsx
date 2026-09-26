import type { CSSProperties } from "react";

type Cube3DProps = {
  color: string;
  size?: number;
};

export function Cube3D({ color, size = 64 }: Cube3DProps) {
  const style = { "--cube-color": color, "--cube-size": `${size}px` } as CSSProperties;

  return (
    <div className="cube3d-scene" style={style}>
      <div className="cube3d">
        <div className="cube3d-face cube3d-face--front" />
        <div className="cube3d-face cube3d-face--back" />
        <div className="cube3d-face cube3d-face--right" />
        <div className="cube3d-face cube3d-face--left" />
        <div className="cube3d-face cube3d-face--top" />
        <div className="cube3d-face cube3d-face--bottom" />
      </div>
    </div>
  );
}
