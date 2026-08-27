// Run with: npx tsx src/utils/youtube.test.ts
import { parseYouTube, youTubeEmbedUrl, youTubeThumb } from './youtube';

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

// ─── parseYouTube ────────────────────────────────────────────────────────────
check('watch URL → video', parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
  kind: 'video',
  ytId: 'dQw4w9WgXcQ',
});
check('youtu.be → video', parseYouTube('https://youtu.be/dQw4w9WgXcQ'), {
  kind: 'video',
  ytId: 'dQw4w9WgXcQ',
});
check('playlist URL → playlist', parseYouTube('https://www.youtube.com/playlist?list=PLabc123DEF456'), {
  kind: 'playlist',
  ytId: 'PLabc123DEF456',
});
check(
  'watch?v=&list= prefers playlist',
  parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123DEF456'),
  { kind: 'playlist', ytId: 'PLabc123DEF456' }
);
check('embed → video id', parseYouTube('https://www.youtube.com/embed/dQw4w9WgXcQ')?.ytId, 'dQw4w9WgXcQ');
check('shorts → video kind', parseYouTube('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.kind, 'video');
check('bare id → video', parseYouTube('dQw4w9WgXcQ'), { kind: 'video', ytId: 'dQw4w9WgXcQ' });
check('music.youtube.com host', parseYouTube('https://music.youtube.com/watch?v=dQw4w9WgXcQ')?.ytId, 'dQw4w9WgXcQ');
check('non-youtube → null', parseYouTube('https://vimeo.com/12345'), null);
check('garbage → null', parseYouTube('not a url'), null);
check('empty → null', parseYouTube(''), null);
check('too-short id → null', parseYouTube('https://www.youtube.com/watch?v=tooShort'), null);

// ─── embed / thumb ───────────────────────────────────────────────────────────
check(
  'video embed contains id + autoplay',
  /\/embed\/dQw4w9WgXcQ\?.*autoplay=1/.test(youTubeEmbedUrl({ kind: 'video', ytId: 'dQw4w9WgXcQ' })),
  true
);
check(
  'playlist uses videoseries',
  youTubeEmbedUrl({ kind: 'playlist', ytId: 'PLabc' }).includes('/embed/videoseries?list=PLabc'),
  true
);
check('thumb for video', youTubeThumb({ kind: 'video', ytId: 'dQw4w9WgXcQ' })?.includes('dQw4w9WgXcQ'), true);
check('no thumb for playlist', youTubeThumb({ kind: 'playlist', ytId: 'PLabc' }), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
