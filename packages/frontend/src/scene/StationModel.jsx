import { useEffect, useMemo, useRef, useState } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export const STATION_URL = '/models/iss.glb';
const TARGET_SIZE = 7.5; // longest side of the station, in scene units

const STATUS_COLOR = {
  nominal: new THREE.Color('#b4ff5a'),
  advisory: new THREE.Color('#ffc857'),
  warning: new THREE.Color('#ff8a3d'),
  critical: new THREE.Color('#ff2e6e'),
};
const SELECT_COLOR = new THREE.Color('#36e4ff');
const Z_SELECTED = [60, 50];
const Z_DEFAULT = [30, 0];

// Blink pattern per severity: critical strobes, warning blinks, advisory breathes, nominal glows steadily.
function blink(status, t) {
  switch (status) {
    case 'critical': return Math.sin(t * Math.PI * 8) > 0 ? 1 : 0.15;
    case 'warning': return Math.sin(t * Math.PI * 4) > -0.2 ? 1 : 0.2;
    case 'advisory': return 0.55 + 0.45 * Math.sin(t * Math.PI * 1.6);
    default: return 0.65;
  }
}

// Bounding box in the model's own coordinates, even if the cached scene is still attached
// to a scaled parent from an earlier mount.
function localBox(object, root) {
  root.updateMatrixWorld(true);
  const toLocal = root.matrixWorld.clone().invert();
  return new THREE.Box3().setFromObject(object).applyMatrix4(toLocal);
}

function fitStation(root) {
  const box = localBox(root, root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = TARGET_SIZE / Math.max(size.x, size.y, size.z);
  return { scale, position: center.multiplyScalar(-scale).toArray(), radius: (size.length() / 2) * scale };
}

// Finds a part by its node name. three.js adds "_1" when a node and its mesh share a name
// (for example "Payload_PM" becomes "Payload_PM_1"), so accept that suffix too.
function findNode(root, name) {
  const exact = root.getObjectByName(name);
  if (exact) return exact;
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_\\d+)?$`);
  let found = null;
  root.traverse((o) => {
    if (!found && pattern.test(o.name)) found = o;
  });
  return found;
}

// Gives each mesh of a component its own material copy, so it can glow without affecting
// other parts that share the same material.
function prepareGlow(object) {
  const materials = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.userData.glowReady) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m) => m.clone())
        : child.material.clone();
      child.userData.glowReady = true;
    }
    for (const m of [child.material].flat()) {
      if (m.emissive) {
        if (!m.userData.baseEmissive) {
          m.userData.baseEmissive = m.emissive.clone();
          m.userData.baseIntensity = m.emissiveIntensity ?? 1;
        }
        materials.push(m);
      }
    }
  });
  return materials;
}

function Marker({ component, position, selected, assigned, ready, onSelect }) {
  const root = useRef(null);
  const core = useRef(null);
  const halo = useRef(null);
  const { status } = component;
  const color = STATUS_COLOR[status];
  const fault = status !== 'nominal';
  // Label warnings, critical faults and the selected part; advisories show as dots only.
  const showLabel = ready && (status === 'warning' || status === 'critical' || selected);

  useFrame(({ clock, camera }) => {
    // Keep the dot the same size on screen whatever the zoom level.
    if (root.current) root.current.scale.setScalar(camera.position.distanceTo(root.current.position) / 12);
    const t = clock.elapsedTime;
    const k = blink(status, t);
    if (core.current) core.current.material.opacity = fault ? k : 0.75;
    if (halo.current) {
      const s = fault ? 1 + 0.6 * ((t * (status === 'critical' ? 2 : 1)) % 1) : 1;
      halo.current.scale.setScalar(s);
      halo.current.material.opacity = fault ? 0.35 * (1 - ((t * (status === 'critical' ? 2 : 1)) % 1)) : 0.12;
    }
  });

  const pick = (event) => {
    event.stopPropagation();
    onSelect(selected ? null : component.id);
  };

  return (
    <group ref={root} position={position}>
      <mesh ref={core} renderOrder={10} onClick={pick}>
        <sphereGeometry args={[fault ? 0.075 : 0.05, 20, 20]} />
        <meshBasicMaterial color={color} transparent depthTest={false} toneMapped={false} />
      </mesh>
      <mesh ref={halo} renderOrder={9}>
        <sphereGeometry args={[fault ? 0.16 : 0.1, 20, 20]} />
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {showLabel && (
        <Html key={`${status}-${selected}`} position={[0, 0.2, 0]} center zIndexRange={selected ? Z_SELECTED : Z_DEFAULT}>
          <button
            type="button"
            className={`pin hw-pin ${status} ${selected ? 'selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : component.id)}
          >
            <span className="pin-dot" aria-hidden="true" />
            <span>{component.short}</span>
            {assigned && <span className="pin-tag">Assigned</span>}
          </button>
        </Html>
      )}
    </group>
  );
}

