// backend/audio-inject.js
// 兼容模式音频采集脚本（由 render.js 通过 Page.addScriptToEvaluateOnNewDocument 注入页面）。
//
// 背景：无头浏览器没有可听的音频输出通道，screencast 画面流里也不含声音。
// 这里在页面内把两类声源汇到同一条 24kHz 单声道 PCM 管道：
//   1. <audio> / <video> 元素 —— 用 captureStream() 拿到音轨
//   2. 页面自身创建的 WebAudio —— 旁路 hook AudioNode.connect，
//      把最终接到扬声器（destination）的节点同时接一份到 MediaStreamDestination
// 每 1024 帧编码一包 int16 PCM（24kHz 下约 43ms），base64 后调用 Runtime.addBinding 暴露的 __ciAudioChunk 回传服务端，
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

  var RATE = 24000;   // 回传采样率（单声道）
  var BLOCK = 1024;   // ScriptProcessor 缓冲（24kHz 下约 43ms 一包，延迟更低）

  var state = {
    enabled: false,
    ctx: null,
    processor: null,
    sink: null,
    media: [],      // [{ el, stream, node }]
    taps: [],       // [{ ctx, dest }] 页面 WebAudio 上下文的采集口
    pending: [],    // [{ ctx, node }] 页面里连到扬声器的节点（开启前的连线也要补采）
    edges: [],      // [{ node, dest }] 已经旁路接过的连线，避免重复连接导致音量叠加
    sinks: [],      // [{ ctx, gain }] 页面 WebAudio 的 0 增益出口（宿主静音用）
    timer: null
  };

  function post(payload) {
    try {
      if (typeof window.__ciAudioChunk === 'function') window.__ciAudioChunk(payload);
    } catch (e) {}
  }

  // 采集上下文与处理后端：所有声源都接到 processor，processor 经 0 增益节点连到 destination
  // 只为让音频图被驱动（这个 0 增益出口不发声，宿主扬声器保持安静）。
  //
  // 采样率用系统默认值而不是强制 24kHz：强制非原生采样率会让 Windows 音频端点
  // 重新协商格式，在部分 Realtek / 蓝牙驱动上会把默认播放设备拉哑（整机失声）。
  // 降采样到回传用的 24kHz 在 collect() 里完成，与上下文采样率无关。
  function ensureCtx() {
    if (state.ctx) return state.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { state.ctx = new AC(); } catch (e) { return null; }
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
  // 注意：媒体元素已由 installSilence() 在属性层强制 muted，宿主扬声器不会出声；
  // 实测 muted / volume=0 均不影响 captureStream 采集（Chromium 采集的是解码后的音轨），
  // 所以这里不再跳过 muted 元素，否则页面自己静音过的播放器就永远采不到声音。
  function attachMedia(el) {
    if (!state.enabled || !el) return;
    try { if (el.muted !== true) el.muted = true; } catch (e) {}
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
    // 先清理已移除 / 音轨已结束的媒体：SPA 反复换播放器时采集节点不能无限堆积
    for (var k = state.media.length - 1; k >= 0; k--) {
      var rec = state.media[k];
      var tracks = rec.stream.getAudioTracks ? rec.stream.getAudioTracks() : [];
      var alive = tracks.length > 0 && tracks[0].readyState === 'live' &&
        rec.el && rec.el.isConnected !== false;
      if (!alive) {
        try { rec.node.disconnect(); } catch (e) {}
        state.media.splice(k, 1);
      }
    }
    var i;
    var audios = document.getElementsByTagName('audio');
    for (i = 0; i < audios.length; i++) attachMedia(audios[i]);
    var videos = document.getElementsByTagName('video');
    for (i = 0; i < videos.length; i++) attachMedia(videos[i]);
  }

  // 媒体元素的 play 事件不冒泡，但捕获阶段能看到。
  // 这里同时做两件事：1) 播放开始即强制静音（覆盖 autoplay 属性这类不走 JS play() 的情况）；
  // 2) 声音开关打开时接入采集管道——静音不影响采集音量。
  document.addEventListener('play', function (ev) {
    try { if (ev.target && ev.target.muted !== true) ev.target.muted = true; } catch (e) {}
    if (state.enabled && ev.target) attachMedia(ev.target);
  }, true);

  // ---- WebAudio：把最终连到 destination 的节点旁路接一份到采集口 ----
  // 页面 WebAudio 的扬声器出口统一改接 0 增益节点（见 patchedConnect）：
  // 声音照常进入采集旁路，宿主扬声器一点声音都不出。
  function silentSinkFor(pageCtx) {
    var i;
    for (i = 0; i < state.sinks.length; i++) {
      if (state.sinks[i].ctx === pageCtx) return state.sinks[i].gain;
    }
    var gain = null;
    try {
      gain = pageCtx.createGain();
      gain.gain.value = 0;
    } catch (e) { return null; }
    // 打标记：这个节点自己接 destination 时不能再被改接，否则会接成自己
    gain.__ciSink = true;
    state.sinks.push({ ctx: pageCtx, gain: gain });
    try { gain.connect(pageCtx.destination); } catch (e) {}
    return gain;
  }

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
      state.taps.push({ ctx: pageCtx, dest: dest, src: src });
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
      var args = Array.prototype.slice.call(arguments);
      try {
        if (dest && typeof AudioDestinationNode !== 'undefined' &&
            dest instanceof AudioDestinationNode && this.context && this.context !== state.ctx &&
            !this.__ciSink) {
          // 1) 先登记：页面可能在用户开声音之前就把音频图接好了，开启时再补采
          var i;
          var known = false;
          for (i = 0; i < state.pending.length; i++) {
            if (state.pending[i].node === this && state.pending[i].ctx === this.context) {
              known = true;
              break;
            }
          }
          if (!known) state.pending.push({ ctx: this.context, node: this });
          // 2) 宿主静音：把「接扬声器」改成接 0 增益出口。页面照常播放、照常解码，
          //    但宿主扬声器不出声；采集旁路仍然拿到完整音量。
          //    不再依赖浏览器启动参数 --mute-audio——该参数会让 Chromium 以「静音会话」
          //    占用系统音频端点，在部分 Windows 驱动 / 蓝牙耳机上会把整台电脑的音频拉哑。
          var sink = silentSinkFor(this.context);
          if (sink) args[0] = sink;
          if (state.enabled) tapFor(this.context, this);
        }
      } catch (e) {}
      return origConnect.apply(this, args);
    };
    patchedConnect.__ciHooked = true;
    AudioNode.prototype.connect = patchedConnect;

    // 页面整体断开（disconnect() 无参）时同步清掉我们的旁路记录，否则重连后不再补采。
    // disconnect(destination) 也要映射到静音出口，否则页面按原 destination 断开时
    // 找不到实际连线会抛 InvalidAccessError，打断页面自己的音频逻辑。
    var origDisconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.disconnect = function (dest) {
      var args = Array.prototype.slice.call(arguments);
      try {
        if (dest && typeof AudioDestinationNode !== 'undefined' &&
            dest instanceof AudioDestinationNode && this.context && this.context !== state.ctx &&
            !this.__ciSink) {
          var sink = silentSinkFor(this.context);
          if (sink) args[0] = sink;
        }
        if (!arguments.length) {
          for (var i = state.edges.length - 1; i >= 0; i--) {
            if (state.edges[i].node === this) state.edges.splice(i, 1);
          }
        }
      } catch (e) {}
      return origDisconnect.apply(this, args);
    };
  }

  // ---- 宿主静音：页面媒体元素统一强制 muted ----
  // 为什么不用浏览器启动参数 --mute-audio：该参数会让 Chromium 以「静音会话」占用
  // 系统音频端点，在部分 Windows 驱动 / 蓝牙耳机上会把整台电脑的音频一起拉哑
  // （用户反馈「静音后整个电脑都没声音」就出在这里）。改为页面内属性层静音，
  // 声音只经采集管道回传给手机，完全不碰系统音频会话状态。
  // 实测 muted / volume=0 都不影响 captureStream 采集（采集的是解码后的音轨）。
  function installSilence() {
    try {
      var proto = window.HTMLMediaElement ? HTMLMediaElement.prototype : null;
      if (!proto || proto.__ciMutedHooked) return;
      proto.__ciMutedHooked = true;
      var desc = Object.getOwnPropertyDescriptor(proto, 'muted');
      if (desc && desc.get && desc.set) {
        Object.defineProperty(proto, 'muted', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () { return desc.get.call(this); },
          set: function () { desc.set.call(this, true); }
        });
      }
      // 已存在的元素（页内跳转 / 复用文档）立即补静音
      muteWithin(document);
      // 页面运行中新建的元素：插入即静音，避免解析器创建的元素在 play 事件前出声
      try {
        if (window.MutationObserver && document.documentElement) {
          new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
              var added = records[i].addedNodes;
              for (var j = 0; j < added.length; j++) muteWithin(added[j]);
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        }
      } catch (e) {}
    } catch (e) {}
  }

  // 把一个节点自身及其子节点里的 audio/video 全部静音
  function muteWithin(node) {
    try {
      if (!node || node.nodeType !== 1) return;
      var tag = node.tagName;
      if (tag === 'AUDIO' || tag === 'VIDEO') node.muted = true;
      var list = node.querySelectorAll ? node.querySelectorAll('audio,video') : null;
      if (list) {
        for (var i = 0; i < list.length; i++) list[i].muted = true;
      }
    } catch (e) {}
  }

  installSilence();
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
    // 断开 WebAudio 旁路：页面声音不再进入采集口
    for (var j = 0; j < state.edges.length; j++) {
      try { state.edges[j].node.disconnect(state.edges[j].dest); } catch (e) {}
    }
    state.edges = [];
    for (var k = 0; k < state.taps.length; k++) {
      try { if (state.taps[k].src) state.taps[k].src.disconnect(); } catch (e) {}
    }
    state.taps = [];
    // 关键：不调用 ctx.suspend()。挂起会让浏览器关闭这条系统音频输出流，
    // 部分 Windows 音频驱动在频繁开关流后会把默认播放设备卡在「无声」状态
    // （用户主观感受就是整台电脑没声音）。上下文保持运行，出口 0 增益天然无声，
    // 再次开启时直接复用，全程不再触碰系统音频端点的开关。
  }

  window.__ciAudioStart = start;
  window.__ciAudioStop = stop;
  window.__ciAudioSupported = function () {
    return !!(window.AudioContext || window.webkitAudioContext);
  };
})();
