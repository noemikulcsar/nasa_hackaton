import { Component, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls, Stars } from '@react-three/drei';
import StationModel from './StationModel.jsx';
import Earth from './Earth.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';


class StationBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <Html center>
          <div className="loading-chip">Station model failed to load. Check public/models/iss.glb.</div>
        </Html>
      );
    }
    return this.props.children;
  }
}

export default function StationCanvas({ station, selectedId, assignments, onSelect, active = true }) {
  return (
    <>
    <Canvas
      camera={{ position: [8.5, 4.2, 9.5], fov: 34, near: 0.05, far: 400 }}
      dpr={[1, 2]}
      frameloop={active ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <ambientLight intensity={0.35} color="#bcd0ff" />
      {/* Sunlight and blue light reflected from Earth below. */}
      <directionalLight position={[10, 7, 6]} intensity={3.4} color="#fff6e8" />
      <hemisphereLight args={['#dfe9ff', '#1d5fae', 0.7]} />
      <directionalLight position={[-4, -6, -3]} intensity={0.8} color="#4aa8ff" />

      <Stars radius={120} depth={60} count={2600} factor={4} saturation={0} fade speed={0.2} />
      <Earth />

      <StationBoundary>
        <Suspense fallback={null}>
          <StationModel
            station={station}
            selectedId={selectedId}
            assignments={assignments}
            onSelect={onSelect}
          />
        </Suspense>
      </StationBoundary>

      <OrbitControls
        makeDefault
        enablePan
        minDistance={1.6}
        maxDistance={18}
        enableDamping
        dampingFactor={0.08}
        autoRotate={!selectedId}
        autoRotateSpeed={0.25}
      />
    </Canvas>
    <LoadingOverlay />
    </>
  );
}
