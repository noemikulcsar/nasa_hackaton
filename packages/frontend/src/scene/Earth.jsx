import { useMemo } from 'react';
import * as THREE from 'three';

/** Earth: a dark ocean sphere with procedural clouds and a thin glowing atmosphere at the limb. */
export default function Earth({ position = [0, -64, -18], rotation = [0.35, 0, 0.12], radius = 56 }) {
  const atmosphere = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { glow: { value: new THREE.Color('#4aa8ff') } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 glow;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
            gl_FragColor = vec4(glow, rim * 0.9);
          }`,
      }),
    [],
  );

  const surface = useMemo(() => {
    // Procedural ocean and cloud texture, so the scene needs no extra downloads.
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#0a2f63');
    grad.addColorStop(1, '#06203f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size * 2, size);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      const x = rand() * size * 2;
      const y = rand() * size;
      const r = 6 + rand() * 38;
      ctx.fillStyle = `rgba(235, 244, 255, ${0.05 + rand() * 0.16})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1.5 + rand() * 2), r * 0.5, rand() * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }, []);

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <sphereGeometry args={[radius, 96, 96]} />
        <meshStandardMaterial map={surface} roughness={0.9} metalness={0} emissive="#0b2c55" emissiveIntensity={0.35} />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[radius, 96, 96]} />
        <primitive object={atmosphere} attach="material" />
      </mesh>
    </group>
  );
}
