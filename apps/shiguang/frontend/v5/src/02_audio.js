  // ---------------- §5 音频 ----------------
  // 音乐用两条 <audio> 交叉淡入（换区不断档），音效用 WebAudio 解码后按需播放
  // （同一帧里七八个打击音要能叠着响，<audio> 做不到）。
  // 自动播放策略：第一次触摸/按键时 resume()，在此之前静音排队。
  var AU = {
    ctx: null,
    master: null,
    sfxGain: null,
    musicGain: null,
    bufs: {},
    pending: {},
    a: null,
    b: null,
    cur: '',
    on: true,
    ready: false
  };

  function auInit(assetUrl) {
    AU.assetUrl = assetUrl;
    AU.a = new Audio();
    AU.b = new Audio();
    AU.a.loop = true; AU.b.loop = true;
    AU.a.volume = 0; AU.b.volume = 0;
    AU.a.preload = 'auto'; AU.b.preload = 'auto';
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        AU.ctx = new AC();
        AU.master = AU.ctx.createGain();
        AU.master.gain.value = 0.9;
        AU.master.connect(AU.ctx.destination);
        AU.sfxGain = AU.ctx.createGain();
        AU.sfxGain.gain.value = 0.85;
        AU.sfxGain.connect(AU.master);
      }
    } catch (e) { AU.ctx = null; }
  }

  function auResume() {
    if (AU.ctx && AU.ctx.state === 'suspended') { try { AU.ctx.resume(); } catch (e) {} }
    AU.ready = true;
    if (AU.cur) auMusic(AU.cur, true);
  }

  // 播放一段背景音乐（同名不重播）
  function auMusic(name, force) {
    if (!name || (AU.cur === name && !force)) return;
    AU.cur = name;
    var want = 'frontend/v5/' + (MUSIC[name] || MUSIC.meadow);
    var url = AU.assetUrl(want);
    var fade = AU.on && AU.ready;
    var from = fade ? AU.a : (AU.a.src && AU.a.volume >= AU.b.volume ? AU.a : AU.b);
    var to = from === AU.a ? AU.b : AU.a;
    if (from.src && from.src.indexOf(url) >= 0) { from.volume = fade ? 0.45 : 0; return; }
    try {
      to.src = url;
      to.currentTime = 0;
      to.volume = 0;
      var pr = to.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) { return; }
    var t0 = Date.now(), dur = 900;
    var step = function () {
      if (!AU.on) { from.volume = 0; to.volume = 0; return; }
      var k = clamp((Date.now() - t0) / dur, 0, 1);
      to.volume = 0.42 * k;
      from.volume = 0.42 * (1 - k);
      if (k < 1) setTimeout(step, 60);
      else { try { from.pause(); } catch (e) {} }
    };
    step();
  }

  function auSfxLoad(key) {
    if (AU.bufs[key] || AU.pending[key] || !AU.ctx) return;
    var rel = SFX[key];
    if (!rel) return;
    AU.pending[key] = 1;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', AU.assetUrl('frontend/v5/' + rel), true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (!xhr.response) { AU.pending[key] = 0; return; }
        AU.ctx.decodeAudioData(xhr.response, function (buf) {
          AU.bufs[key] = buf;
          AU.pending[key] = 0;
        }, function () { AU.pending[key] = 0; });
      };
      xhr.onerror = function () { AU.pending[key] = 0; };
      xhr.send();
    } catch (e) { AU.pending[key] = 0; }
  }

  // rate：音高倍率（同一段打击音变调，听感不重复）
  function auSfx(key, vol, rate) {
    if (!AU.on || !AU.ctx || !AU.ready) return;
    var buf = AU.bufs[key];
    if (!buf) { auSfxLoad(key); return; }
    try {
      var src = AU.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate || 1;
      var g = AU.ctx.createGain();
      g.gain.value = vol == null ? 0.5 : vol;
      src.connect(g);
      g.connect(AU.sfxGain);
      src.start(0);
    } catch (e) {}
  }

  function auSetOn(on) {
    AU.on = !!on;
    if (AU.a) AU.a.volume = AU.on ? (AU.cur ? 0.42 : 0) : 0;
    if (AU.b) AU.b.volume = 0;
    if (!AU.on) { try { AU.a.pause(); } catch (e) {} try { AU.b.pause(); } catch (e) {} AU.cur = ''; }
  }

  function auDispose() {
    try { AU.a.pause(); AU.b.pause(); } catch (e) {}
    AU.a = AU.b = null;
    if (AU.ctx) { try { AU.ctx.close(); } catch (e) {} }
    AU.ctx = null;
  }
