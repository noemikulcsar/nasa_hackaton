/**
 * Lists the nodes of a 3D model that have `extras.healthRegion`
 * (exposed in three.js as `object.userData.healthRegion`).
 * Run: npm run model:inspect -w @orbital/frontend -- <file.glb>
 */
import { NodeIO } from '@gltf-transform/core';
const file = process.argv[2] ?? 'public/models/apollo-astronaut-reference.glb';
const doc = await new NodeIO().read(file);
for (const node of doc.getRoot().listNodes()) {
  const r = (node.getExtras() as { healthRegion?: string }).healthRegion;
  if (r) console.log(`${node.getName().padEnd(18)} healthRegion=${r.padEnd(11)} children=${node.listChildren().length}`);
}
