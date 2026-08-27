// Run with: npx tsx src/theme/wallpapers.test.ts
import { imageLayerStyle, imageParamsOf, type Wallpaper } from './wallpapers';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── imageParamsOf: fill defaults for old/partial persisted wallpapers ──────
check('legacy image (fit only) → defaults', imageParamsOf({ kind: 'image', value: 'contain' }), {
  fit: 'contain', zoom: 1, posX: 50, posY: 50,
});
check('bad fit falls back to cover', imageParamsOf({ kind: 'image', value: 'garbage' }).fit, 'cover');
check('zero/neg zoom → 1', imageParamsOf({ kind: 'image', value: 'cover', zoom: 0 }).zoom, 1);
check('explicit params kept', imageParamsOf({ kind: 'image', value: 'cover', zoom: 2, posX: 10, posY: 90 }), {
  fit: 'cover', zoom: 2, posX: 10, posY: 90,
});

// ─── imageLayerStyle ────────────────────────────────────────────────────────
const cover = imageLayerStyle('blob:x', { fit: 'cover', zoom: 1, posX: 50, posY: 50 });
check('cover: fit as background-size', cover.backgroundSize, 'cover');
check('cover: centred position', cover.backgroundPosition, '50% 50%');
check('zoom 1 leaves transform unset', cover.transform, undefined);

const zoomed = imageLayerStyle('blob:x', { fit: 'cover', zoom: 2, posX: 25, posY: 75 });
check('zoom>1 scales', zoomed.transform, 'scale(2)');
check('transform-origin tracks the pan point', zoomed.transformOrigin, '25% 75%');
check('panned position', zoomed.backgroundPosition, '25% 75%');

const tile = imageLayerStyle('blob:x', { fit: 'tile', zoom: 2, posX: 50, posY: 50 });
check('tile repeats', tile.backgroundRepeat, 'repeat');
check('tile cell size scales with zoom', tile.backgroundSize, '400px');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
