// Maps skeleton bones to body regions. The glTF loader strips dots from node names,
// so every pattern accepts names with or without the dot (e.g. "clavL_06" or "clav.L_06").

const REGION_RULES = [
  ['head', /^(head|neck)/],
  ['chest', /^(spine|clav)/],
  ['pelvis', /^(master|_?rootJoint|hip)/],
  ['arms', /^arm_/],
  ['hands', /^(hand|finger|thumb)/],
  ['legs', /^leg_/],
  ['feet', /^(foot|toes)/],
];

// One representative joint per region, used to anchor the 3D pins and popups.
const ANCHOR_RULES = {
  head: /^head_\d+$/,
  chest: /^spine3_/,
  pelvis: /^hip_joint/,
  arms: /^arm_2\.?L/,
  hands: /^hand\.?R/,
  legs: /^leg_2\.?L/,
  feet: /^foot\.?R/,
};

export function regionForBone(name = '') {
  for (const [region, pattern] of REGION_RULES) {
    if (pattern.test(name)) return region;
  }
  return 'chest';
}

export function findAnchorBones(bones) {
  const anchors = {};
  for (const [region, pattern] of Object.entries(ANCHOR_RULES)) {
    anchors[region] =
      bones.find((bone) => pattern.test(bone.name)) ??
      bones.find((bone) => regionForBone(bone.name) === region) ??
      null;
  }
  return anchors;
}

/**
 * Writes the region on every bone as `userData.healthRegion`, so the clicked part of the body is
 * found by reading that attribute up the mesh hierarchy (same rule as the original 3D requirement).
 */
export function tagBones(root) {
  root.traverse((o) => {
    if (o.isBone) o.userData.healthRegion = regionForBone(o.name);
  });
}

/** Walks up the hierarchy until it finds `userData.healthRegion`. */
export function findHealthRegion(object) {
  for (let o = object; o; o = o.parent) {
    if (typeof o.userData?.healthRegion === 'string') return o.userData.healthRegion;
  }
  return null;
}

// Resolves a click on the skinned mesh to a body region by weighting the bones that
// influence the three vertices of the hit triangle. Works on the posed (animated) mesh.
export function regionFromFace(event) {
  const mesh = event?.object;
  const face = event?.face;
  if (!mesh?.isSkinnedMesh || !face) return null;

  const { skinIndex, skinWeight } = mesh.geometry.attributes;
  const bones = mesh.skeleton.bones;
  const votes = {};

  for (const vertex of [face.a, face.b, face.c]) {
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(vertex, k);
      if (weight <= 0) continue;
      const bone = bones[skinIndex.getComponent(vertex, k)];
      const region = findHealthRegion(bone) ?? regionForBone(bone?.name);
      votes[region] = (votes[region] ?? 0) + weight;
    }
  }

  let best = null;
  let bestScore = 0;
  for (const [region, score] of Object.entries(votes)) {
    if (score > bestScore) {
      best = region;
      bestScore = score;
    }
  }
  return best;
}
