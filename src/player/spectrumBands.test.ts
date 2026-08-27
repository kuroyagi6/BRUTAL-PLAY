// Run with: npx tsx src/player/spectrumBands.test.ts
import { buildBandRanges, reduceToBands, BandSmoother, VIZ_BANDS } from './spectrumBands';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const BINS = 512;
const RATE = 44100;
const ranges = buildBandRanges(BINS, RATE, VIZ_BANDS);

// ─── ranges: every band usable, contiguous, in bounds ────────────────────────
check('one [start,end) pair per band', ranges.length, VIZ_BANDS * 2);

let allNonEmpty = true;
let allInBounds = true;
let contiguous = true;
for (let b = 0; b < VIZ_BANDS; b++) {
  const start = ranges[b * 2];
  const end = ranges[b * 2 + 1];
  if (end <= start) allNonEmpty = false;
  if (start < 0 || end > BINS) allInBounds = false;
  if (b > 0 && start !== ranges[(b - 1) * 2 + 1]) contiguous = false;
}
check('no empty bands (the old linear map left visible gaps)', allNonEmpty, true);
check('all ranges within the bin array', allInBounds, true);
check('bands tile the spectrum without holes', contiguous, true);

// Log spacing means high bands must be much wider than low bands.
const firstWidth = ranges[1] - ranges[0];
const lastWidth = ranges[VIZ_BANDS * 2 - 1] - ranges[VIZ_BANDS * 2 - 2];
check('high bands span more bins than low bands (log spacing)', lastWidth > firstWidth, true);

// ─── reduceToBands: peak, not mean ───────────────────────────────────────────
const fft = new Uint8Array(BINS);
const out = new Uint8Array(VIZ_BANDS);
// Put a lone spike in the last band; a mean would bury it, a peak keeps it.
const lastStart = ranges[VIZ_BANDS * 2 - 2];
fft[lastStart] = 200;
reduceToBands(fft, ranges, out);
check('a lone transient survives reduction', out[VIZ_BANDS - 1], 200);
check('silent bands stay at zero', out[0], 0);

fft.fill(0);
fft.fill(120, ranges[0], ranges[1]);
reduceToBands(fft, ranges, out);
check('flat energy reproduces its level', out[0], 120);

// ─── BandSmoother: fast attack, slow decay, falling caps ─────────────────────
const s = new BandSmoother(VIZ_BANDS);
const loud = new Uint8Array(VIZ_BANDS).fill(255);
const silent = new Uint8Array(VIZ_BANDS);

s.update(loud);
const afterOneLoud = s.levels[0];
check('rises on the first loud frame', afterOneLoud > 0.3, true);

for (let i = 0; i < 30; i++) s.update(loud);
check('settles near full scale when pinned loud', s.levels[0] > 0.95, true);
const peakAtLoud = s.peaks[0];

s.update(silent);
const afterOneSilent = s.levels[0];
check('decay is slower than attack', afterOneSilent > 0.8, true);
check('peak cap does not drop instantly with the level', s.peaks[0] >= afterOneSilent, true);

for (let i = 0; i < 200; i++) s.update(silent);
check('level falls to silence eventually', s.levels[0] < 0.01, true);
check('cap falls under gravity too', s.peaks[0] < peakAtLoud, true);

s.reset();
check('reset clears levels', s.levels[0], 0);
check('reset clears peaks', s.peaks[0], 0);

// ─── contrast curve: full scale is preserved, mid-levels are pushed down ─────
// Guards the tuning finding: without a curve > 1 the display saturates into a
// solid block. Measured against a real AnalyserNode; see BandSmoother.update.
const settle = (input: Uint8Array, curve?: number) => {
  const sm = new BandSmoother(VIZ_BANDS);
  for (let i = 0; i < 80; i++) sm.update(input, curve);
  return sm.levels[0];
};
check('full-scale input still reaches full scale', settle(new Uint8Array(VIZ_BANDS).fill(255)) > 0.99, true);
const halfFlat = new Uint8Array(VIZ_BANDS).fill(128);
check('default curve pushes mid-level bands below linear', settle(halfFlat) < 0.5 - 0.05, true);
check('curve 1.0 is linear (sanity: the curve is what does the work)', Math.abs(settle(halfFlat, 1.0) - 128 / 255) < 0.02, true);
check('mid-level bands stay clearly visible, not crushed', settle(halfFlat) > 0.15, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
