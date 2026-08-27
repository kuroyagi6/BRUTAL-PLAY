// Run with: npx tsx src/audio/eqCurve.test.ts
import { eqGainAt, eqCurve, logFrequencies } from './eqCurve';

let pass = 0;
let fail = 0;
function near(name: string, got: number, want: number, tol = 0.5) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${got.toFixed(2)} want=${want}±${tol}`);
  ok ? pass++ : fail++;
}
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
  cond ? pass++ : fail++;
}

const FLAT = { bass: 0, mid: 0, treble: 0 };

// A flat EQ must be exactly transparent everywhere — this is what makes the
// analyzer's centre line meaningful.
for (const f of [30, 100, 200, 1000, 3000, 10000, 16000]) {
  near(`flat is 0dB at ${f}Hz`, eqGainAt(FLAT, f), 0, 0.001);
}

// Each band lifts its own region and leaves the far end of the spectrum alone.
near('bass +12 lifts 50Hz', eqGainAt({ ...FLAT, bass: 12 }, 50), 12, 1);
near('bass +12 barely touches 10kHz', eqGainAt({ ...FLAT, bass: 12 }, 10000), 0, 0.5);
near('treble +12 lifts 12kHz', eqGainAt({ ...FLAT, treble: 12 }, 12000), 12, 1);
near('treble +12 barely touches 50Hz', eqGainAt({ ...FLAT, treble: 12 }, 50), 0, 0.5);
near('mid +12 peaks at 1kHz', eqGainAt({ ...FLAT, mid: 12 }, 1000), 12, 0.2);
near('mid +12 falls off by 100Hz', eqGainAt({ ...FLAT, mid: 12 }, 100), 0, 1.5);

// Cuts mirror boosts, and the shelf midpoint sits at half gain (the defining
// property of a shelf — if this drifts, the curve is drawn for the wrong filter).
near('bass -12 cuts 50Hz', eqGainAt({ ...FLAT, bass: -12 }, 50), -12, 1);
near('bass +12 is +6 at the 200Hz corner', eqGainAt({ ...FLAT, bass: 12 }, 200), 6, 0.6);
near('treble +12 is +6 at the 3kHz corner', eqGainAt({ ...FLAT, treble: 12 }, 3000), 6, 0.6);

// Bands cascade, so their dB add where they overlap.
const both = eqGainAt({ bass: 6, mid: 0, treble: 6 }, 1000);
const sum = eqGainAt({ ...FLAT, bass: 6 }, 1000) + eqGainAt({ ...FLAT, treble: 6 }, 1000);
near('bands add in dB', both, sum, 0.001);

// Sampling helpers used by the analyzer.
const freqs = logFrequencies(64);
check('logFrequencies spans the range', freqs[0] === 30 && Math.round(freqs[63]) === 16000);
check('logFrequencies ascends', freqs.every((f, i) => i === 0 || f > freqs[i - 1]));
check('logFrequencies is log-spaced', Math.abs(freqs[1] / freqs[0] - freqs[32] / freqs[31]) < 1e-6);

const curve = eqCurve({ bass: 12, mid: 0, treble: 0 }, freqs);
check('curve length matches freqs', curve.length === freqs.length);
check('curve is boosted at the low end', curve[0] > 11);
check('curve is flat at the top end', Math.abs(curve[63]) < 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
