// Extracts the ruin pieces used by the arena from the Quaternius "Modular Ruins" pack into one small GLB.
// Each kept piece is re-centred at the origin (the pack lays them out in rows).
// Usage: node tools/build-arena.mjs <Modular_Ruins_Pack.glb> public/assets/arena/ruins.glb
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
const [,, inp, out] = process.argv;
const KEEP = ['Floor_Standard', 'Floor_Squares', 'Floor_SquareLarge', 'Column_Round', 'Column_Square', 'Column_Round_Short',
  'Arch_Gothic', 'Arch_Gothic_RoundColumn', 'Wall_ArchGothic', 'Wall', 'Wall_Broken', 'Wall_Overgrown', 'Wall_Double_Broken',
  'Torch', 'Skull', 'Candles_1', 'Candles_2', 'Pot1_Broken', 'Pot2', 'Pot3_Broken', 'DeadTree_1', 'DeadTree_2', 'DeadTree_3',
  'Brick', 'Bricks', 'Statue_Stag', 'Doors_GothicArch_Covered', 'Flag_Wall', 'Flag_Wall2', 'Stairs', 'Support_Center', 'Chest_Base', 'Chest_Top', 'Barrel', 'Crate'];
const io = new NodeIO();
const doc = await io.read(inp);
const root = doc.getRoot().listScenes()[0].listChildren()[0];
for (const n of root.listChildren()) {
  if (!KEEP.includes(n.getName())) { n.dispose(); continue; }
  n.setTranslation([0, 0, 0]);
}
await doc.transform(prune(), dedup());
await io.write(out, doc);
console.log('kept', root.listChildren().map(n => n.getName()).length);
