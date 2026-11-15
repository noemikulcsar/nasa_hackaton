import { Component, Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls, Stars } from '@react-three/drei';
import AstronautModel from './AstronautModel.jsx';
import Earth from './Earth.jsx';
import LoadingOverlay from './LoadingOverlay.jsx';

class ModelBoundary extends Component {
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
          <div className="loading-chip">Model failed to load. Check public/models/astronaut.glb.</div>
        </Html>
      );
    }
    return this.props.children;
  }
}

/** A slow drift, as in microgravity. Small enough that the region pins stay where they are clicked. */
function Floating({ children }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (!ref.current) return;
    ref.current.position.y = Math.sin(t * 0.6) * 0.03;
    ref.current.rotation.z = Math.sin(t * 0.35) * 0.015;
  });
  return <group ref={ref}>{children}</group>;
}

/** The crew member's body, floating in orbit above the Earth. */
export default function SceneCanvas({ regions, activeRegion, onRegionClick, active = true }) {
  return (
    <>
      <Canvas
        camera={{ position: [0, 0.1, 5.6], fov: 30, near: 0.1, far: 400 }}
        dpr={[1, 2]}
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#02050b']} />

        {/* Sunlight from above, blue light reflected from the Earth below, a little fill */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 4, 3]} intensity={2.6} color="#fff5e6" />
        <directionalLight position={[-2, -3, 1]} intensity={0.9} color="#5aa0ff" />
        <directionalLight position={[-3, 1, -3]} intensity={0.6} color="#cfe0ff" />

        <Stars radius={90} depth={60} count={5000} factor={3.2} saturation={0} fade speed={0.2} />
        <Earth position={[0, -64, -44]} rotation={[0.3, 0.4, 0.1]} radius={56} />

        <ModelBoundary>
          <Suspense fallback={null}>
            <Floating>
              <AstronautModel regions={regions} activeRegion={activeRegion} onRegionClick={onRegionClick} />
            </Floating>
          </Suspense>
        </ModelBoundary>

        <OrbitControls
          target={[0, 0, 0]}
          enablePan={false}
          minDistance={3.5}
          maxDistance={8}
          minPolarAngle={0.5}
          maxPolarAngle={2.2}
          enableDamping
          dampingFactor={0.08}
          autoRotate={!activeRegion}
          autoRotateSpeed={0.5}
        />
      </Canvas>
      <LoadingOverlay />
    </>
  );
}
