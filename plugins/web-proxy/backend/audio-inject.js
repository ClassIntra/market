// backend/audio-inject.js
// 兼容模式音频采集脚本（由 render.js 通过 Page.addScriptToEvaluateOnNewDocument 注入页面）。
//
// 背景：无头浏览器没有可听的音频输出通道，screencast 画面流里也不含声音。
// 这里在页面内把两类声源汇到同一条 16kHz 单声道 PCM 管道：
//   1. <audio> / <video> 元素 —— 用 captureStream() 拿到音轨
//   2. 页面自身创建的 WebAudio —— 旁路 hook AudioNode.connect，
//      把最终接到扬声器（destination）的节点同时接一份到 MediaStreamDestination
// 每 256ms 编码一包 int16 PCM，base64 后调用 Runtime.addBinding 暴露的 __ciAudioChunk 回传服务端，
// 前端再用 Web Audio 按 PCM 直接播放（无需 MSE，延迟更低、兼容性更稳）。
//
// 已知限制：
//   - 受 CORS 限制的跨域媒体在 Web Audio 里会输出静音（浏览器安全策略，无法绕过）
//   - DRM 保护音轨（Widevine 等）无法采集
//   - 开启前已经接好的 WebAudio 连线不会被回溯捕获（引擎普遍在用户交互后建图，实际影响很小）
//
// 代码风格：ES5（页面环境兼容）+ 2 空格缩进 + 单引号；该文件不导出模块，只作为注入文本被读取。