// Moves the orbit target and camera smoothly to the selected component, or back to the overview.
function CameraRig({ focus, overviewDistance }) {
  const { camera, controls } = useThree();
  const anim = useRef({ frames: 0, target: new THREE.Vector3(), position: new THREE.Vector3() });

  useEffect(() => {
    if (!controls) return;
    // Aim slightly below the component so it sits in the upper part of the view,
    // clear of the repair panel at the bottom of the stage.
    const target = focus ? new THREE.Vector3(focus[0], focus[1] - 0.75, focus[2]) : new THREE.Vector3(0, -0.6, 0);
    // Always approach from the same open angle (front, above, slightly to the side), so
    // solar arrays never end up between the camera and the part.
    const dir = new THREE.Vector3(0.62, 0.5, 0.6).normalize();
    const distance = focus ? 6.2 : overviewDistance;
    anim.current = { frames: 70, target, position: target.clone().add(dir.multiplyScalar(distance)) };
    // focus is an array; compare by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.[0], focus?.[1], focus?.[2], controls]);

  useFrame(() => {
    const a = anim.current;
    if (!controls || a.frames <= 0) return;
    a.frames -= 1;
    controls.target.lerp(a.target, 0.09);
    camera.position.lerp(a.position, 0.09);
    controls.update();
  });
  return null;
}

export default function StationModel({ station, selectedId, assignments, onSelect }) {
  const { scene } = useGLTF(STATION_URL);
  const fit = useMemo(() => fitStation(scene), [scene]);
  const glowTime = useRef(0);
  // Mount HTML labels one frame after the model appears. Labels created in the very first
  // commit (while Suspense resolves) sometimes never attached to the page.
  const [labelsReady, setLabelsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setLabelsReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Locate every monitored component in the model by its node name.
  const anchors = useMemo(() => {
    const result = {};
    for (const c of station.components) {
      const object = findNode(scene, c.node);
      if (!object) {
        console.warn(`Station part "${c.node}" was not found in ${STATION_URL}.`);
        continue;
      }
      const center = localBox(object, scene).getCenter(new THREE.Vector3());
      result[c.id] = { object, center: center.toArray(), materials: prepareGlow(object) };
    }
    return result;
    // Component list is static; statuses change but nodes do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const nodeToId = useMemo(() => {
    const map = new Map();
    for (const [id, a] of Object.entries(anchors)) map.set(a.object, id);
    return map;
  }, [anchors]);

  const findComponent = (object) => {
    for (let o = object; o; o = o.parent) {
      if (nodeToId.has(o)) return nodeToId.get(o);
    }
    return null;
  };

  // Glow faulty components in their status color; the selected one glows cyan if it is healthy.
  useFrame((_, delta) => {
    glowTime.current += delta;
    const t = glowTime.current;
    for (const c of station.components) {
      const a = anchors[c.id];
      if (!a) continue;
      const fault = c.status === 'warning' || c.status === 'critical';
      const selected = c.id === selectedId;
      for (const m of a.materials) {
        if (fault || selected) {
          const color = fault ? STATUS_COLOR[c.status] : SELECT_COLOR;
          m.emissive.copy(color);
          m.emissiveIntensity = (fault ? 0.55 : 0.3) * blink(fault ? c.status : 'advisory', t) + 0.1;
        } else {
          m.emissive.copy(m.userData.baseEmissive);
          m.emissiveIntensity = m.userData.baseIntensity;
        }
      }
    }
  });

  const toWorld = (local) => local.map((v, i) => v * fit.scale + fit.position[i]);
  const selected = station.components.find((c) => c.id === selectedId);
  const focus = selected && anchors[selected.id] ? toWorld(anchors[selected.id].center) : null;

  return (
    <>
      <group position={fit.position} scale={fit.scale}>
        <primitive
          object={scene}
          onClick={(event) => {
            const id = findComponent(event.object);
            if (!id) return;
            event.stopPropagation();
            onSelect(id);
          }}
          onPointerOver={(event) => {
            if (findComponent(event.object)) {
              event.stopPropagation();
              document.body.style.cursor = 'pointer';
            }
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        />
      </group>

      {station.components.filter((c) => anchors[c.id]).map((c) => (
        <Marker
          key={c.id}
          component={c}
          position={toWorld(anchors[c.id].center)}
          selected={c.id === selectedId}
          assigned={Boolean(assignments[c.id])}
          ready={labelsReady}
          onSelect={onSelect}
        />
      ))}

      <CameraRig focus={focus} overviewDistance={fit.radius * 1.55} />
    </>
  );
}

useGLTF.preload(STATION_URL);
