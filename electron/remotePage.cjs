// The single-page phone remote, served by electron/remoteServer.cjs at GET /.
// Self-contained (no external CSS/JS/fonts) so it loads with no internet — the
// phone reaches the PC over the hotspot LAN only. Access is PIN-gated: on load it
// probes /library; a 401 shows the PIN screen (auto-submitted if the URL carries
// ?pin=, i.e. the QR was scanned). Two modes once in:
//   REMOTE  — control the PC's playback (SSE state in, POST /command out)
//   PHONE   — play a track from the library on THIS phone's own speaker,
//             streamed from the PC over /stream/:id (independent of the PC).
// Cover art is pulled from /art/:id. Kept as one string so the server ships no
// static-file dir.

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="theme-color" content="#0a0a0a" />
<title>BRUTAL REMOTE</title>
<style>
  :root { --accent:#00FF41; --bg:#0a0a0a; --panel:#141414; --line:#2a2a2a; --fg:#f4f4f4; --dim:#8a8a8a; }
  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html,body { margin:0; height:100%; }
  body {
    background:var(--bg); color:var(--fg); overscroll-behavior:none;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    display:flex; flex-direction:column; min-height:100dvh;
  }
  header {
    padding:16px; border-bottom:3px solid var(--fg); display:flex;
    align-items:center; justify-content:space-between;
  }
  header .brand { font-weight:800; letter-spacing:2px; font-size:15px; }
  header .dot { width:10px; height:10px; background:var(--dim); border:1px solid var(--fg); }
  header .dot.live { background:var(--accent); }
  .tabs { display:flex; border-bottom:3px solid var(--fg); }
  .tabs button {
    flex:1; padding:14px; background:transparent; color:var(--dim); border:0;
    font:inherit; font-weight:700; letter-spacing:1px; text-transform:uppercase; font-size:13px;
  }
  .tabs button.active { background:var(--accent); color:#000; }
  main { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .view { display:none; padding:20px; }
  .view.active { display:block; }

  .art {
    position:relative; width:100%; aspect-ratio:1; background:var(--panel);
    border:3px solid var(--fg); display:flex; align-items:center; justify-content:center;
    margin-bottom:18px; font-size:64px; color:var(--line); overflow:hidden;
  }
  .art img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:none; }
  .art img.show { display:block; }
  .title { font-size:22px; font-weight:800; line-height:1.15; word-break:break-word; }
  .artist { color:var(--dim); margin-top:4px; font-size:14px; word-break:break-word; }
  .scrub { margin:18px 0 4px; }
  input[type=range]{ width:100%; accent-color:var(--accent); height:26px; }
  .times { display:flex; justify-content:space-between; color:var(--dim); font-size:12px; }

  .controls { display:flex; align-items:center; justify-content:center; gap:14px; margin:20px 0; }
  .btn {
    background:var(--panel); color:var(--fg); border:3px solid var(--fg); font:inherit;
    font-weight:800; padding:0; cursor:pointer; user-select:none;
    display:flex; align-items:center; justify-content:center;
  }
  .btn:active { transform:translate(2px,2px); }
  .btn.round { width:60px; height:60px; border-radius:50%; font-size:20px; }
  .btn.play { width:82px; height:82px; background:var(--accent); color:#000; font-size:26px; }
  .btn.sm { width:48px; height:48px; font-size:16px; }
  .btn.on { background:var(--accent); color:#000; }
  .controls.sub { gap:22px; margin:4px 0 10px; }
  .repeatDot { position:relative; }
  .repeatDot::after {
    content:'1'; position:absolute; top:-2px; right:-2px; width:16px; height:16px;
    background:#000; color:var(--accent); border:2px solid var(--accent); border-radius:50%;
    font-size:9px; font-weight:800; line-height:12px; text-align:center; display:none;
  }
  .repeatDot.one::after { display:block; }

  .vol { display:flex; align-items:center; gap:12px; margin-top:8px; }
  .vol span { font-size:12px; color:var(--dim); width:38px; text-align:right; }

  .hint { color:var(--dim); font-size:12px; line-height:1.5; margin:6px 0 16px; }
  .vplayer { width:100%; background:#000; border:3px solid var(--fg); display:block; margin-bottom:14px; aspect-ratio:16/9; }
  ul.lib li .a .tag { color:var(--accent); }
  ul.lib li .a .tag.warn { color:#ffb454; }
  .target { display:flex; gap:0; border:3px solid var(--fg); margin-bottom:14px; }
  .target button {
    flex:1; padding:12px; background:transparent; color:var(--dim); border:0; font:inherit;
    font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:13px; cursor:pointer;
  }
  .target button + button { border-left:3px solid var(--fg); }
  .target button.active { background:var(--accent); color:#000; }
  .search { width:100%; padding:12px; background:var(--panel); border:3px solid var(--fg); color:var(--fg); font:inherit; font-size:15px; margin-bottom:12px; }
  ul.lib { list-style:none; margin:0; padding:0; }
  ul.lib li {
    padding:10px; border:2px solid var(--line); margin-bottom:8px; cursor:pointer;
    display:flex; align-items:center; gap:12px;
  }
  ul.lib li.playing { border-color:var(--accent); background:rgba(0,255,65,.08); }
  ul.lib li .thumb { width:42px; height:42px; flex-shrink:0; background:var(--panel); border:1px solid var(--line); object-fit:cover; }
  ul.lib li .meta { min-width:0; flex:1; }
  ul.lib li .n { font-weight:700; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  ul.lib li .a { color:var(--dim); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .phoneNow {
    position:sticky; bottom:0; background:var(--panel); border-top:3px solid var(--fg);
    padding:10px 14px; display:none; align-items:center; gap:12px;
  }
  .phoneNow.show { display:flex; }
  .phoneNow .thumb { width:40px; height:40px; flex-shrink:0; background:var(--bg); border:1px solid var(--line); object-fit:cover; }
  .phoneNow .n { flex:1; min-width:0; font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* PIN login overlay */
  .login {
    position:fixed; inset:0; background:var(--bg); z-index:50; display:flex;
    flex-direction:column; align-items:center; justify-content:center; padding:28px; gap:16px;
  }
  .login.hidden { display:none; }
  .login h1 { font-size:20px; letter-spacing:2px; margin:0; }
  .login p { color:var(--dim); font-size:12px; margin:0; text-align:center; }
  .login input {
    width:200px; text-align:center; font-size:34px; letter-spacing:12px; padding:14px;
    background:var(--panel); border:3px solid var(--fg); color:var(--fg); font-family:inherit;
  }
  .login button {
    width:200px; padding:16px; background:var(--accent); color:#000; border:3px solid var(--fg);
    font:inherit; font-weight:800; letter-spacing:1px; font-size:15px; cursor:pointer;
  }
  .login .err { color:#ff5555; font-size:12px; min-height:16px; }

  /* transient toast */
  .toast {
    position:fixed; left:50%; bottom:80px; transform:translateX(-50%);
    background:#2a1414; border:3px solid #ff5555; color:#ffdede; padding:12px 16px;
    font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
    max-width:88%; text-align:center; z-index:40; display:none;
  }
  .toast.show { display:block; }
</style>
</head>
<body>
  <!-- PIN gate -->
  <div id="login" class="login">
    <h1>BRUTAL // REMOTE</h1>
    <p>ENTER THE 4-DIGIT PIN SHOWN ON THE PC</p>
    <input id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="----" />
    <button onclick="doAuth()">UNLOCK</button>
    <div id="pinErr" class="err"></div>
  </div>

  <header>
    <span class="brand">BRUTAL // REMOTE</span>
    <span id="live" class="dot" title="connection"></span>
  </header>
  <div class="tabs">
    <button id="tabRemote" class="active" onclick="showView('remote')">REMOTE</button>
    <button id="tabPhone" onclick="showView('phone')">MUSIC</button>
    <button id="tabVideo" onclick="showView('video')">VIDEO</button>
  </div>
  <main>
    <!-- REMOTE: controls the PC -->
    <section id="viewRemote" class="view active">
      <div class="art"><img id="rArt" alt="" /><span id="rArtPh">♪</span></div>
      <div id="rTitle" class="title">NOTHING PLAYING</div>
      <div id="rArtist" class="artist"></div>
      <div class="scrub">
        <input id="rSeek" type="range" min="0" max="1000" value="0" />
        <div class="times"><span id="rCur">0:00</span><span id="rDur">0:00</span></div>
      </div>
      <div class="controls">
        <button class="btn round" onclick="cmd('prev')">⏮</button>
        <button id="rPlay" class="btn play" onclick="cmd('toggle')">▶</button>
        <button class="btn round" onclick="cmd('next')">⏭</button>
      </div>
      <div class="controls sub">
        <button id="rShuffle" class="btn round sm" title="shuffle" onclick="cmd('shuffle')">🔀</button>
        <button id="rRepeat" class="btn round sm repeatDot" title="repeat" onclick="cmd('repeat')">🔁</button>
      </div>
      <div class="vol">
        <button id="rMute" class="btn round" style="width:44px;height:44px;font-size:15px" onclick="cmd('mute')">🔊</button>
        <input id="rVol" type="range" min="0" max="100" value="100" />
        <span id="rVolLbl">100%</span>
      </div>
    </section>

    <!-- LIBRARY: play a track on the phone OR on the PC -->
    <section id="viewPhone" class="view">
      <div class="target">
        <button id="tgtPhone" class="active" onclick="setTarget('phone')">THIS PHONE</button>
        <button id="tgtPc" onclick="setTarget('pc')">PC</button>
      </div>
      <p id="libHint" class="hint">Tap a song to play it through THIS phone's speaker. Streamed from the PC over your hotspot — the PC keeps doing its own thing.</p>
      <input id="q" class="search" placeholder="SEARCH LIBRARY…" oninput="renderLib()" />
      <ul id="lib" class="lib"></ul>
    </section>

    <!-- VIDEO: stream a video from the PC and watch it on the phone -->
    <section id="viewVideo" class="view">
      <video id="vid" class="vplayer" controls playsinline webkit-playsinline preload="none"></video>
      <p id="vHint" class="hint">Tap a video to stream it from the PC and watch it here. MP4 plays on every phone; MKV / MOV usually can't play in a mobile browser.</p>
      <input id="vq" class="search" placeholder="SEARCH VIDEOS…" oninput="renderVids()" />
      <ul id="vlib" class="lib"></ul>
    </section>
  </main>

  <div id="phoneNow" class="phoneNow">
    <img id="pArt" class="thumb" alt="" />
    <span id="pName" class="n"></span>
    <button id="pPlay" class="btn round" style="width:40px;height:40px;font-size:14px" onclick="phoneToggle()">⏸</button>
    <button id="pNext" class="btn round" style="width:40px;height:40px;font-size:14px" onclick="phoneNext()">⏭</button>
  </div>

  <div id="toast" class="toast"></div>

  <audio id="phoneAudio"></audio>

<script>
(function(){
  var fmt = function(s){ s=Math.max(0,Math.floor(s||0)); var m=Math.floor(s/60); var r=s%60; return m+':'+(r<10?'0':'')+r; };
  var seeking = false;
  var started = false;
  var toastTimer;
  function toast(msg){
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 3500);
  }
  function relock(){
    // Lost access (kicked / server restarted). Back to the PIN screen.
    started = false;
    if(es){ try{ es.close(); }catch(_){} }
    document.getElementById('live').classList.remove('live');
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('pinErr').textContent = 'DISCONNECTED — ENTER PIN AGAIN';
  }

  // ---- AUTH ----
  function params(){ var o={}; location.search.replace(/^\\?/,'').split('&').forEach(function(kv){ if(!kv) return; var p=kv.split('='); o[decodeURIComponent(p[0])]=decodeURIComponent(p[1]||''); }); return o; }
  window.doAuth = function(){
    var pin = document.getElementById('pin').value.trim();
    document.getElementById('pinErr').textContent = '';
    fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})})
      .then(function(r){ if(r.ok){ unlock(); } else { document.getElementById('pinErr').textContent='WRONG PIN'; } })
      .catch(function(){ document.getElementById('pinErr').textContent='NO CONNECTION'; });
  };
  function unlock(){
    document.getElementById('login').classList.add('hidden');
    if(!started){ started = true; connect(); }
  }
  function boot(){
    // Already authed? (cookie present). Otherwise show the PIN screen, auto-
    // submitting a ?pin= from a scanned QR.
    fetch('/library').then(function(r){
      if(r.ok){ unlock(); }
      else {
        var p = params();
        if(p.pin){ document.getElementById('pin').value = p.pin; window.doAuth(); }
      }
    }).catch(function(){});
  }

  // ---- REMOTE: receive PC state over SSE ----
  var es;
  function connect(){
    es = new EventSource('/events');
    es.onopen = function(){ document.getElementById('live').classList.add('live'); };
    es.onerror = function(){
      document.getElementById('live').classList.remove('live');
      // Distinguish a transient drop from a revoked token: a quick auth probe.
      fetch('/library').then(function(r){ if(r.status===401) relock(); }).catch(function(){});
    };
    es.onmessage = function(e){ try { applyState(JSON.parse(e.data)); } catch(_){} };
  }
  var shownArtId = null;
  function applyState(s){
    document.getElementById('rTitle').textContent = s.name || 'NOTHING PLAYING';
    document.getElementById('rArtist').textContent = s.artist || '';
    document.getElementById('rPlay').textContent = s.isPlaying ? '⏸' : '▶';
    document.getElementById('rDur').textContent = fmt(s.duration);
    document.getElementById('rCur').textContent = fmt(s.progress);
    if(!seeking){
      var seek = document.getElementById('rSeek');
      seek.value = s.duration>0 ? Math.round(1000*s.progress/s.duration) : 0;
    }
    var vol = Math.round((s.isMuted?0:s.volume)*100);
    document.getElementById('rVol').value = vol;
    document.getElementById('rVolLbl').textContent = vol+'%';
    var mute = document.getElementById('rMute');
    mute.textContent = s.isMuted ? '🔇' : '🔊';
    mute.classList.toggle('on', !!s.isMuted);
    // Shuffle + repeat reflect the PC's live modes.
    document.getElementById('rShuffle').classList.toggle('on', !!s.isShuffle);
    var rep = document.getElementById('rRepeat');
    var mode = s.repeatMode || 'none';
    rep.classList.toggle('on', mode!=='none');
    rep.classList.toggle('one', mode==='one');
    window.__dur = s.duration||0;
    // Cover art — only swap when the track changes.
    if(s.trackId !== shownArtId){
      shownArtId = s.trackId;
      var img = document.getElementById('rArt'), ph = document.getElementById('rArtPh');
      if(s.trackId){
        img.onload = function(){ img.classList.add('show'); ph.style.display='none'; };
        img.onerror = function(){ img.classList.remove('show'); ph.style.display=''; };
        img.src = '/art/'+encodeURIComponent(s.trackId);
      } else { img.classList.remove('show'); img.removeAttribute('src'); ph.style.display=''; }
    }
  }
  window.cmd = function(type,value){
    fetch('/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:type,value:value})})
      .then(function(r){
        if(r.status===403){ toast('NOT TRUSTED YET — ALLOW THIS DEVICE ON THE PC'); }
        else if(r.status===401){ relock(); }
      }).catch(function(){});
  };
  var seek = document.getElementById('rSeek');
  seek.addEventListener('input', function(){ seeking = true; });
  seek.addEventListener('change', function(){
    var t = (window.__dur||0) * (seek.value/1000);
    window.cmd('seek', t);
    setTimeout(function(){ seeking = false; }, 400);
  });
  var rVol = document.getElementById('rVol');
  rVol.addEventListener('change', function(){ window.cmd('volume', rVol.value/100); });

  // ---- LIBRARY: browse + play on phone OR on the PC ----
  var LIB = [];
  var lastRendered = [];            // the list order currently shown (drives phone auto-advance)
  var current = null;               // track playing on THIS phone
  var target = 'phone';             // where a tapped song plays: 'phone' | 'pc'
  var audio = document.getElementById('phoneAudio');
  function loadLib(){
    fetch('/library').then(function(r){return r.json();}).then(function(d){ LIB = d||[]; renderLib(); }).catch(function(){});
  }
  window.setTarget = function(v){
    target = v;
    document.getElementById('tgtPhone').classList.toggle('active', v==='phone');
    document.getElementById('tgtPc').classList.toggle('active', v==='pc');
    document.getElementById('libHint').textContent = v==='pc'
      ? "Tap a song and the PC plays it (through the PC's speakers). Great for a second room — pick a different song here than what's playing on the phone."
      : "Tap a song to play it through THIS phone's speaker. Streamed from the PC — the PC keeps doing its own thing.";
  };
  function playFromList(t){
    if(target==='pc'){
      window.cmd('playTrack', t.id);   // tell the PC to play it
      showView('remote');              // jump to REMOTE so you see it start
    } else {
      playOnPhone(t);
    }
  }
  window.renderLib = function(){
    var q = (document.getElementById('q').value||'').toLowerCase();
    var ul = document.getElementById('lib');
    var items = LIB.filter(function(t){
      return !q || (t.name+' '+t.artist+' '+t.album).toLowerCase().indexOf(q)>=0;
    }).slice(0,300);
    lastRendered = items;
    ul.innerHTML = '';
    items.forEach(function(t){
      var li = document.createElement('li');
      if(current && current.id===t.id) li.className='playing';
      var img = document.createElement('img'); img.className='thumb'; img.loading='lazy';
      img.src = '/art/'+encodeURIComponent(t.id);
      img.onerror = function(){ img.style.visibility='hidden'; };
      var meta = document.createElement('div'); meta.className='meta';
      var n = document.createElement('div'); n.className='n'; n.textContent = t.name || 'UNKNOWN';
      var a = document.createElement('div'); a.className='a'; a.textContent = (t.artist||'')+(t.album?' — '+t.album:'');
      meta.appendChild(n); meta.appendChild(a);
      li.appendChild(img); li.appendChild(meta);
      li.onclick = function(){ playFromList(t); };
      ul.appendChild(li);
    });
  };
  function playOnPhone(t){
    // Don't leave a video playing under the music.
    try { if(vid && !vid.paused) vid.pause(); } catch(_){}
    current = t;
    audio.src = '/stream/'+encodeURIComponent(t.id);
    audio.play().catch(function(){});
    document.getElementById('pName').textContent = t.name || 'UNKNOWN';
    document.getElementById('pPlay').textContent = '⏸';
    var pa = document.getElementById('pArt');
    pa.style.visibility=''; pa.onerror=function(){ pa.style.visibility='hidden'; };
    pa.src = '/art/'+encodeURIComponent(t.id);
    document.getElementById('phoneNow').classList.add('show');
    renderLib();
  }
  window.phoneToggle = function(){
    if(!current) return;
    if(audio.paused){ audio.play().catch(function(){}); document.getElementById('pPlay').textContent='⏸'; }
    else { audio.pause(); document.getElementById('pPlay').textContent='▶'; }
  };
  // The track after the current one in the list as it's currently shown (search-filtered).
  function nextInList(){
    if(!current) return null;
    for(var i=0;i<lastRendered.length;i++){
      if(lastRendered[i].id===current.id) return lastRendered[i+1]||null;
    }
    return null;
  }
  window.phoneNext = function(){ var n=nextInList(); if(n) playOnPhone(n); };
  // Auto-advance so the phone plays through the list instead of stopping dead.
  audio.addEventListener('ended', function(){
    var n = nextInList();
    if(n){ playOnPhone(n); return; }
    document.getElementById('pPlay').textContent='▶';
  });

  // ---- VIDEO: stream a video from the PC and watch it on the phone ----
  var VIDS = [];
  var lastVids = [];
  var currentVid = null;
  var vid = document.getElementById('vid');
  // Extensions a mobile browser generally CAN'T decode — warn before a blank play.
  var BAD_EXT = { '.mkv':1, '.mov':1, '.avi':1, '.wmv':1, '.flv':1, '.ts':1, '.mpg':1, '.mpeg':1 };
  function loadVids(){
    fetch('/videos').then(function(r){return r.json();}).then(function(d){ VIDS=d||[]; renderVids(); }).catch(function(){});
  }
  window.renderVids = function(){
    var q = (document.getElementById('vq').value||'').toLowerCase();
    var ul = document.getElementById('vlib');
    var items = VIDS.filter(function(t){ return !q || (t.name||'').toLowerCase().indexOf(q)>=0; }).slice(0,300);
    lastVids = items;
    ul.innerHTML = '';
    items.forEach(function(t){
      var li = document.createElement('li');
      if(currentVid===t.id) li.className='playing';
      var meta = document.createElement('div'); meta.className='meta'; meta.style.flex='1';
      var n = document.createElement('div'); n.className='n'; n.textContent = t.name || 'UNKNOWN';
      var a = document.createElement('div'); a.className='a';
      var ext = (t.ext||'').replace('.','').toUpperCase();
      if(ext){
        var span = document.createElement('span');
        span.className = 'tag' + (BAD_EXT[t.ext] ? ' warn' : '');
        span.textContent = BAD_EXT[t.ext] ? ext+" · MAY NOT PLAY" : ext;
        a.appendChild(span);
      }
      meta.appendChild(n); meta.appendChild(a);
      li.appendChild(meta);
      li.onclick = function(){ playVideo(t); };
      ul.appendChild(li);
    });
  };
  function playVideo(t){
    // Watching video and playing phone audio at once makes no sense — stop audio.
    try { audio.pause(); document.getElementById('pPlay').textContent='▶'; } catch(_){}
    currentVid = t.id;
    var hint = document.getElementById('vHint');
    if(BAD_EXT[t.ext]){
      hint.innerHTML = "<b style='color:#ffb454'>"+(t.ext||'').replace('.','').toUpperCase()+" likely won't play in a phone browser.</b> Trying anyway — if it stays black, that format needs an MP4.";
    } else {
      hint.textContent = t.name || '';
    }
    vid.src = '/vstream/'+encodeURIComponent(t.id);
    var p = vid.play(); if(p && p.catch) p.catch(function(){});
    vid.scrollIntoView({ block:'start', behavior:'smooth' });
    renderVids();
  }
  vid.addEventListener('error', function(){
    document.getElementById('vHint').innerHTML = "<b style='color:#ff5555'>THIS FORMAT CAN'T PLAY ON YOUR PHONE.</b> Convert it to MP4 (H.264) to watch it here.";
  });

  window.showView = function(v){
    document.getElementById('viewRemote').classList.toggle('active', v==='remote');
    document.getElementById('viewPhone').classList.toggle('active', v==='phone');
    document.getElementById('viewVideo').classList.toggle('active', v==='video');
    document.getElementById('tabRemote').classList.toggle('active', v==='remote');
    document.getElementById('tabPhone').classList.toggle('active', v==='phone');
    document.getElementById('tabVideo').classList.toggle('active', v==='video');
    // Leaving the video tab: pause playback so audio doesn't keep going unseen.
    if(v!=='video' && !vid.paused) vid.pause();
    if(v==='phone' && LIB.length===0) loadLib();
    if(v==='video' && VIDS.length===0) loadVids();
  };

  document.getElementById('pin').addEventListener('keydown', function(e){ if(e.key==='Enter') window.doAuth(); });
  boot();
})();
</script>
</body>
</html>`;

module.exports = { PAGE };