(function () {
  if (window.__ciAudioInstalled) return;
  window.__ciAudioInstalled = true;

  var RATE = 16000;   // 回传采样率（单声道）
  var BLOCK = 4096;   // ScriptProcessor 缓冲（16kHz 下约 256ms 一包）

  var state = {
    enabled: false,
    ctx: null,
    processor: null,
    sink: null,
    media: [],      // [{ el, stream, node }]
    taps: [],       // [{ ctx, dest }] 页面 WebAudio 上下文的采集口
    pending: [],    // [{ ctx, node }] 页面里连到扬声器的节点（开启前的连线也要补采）
    edges: [],      // [{ node, dest }] 已经旁路接过的连线，避免重复连接导致音量叠加
    timer: null
  };

  function post(payload) {
    try {
      if (typeof window.__ciAudioChunk === 'function') window.__ciAudioChunk(payload);
    } catch (e) {}
  }

  // 采集上下文与处理后端：所有声源都接到 processor，processor 经 0 增益节点连到 destination
  // 只为让音频图被驱动（无头环境没有声卡，不会真的出声）。
  function ensureCtx() {
    if (state.ctx) return state.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      state.ctx = new AC({ sampleRate: RATE });
    } catch (e) {
      try { state.ctx = new AC(); } catch (e2) { return null; }
    }
    var proc = null;
    try {
      proc = state.ctx.createScriptProcessor(BLOCK, 1, 1);
    } catch (e) {
      return null;
    }
    proc.onaudioprocess = function (ev) {
      if (!state.enabled) return;
      try { collect(ev.inputBuffer.getChannelData(0)); } catch (e) {}
    };
    var gain = state.ctx.createGain();
    gain.gain.value = 0;
    try {
      proc.connect(gain);
      gain.connect(state.ctx.destination);
    } catch (e) {}
    state.processor = proc;
    state.sink = gain;
    try { if (state.ctx.state === 'suspended') state.ctx.resume(); } catch (e) {}
    return state.ctx;
  }

  // 把任意采样率的浮点块降采样到 16kHz，转 int16 后 base64 回传
  function collect(f32) {
    if (!f32 || !f32.length) return;
    var rate = state.ctx ? (state.ctx.sampleRate || RATE) : RATE;
    var ratio = rate / RATE;
    var outLen = Math.floor(f32.length / ratio);
    if (outLen <= 0) return;
    var out = new Int16Array(outLen);
    var peak = 0;
    for (var i = 0; i < outLen; i++) {
      var s = Math.floor(i * ratio);
      var e = Math.floor((i + 1) * ratio);
      if (e <= s) e = s + 1;
      if (e > f32.length) e = f32.length;
      var sum = 0;
      for (var j = s; j < e; j++) sum += f32[j] || 0;
      var v = sum / (e - s);
      if (v > 1) v = 1; else if (v < -1) v = -1;
      out[i] = Math.round(v * 32767);
      var a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    // 全静音不发：页面挂着但没声音时不白占带宽
    if (peak < 0.0005) return;
    var b64 = '';
    try { b64 = encode(out); } catch (e) { return; }
    if (b64) post(b64);
  }

  function encode(i16) {
    var bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
    var str = '';
    var STEP = 0x8000;
    for (var i = 0; i < bytes.length; i += STEP) {
      str += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
    }
    return btoa(str);
  }

  // ---- 媒体元素：captureStream 拿音轨，接入采集管道 ----
  function attachMedia(el) {
    if (!state.enabled || !el) return;
    if (el.muted) return;
    var ctx = ensureCtx();
    if (!ctx || !state.processor) return;

    var i;
    var rec = null;
    for (i = 0; i < state.media.length; i++) {
      if (state.media[i].el === el) { rec = state.media[i]; break; }
    }
    if (rec) {
      // 元素重设 src 后旧音轨会 ended，需要重新捕获
      var old = rec.stream.getAudioTracks ? rec.stream.getAudioTracks() : [];
      if (old.length && old[0].readyState === 'live') return;
      try { rec.node.disconnect(); } catch (e) {}
      state.media.splice(i, 1);
    }

    var stream = null;
    try {
      if (typeof el.captureStream === 'function') stream = el.captureStream();
      else if (typeof el.mozCaptureStream === 'function') stream = el.mozCaptureStream();
    } catch (e) { return; }
    if (!stream || !stream.getAudioTracks) return;
    var tracks = stream.getAudioTracks();
    if (!tracks.length) return;

    var node = null;
    try { node = ctx.createMediaStreamSource(stream); } catch (e) { return; }
    try { node.connect(state.processor); } catch (e) { return; }
    state.media.push({ el: el, stream: stream, node: node });
  }

  function scan() {
    if (!state.enabled) return;
    var i;
    var audios = document.getElementsByTagName('audio');
    for (i = 0; i < audios.length; i++) attachMedia(audios[i]);
    var videos = document.getElementsByTagName('video');
    for (i = 0; i < videos.length; i++) attachMedia(videos[i]);
  }

  // 媒体元素的 play 事件不冒泡，但捕获阶段能看到
  document.addEventListener('play', function (ev) {
    if (state.enabled && ev.target) attachMedia(ev.target);
  }, true);

  // ---- WebAudio：把最终连到 destination 的节点旁路接一份到采集口 ----
  function tapFor(pageCtx, node) {
    if (!pageCtx || !node) return;
    var ctx = ensureCtx();
    if (!ctx || !state.processor) return;
    var dest = null;
    var i;
    for (i = 0; i < state.taps.length; i++) {
      if (state.taps[i].ctx === pageCtx) { dest = state.taps[i].dest; break; }
    }
    if (!dest) {
      try { dest = pageCtx.createMediaStreamDestination(); } catch (e) { return; }
      try {
        var src = ctx.createMediaStreamSource(dest.stream);
        src.connect(state.processor);
      } catch (e) { return; }
      state.taps.push({ ctx: pageCtx, dest: dest });
    }
    for (i = 0; i < state.edges.length; i++) {
      if (state.edges[i].node === node && state.edges[i].dest === dest) return;
    }
    try {
      node.connect(dest);
      state.edges.push({ node: node, dest: dest });
    } catch (e) {}
  }

  function hookAudioGraph() {
    if (!window.AudioNode || !AudioNode.prototype || !AudioNode.prototype.connect) return;
    if (AudioNode.prototype.connect.__ciHooked) return;
    var origConnect = AudioNode.prototype.connect;
    var patchedConnect = function (dest) {
      var ret = origConnect.apply(this, arguments);
      try {
        if (dest && typeof AudioDestinationNode !== 'undefined' &&
            dest instanceof AudioDestinationNode && this.context && this.context !== state.ctx) {
          // 先登记：页面可能在用户开声音之前就把音频图接好了，开启时再补采
          var i;
          var known = false;
          for (i = 0; i < state.pending.length; i++) {
            if (state.pending[i].node === this && state.pending[i].ctx === this.context) {
              known = true;
              break;
            }
          }
          if (!known) state.pending.push({ ctx: this.context, node: this });
          if (state.enabled) tapFor(this.context, this);
        }
      } catch (e) {}
      return ret;
    };
    patchedConnect.__ciHooked = true;
    AudioNode.prototype.connect = patchedConnect;

    // 页面整体断开（disconnect() 无参）时同步清掉我们的旁路记录，否则重连后不再补采
    var origDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.disconnect = function () {
      var ret = origDisconnect.apply(this, arguments);
      try {
        if (!arguments.length) {
          for (var i = state.edges.length - 1; i >= 0; i--) {
            if (state.edges[i].node === this) state.edges.splice(i, 1);
          }
        }
      } catch (e) {}
      return ret;
    };
  }

  hookAudioGraph();

  // ---- 对外开关：由服务端 Runtime.evaluate 调用 ----
  function start() {
    state.enabled = true;
    var ctx = ensureCtx();
    if (!ctx) {
      state.enabled = false;
      return false;
    }
    try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
    scan();
    // 补采开启前就接好的 WebAudio 连线
    for (var i = 0; i < state.pending.length; i++) {
      tapFor(state.pending[i].ctx, state.pending[i].node);
    }
    if (!state.timer) state.timer = setInterval(scan, 1500);
    return true;
  }

  function stop() {
    state.enabled = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    for (var i = 0; i < state.media.length; i++) {
      try { state.media[i].node.disconnect(); } catch (e) {}
    }
    state.media = [];
    try { if (state.ctx && state.ctx.state === 'running') state.ctx.suspend(); } catch (e) {}
  }

  window.__ciAudioStart = start;
  window.__ciAudioStop = stop;
  window.__ciAudioSupported = function () {
    return !!(window.AudioContext || window.webkitAudioContext);
  };
})();
