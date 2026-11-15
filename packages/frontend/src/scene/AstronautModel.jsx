import { useEffect, useMemo, useRef } from 'react';
import { Html, useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { findAnchorBones, regionFromFace, tagBones } from '../lib/bodyRegions.js';

const MODEL_URL = '/models/astronaut.glb';
const MODEL_HEIGHT = 2; // scene units, head to feet
const FLOOR_Y = -1; // the feet rest on this plane
const PIN_ORDER = ['head', 'chest', 'pelvis', 'arms', 'hands', 'legs', 'feet'];
const PIN_LABEL = { head: 'Head', chest: 'Chest', pelvis: 'Pelvis', arms: 'Arms', hands: 'Hands', legs: 'Legs', feet: 'Feet' };

// Scales and centers the model so its feet sit on the floor and its height is MODEL_HEIGHT.
function fitToFloor(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = MODEL_HEIGHT / size.y;
  return {
    scale,
    position: [-center.x * scale, FLOOR_Y - box.min.y * scale, -center.z * scale],
  };
}

function findSkinnedMesh(root) {
  let found = null;
  root.traverse((object) => {
    if (!found && object.isSkinnedMesh) found = object;
  });
  return found;
}

export default function AstronautModel({ regions, activeRegion, onRegionClick }) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const rootRef = useRef(null);
  const pinRefs = useRef({});
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const { actions, names } = useAnimations(animations, rootRef);

  const fit = useMemo(() => fitToFloor(scene), [scene]);
  const anchors = useMemo(() => {
    tagBones(scene);
    const mesh = findSkinnedMesh(scene);
    return mesh ? findAnchorBones(mesh.skeleton.bones) : {};
  }, [scene]);

  // Test helper: screen position of a region's anchor (used by the automated demo test).
  const { camera, gl } = useThree();
  useEffect(() => {
    window.__orbital = {
      regionScreenPoint(id) {
        const bone = anchors[id];
        if (!bone) return null;
        const v = bone.getWorldPosition(new THREE.Vector3()).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
  }, [anchors, camera, gl]);

  // Play the idle animation from the model file.
  useEffect(() => {
    const clip = names[0];
    if (!clip || !actions[clip]) return undefined;
    actions[clip].reset().fadeIn(0.4).play();
    return () => {
      actions[clip]?.fadeOut(0.2);
    };
  }, [actions, names]);

  // Keep pins and the open popup locked to their bones as the body moves.
  useFrame(() => {
    for (const id of PIN_ORDER) {
      const bone = anchors[id];
      const pin = pinRefs.current[id];
      if (bone && pin) {
        bone.getWorldPosition(scratch);
        pin.position.copy(scratch);
      }
    }
  });

  const handleClick = (event) => {
    event.stopPropagation();
    const region = regionFromFace(event);
    if (region) onRegionClick(region);
  };

  return (
    <>
      <group
        ref={rootRef}
        position={fit.position}
        scale={fit.scale}
        onClick={handleClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto';
        }}
      >
        <primitive object={scene} />
      </group>

      {PIN_ORDER.filter((id) => anchors[id]).map((id) => {
        const status = regions[id]?.status ?? 'nominal';
        const selected = activeRegion === id;
        return (
          <group key={id} ref={(el) => { pinRefs.current[id] = el; }}>
            <Html center zIndexRange={[30, 0]}>
              <button
                type="button"
                className={`pin ${status} ${selected ? 'selected' : ''}`}
                aria-pressed={selected}
                aria-label={`${PIN_LABEL[id]} region, ${regions[id]?.status ?? ''}`}
                data-testid={`pin-${id}`}
                onClick={() => onRegionClick(selected ? null : id)}
              >
                <span className="pin-dot" aria-hidden="true" />
                <span>{PIN_LABEL[id]}</span>
              </button>
            </Html>
          </group>
        );
      })}

    </>
  );
}

useGLTF.preload(MODEL_URL);
