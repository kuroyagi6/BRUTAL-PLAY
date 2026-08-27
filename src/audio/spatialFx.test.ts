// Run with: npx tsx src/audio/spatialFx.test.ts
//
// Covers the parameter mapping only — the node wiring needs a real
// AudioContext. The mappings are what decide whether "off" is actually off and
// whether width 100 is actually transparent, which is the part worth pinning.
import { reverbWetGain, delayWetGain, sideGainFor, delayTimeFor, SPATIAL_DEFAULTS } from './spatialFx';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = Object.is(got, want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${got} want=${want}`);
  ok ? pass++ : fail++;
}
function truthy(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
  cond ? pass++ : fail++;
}

// Off must be exactly zero: a send at 0 contributes literally nothing, which is
// what lets these effects sit in the chain permanently without colouring it.
check('reverb off is silent', reverbWetGain(0), 0);
check('delay off is silent', delayWetGain(0), 0);

// Width 100 must be exactly 1 — the mid/side matrix reconstructs the input only
// at unity side gain. Any drift here and every track is silently reprocessed.
check('width 100 is transparent', sideGainFor(100), 1);
check('width 0 is mono', sideGainFor(0), 0);
check('width 200 is doubled', sideGainFor(200), 2);

// Sends stay under unity so wet + dry cannot clip.
truthy('reverb send stays under unity', reverbWetGain(100) < 1 && reverbWetGain(100) > 0);
truthy('delay send stays under unity', delayWetGain(100) < 1 && delayWetGain(100) > 0);
truthy('reverb send is monotonic', reverbWetGain(25) < reverbWetGain(50) && reverbWetGain(50) < reverbWetGain(100));
truthy('delay send is monotonic', delayWetGain(25) < delayWetGain(50) && delayWetGain(50) < delayWetGain(100));

// Out-of-range input is clamped, never NaN or negative (a negative gain would
// flip polarity instead of muting).
check('reverb clamps above range', reverbWetGain(150), reverbWetGain(100));
check('reverb clamps below range', reverbWetGain(-20), 0);
check('width clamps above range', sideGainFor(400), 2);
check('width clamps below range', sideGainFor(-50), 0);

// Delay time must stay inside the DelayNode's allocated buffer, and never 0
// (a zero-time delay with feedback is an infinite loop at the sample rate).
check('delay time passes through', delayTimeFor(0.3), 0.3);
check('delay time clamps to the buffer', delayTimeFor(9), 2);
truthy('delay time never reaches zero', delayTimeFor(0) > 0);

// Defaults must be the identity settings, so a fresh install sounds untouched.
truthy(
  'defaults are transparent',
  reverbWetGain(SPATIAL_DEFAULTS.reverb) === 0 &&
    delayWetGain(SPATIAL_DEFAULTS.delay) === 0 &&
    sideGainFor(SPATIAL_DEFAULTS.width) === 1
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
