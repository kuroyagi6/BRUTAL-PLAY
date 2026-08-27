// Run with: npx tsx src/audio/playbackSource.test.ts
import { resolvePlayableSource, isNativeTrack } from './playbackSource';
import type { Track } from '../types';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

const nativeTrack: Track = {
  id: '1',
  name: 'Song',
  artist: 'A',
  album: 'B',
  url: 'local-media:///C:/Music/song.flac',
  nativePath: 'C:\\Music\\song.flac',
};

const uploadedTrack: Track = {
  id: '2',
  name: 'Upload',
  artist: 'A',
  album: 'B',
  url: 'blob:http://localhost/abc-123',
};

// Fake IPC + object URL minting, so no Electron and no DOM are needed.
let reads: string[] = [];
const deps = {
  readAudioFile: async (p: string) => {
    reads.push(p);
    return new Uint8Array([1, 2, 3]).buffer;
  },
  createObjectURL: (_b: Blob) => 'blob:fake-object-url',
};

check('native track is native', isNativeTrack(nativeTrack), true);
check('uploaded track is not native', isNativeTrack(uploadedTrack), false);

(async () => {
  // buffer mode: reads bytes, mints a blob the caller must revoke
  reads = [];
  const buffered = await resolvePlayableSource(nativeTrack, 'buffer', deps);
  check('buffer mode mints an object url', buffered, { src: 'blob:fake-object-url', isObjectUrl: true });
  check('buffer mode reads the native path once', reads, ['C:\\Music\\song.flac']);

  // stream mode: no read at all, hands over the protocol URL, nothing to revoke
  reads = [];
  const streamed = await resolvePlayableSource(nativeTrack, 'stream', deps);
  check('stream mode uses the local-media url', streamed, {
    src: 'local-media:///C:/Music/song.flac',
    isObjectUrl: false,
  });
  check('stream mode reads no bytes', reads, []);

  // Uploaded tracks are untouched either way — their url is already a blob we don't own.
  for (const mode of ['buffer', 'stream'] as const) {
    const r = await resolvePlayableSource(uploadedTrack, mode, deps);
    check(`uploaded track passes through in ${mode} mode`, r, {
      src: 'blob:http://localhost/abc-123',
      isObjectUrl: false,
    });
  }

  // No IPC bridge (browser): buffering is impossible, so fall back to the url
  // rather than throwing. isObjectUrl must stay false or we'd revoke a url we don't own.
  const noBridge = await resolvePlayableSource(nativeTrack, 'buffer', {});
  check('buffer mode without IPC falls back to the url', noBridge, {
    src: 'local-media:///C:/Music/song.flac',
    isObjectUrl: false,
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
