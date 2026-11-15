import { useProgress } from '@react-three/drei';

// Loading indicator drawn as normal page HTML on top of the canvas. Rendering it inside the
// scene as a Suspense fallback caused a DOM removal error when loading finished.
export default function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="loading-overlay" role="status">
      <div className="loading-chip">Loading 3D models, {Math.round(progress)}%</div>
    </div>
  );
}
