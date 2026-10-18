// backend/hook.js
// 注入到代理页面里的客户端脚本：拦截一切 URL 生成入口，
// 把目标站点的真实 URL 改写为经代理转发的 URL。
//
// 该文件被 rewrite.js 以字符串方式读入并内联注入到 HTML 的 <head> 中，
// 因此它必须能作为独立 script 体运行（不能使用 import/export）。

(function () {
  'use strict';

  var PROXY_BASE = window.__PROXY_BASE__ || '';
  if (!PROXY_BASE) return;
  if (window.__PROXY_HOOK_INSTALLED__) return;
  window.__PROXY_HOOK_INSTALLED__ = true;

  var LOC = window.location;

  // 页面自身的真实地址：从代理路径反解出来
  // <PROXY_BASE>/<scheme>/<host>/<path>
  function parseProxyLocation() {
    var href = LOC.href;
    var rest = href;
    if (rest.indexOf(PROXY_BASE) === 0) {
      rest = rest.substring(PROXY_BASE.length);
    }
    if (rest.charAt(0) === '/') rest = rest.substring(1);
    var m = /^(https?)\/([^\/]+)(\/.*)?$/i.exec(rest);
    if (!m) return null;
    var scheme = m[1].toLowerCase();
    var host = m[2];
    var pathAndQuery = m[3] || '/';
    return {
      scheme: scheme,
      host: host,
      origin: scheme + '://' + host,
      realUrl: scheme + '://' + host + pathAndQuery
    };
  }

  var PAGE = parseProxyLocation();
  if (!PAGE) return;

  var FAKE_ORIGIN = PAGE.origin;
  var SCHEME = PAGE.scheme;

  // ---- URL 改写核心 ----

  function isBypass(u) {
    if (!u || typeof u !== 'string') return true;
    var lower = u.toLowerCase();
    if (lower.charAt(0) === '#') return true;
    if (lower.indexOf('data:') === 0) return true;
    if (lower.indexOf('javascript:') === 0) return true;
    if (lower.indexOf('mailto:') === 0) return true;
    if (lower.indexOf('blob:') === 0) return true;
    if (lower.indexOf('about:') === 0) return true;
    if (lower.indexOf('tel:') === 0) return true;
    if (lower.indexOf('chrome-extension:') === 0) return true;
    if (lower.indexOf(PROXY_BASE + '/') === 0) return true;
    return false;
  }

  function toProxy(absolute) {
    try {
      var parsed = new URL(absolute);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      var scheme = parsed.protocol === 'https:' ? 'https' : 'http';
      var out = PROXY_BASE + '/' + scheme + '/' + parsed.host + (parsed.pathname || '/');
      if (parsed.search) out += parsed.search;
      if (parsed.hash) out += parsed.hash;
      return out;
    } catch (e) {
      return null;
    }
  }

  // 把任意 URL 引用转成代理 URL；无法处理时原样返回
  function rewrite(u) {
    if (isBypass(u)) return u;
    try {
      var absolute;
      if (/^[a-z][a-z0-9+.-]*:/i.test(u)) {
        absolute = u;
      } else if (u.indexOf('//') === 0) {
        absolute = SCHEME + ':' + u;
      } else {
        absolute = new URL(u, PAGE.realUrl).href;
      }
      var proxied = toProxy(absolute);
      return proxied || u;
    } catch (e) {
      return u;
    }
  }

  // 代理 URL 还原为真实 URL
  function unrewrite(u) {
    if (!u || typeof u !== 'string') return u;
    if (u.indexOf(PROXY_BASE + '/') === 0) {
      var rest = u.substring(PROXY_BASE.length);
      var m = /^\/(https?)\/([^\/]+)(\/.*)?$/i.exec(rest);
      if (m) return m[1].toLowerCase() + '://' + m[2] + (m[3] || '/');
    }
    return u;
  }

  function addProxyBaseHeader(target) {
    try {
      if (!target) return;
      var h = target.headers;
      if (!h) {
        target.headers = { 'X-Proxy-Base': FAKE_ORIGIN };
        return;
      }
      if (typeof h.set === 'function') {
        if (!h.has('X-Proxy-Base')) h.set('X-Proxy-Base', FAKE_ORIGIN);
        return;
      }
      if (typeof h.append === 'function') {
        h.append('X-Proxy-Base', FAKE_ORIGIN);
        return;
      }
      if (typeof h.push === 'function') {
        h.push(['X-Proxy-Base', FAKE_ORIGIN]);
        return;
      }
      if (typeof h === 'object') {
        target.headers = Object.assign({}, h, { 'X-Proxy-Base': FAKE_ORIGIN });
      }
    } catch (e) {}
  }

  // ---- 向父窗口上报真实地址（供超能岛浏览器地址栏同步）----
  var lastReportedUrl = '';

  function currentRealUrl() {
    var parsed = parseProxyLocation();
    return parsed ? parsed.realUrl : PAGE.realUrl;
  }

  function reportPageInfo() {
    try {
      if (!window.parent || window.parent === window) return;
      var u = currentRealUrl();
      if (u === lastReportedUrl) return;
      lastReportedUrl = u;
      window.parent.postMessage({
        type: 'web-proxy',
        v: '1.0',
        source: 'web-proxy-page',
        action: 'web-proxy-page-info',
        payload: { url: u, title: document.title || '' },
        timestamp: Date.now()
      }, '*');
    } catch (e) {}
  }

  // ---- XMLHttpRequest ----
  var NativeXHR = window.XMLHttpRequest;
  if (typeof NativeXHR === 'function') {
    var XHRProto = NativeXHR.prototype;
    var xhrOpen = XHRProto.open;
    var xhrSend = XHRProto.send;
    var xhrSetHeader = XHRProto.setRequestHeader;

    XHRProto.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof url === 'string') args[1] = rewrite(url);
      return xhrOpen.apply(this, args);
    };

    XHRProto.setRequestHeader = function (name, value) {
      if (String(name).toLowerCase() === 'x-proxy-base') return;
      return xhrSetHeader.call(this, name, value);
    };

    XHRProto.send = function () {
      try {
        xhrSetHeader.call(this, 'X-Proxy-Base', FAKE_ORIGIN);
      } catch (e) {}
      return xhrSend.apply(this, arguments);
    };
  }

  // ---- fetch ----
  var nativeFetchFn = window.fetch;
  if (typeof nativeFetchFn === 'function') {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          input = rewrite(input);
        } else if (input && typeof input.url === 'string') {
          var nextUrl = rewrite(input.url);
          if (nextUrl !== input.url && typeof Request === 'function') {
            input = new Request(nextUrl, input);
          }
        }
        if (!init) {
          init = {};
        }
        addProxyBaseHeader(init);
      } catch (e) {}
      return nativeFetchFn.call(window, input, init);
    };
  }

  // ---- window.open ----
  var nativeWindowOpen = window.open;
  if (typeof nativeWindowOpen === 'function') {
    window.open = function (url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof url === 'string') args[0] = rewrite(url);
      return nativeWindowOpen.apply(window, args);
    };
  }

  // ---- history ----
  var nativePushState = window.history.pushState;
  var nativeReplaceState = window.history.replaceState;

  window.history.pushState = function (state, title, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string') args[2] = rewrite(url);
    var result = nativePushState.apply(window.history, args);
    reportPageInfo();
    return result;
  };

  window.history.replaceState = function (state, title, url) {
    var args = Array.prototype.slice.call(arguments);
    if (typeof url === 'string') args[2] = rewrite(url);
    var result = nativeReplaceState.apply(window.history, args);
    reportPageInfo();
    return result;
  };

  window.addEventListener('popstate', reportPageInfo);
  window.addEventListener('hashchange', reportPageInfo);

  // ---- EventSource ----
  var NativeES = window.EventSource;
  if (typeof NativeES === 'function') {
    window.EventSource = function (url, opts) {
      return new NativeES(rewrite(String(url)), opts);
    };
  }

  // ---- WebSocket ----
  var NativeWS = window.WebSocket;
  if (typeof NativeWS === 'function') {
    window.WebSocket = function (url, protocols) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof url === 'string') args[0] = rewrite(url);
      if (protocols !== undefined) {
        return new NativeWS(args[0], protocols);
      }
      return new NativeWS(args[0]);
    };
    // 复制静态属性
    window.WebSocket.CONNECTING = NativeWS.CONNECTING;
    window.WebSocket.OPEN = NativeWS.OPEN;
    window.WebSocket.CLOSING = NativeWS.CLOSING;
    window.WebSocket.CLOSED = NativeWS.CLOSED;
    window.WebSocket.prototype = NativeWS.prototype;
  }

  // ---- Image.src ----
  try {
    var imgProto = window.HTMLImageElement && window.HTMLImageElement.prototype;
    if (imgProto) {
      var imgDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
      if (imgDesc && imgDesc.set && imgDesc.get) {
        Object.defineProperty(imgProto, 'src', {
          configurable: true,
          enumerable: imgDesc.enumerable,
          get: function () {
            return imgDesc.get.call(this);
          },
          set: function (value) {
            imgDesc.set.call(this, rewrite(String(value)));
          }
        });
      }
    }
  } catch (e) {}

  // ---- Element.setAttribute ----
  var URL_ATTRS = ['src', 'href', 'action', 'poster', 'background', 'data-src', 'data-href', 'srcset', 'formaction', 'srcdoc', 'data', 'codebase', 'icon', 'manifest', 'xlink:href'];
  var nativeSetAttribute = null;
  try {
    nativeSetAttribute = window.Element.prototype.setAttribute;
  } catch (e) {
    nativeSetAttribute = null;
  }

  function rewriteAttrValue(name, value) {
    if (typeof value !== 'string' || isBypass(value)) return value;
    if (name === 'srcset') {
      var parts = value.split(',');
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (!part) continue;
        var idx = part.lastIndexOf(' ');
        var urlish = idx > 0 ? part.substring(0, idx).trim() : part;
        var desc = idx > 0 ? part.substring(idx) : '';
        out.push(rewrite(urlish) + desc);
      }
      return out.join(', ');
    }
    return rewrite(value);
  }

  if (nativeSetAttribute) {
    window.Element.prototype.setAttribute = function (name, value) {
      var lower = String(name).toLowerCase();
      if (URL_ATTRS.indexOf(lower) >= 0) {
        value = rewriteAttrValue(lower, value);
      }
      return nativeSetAttribute.call(this, name, value);
    };
  }

  // ---- CSS backgroundImage ----
  try {
    var styleProto = window.CSSStyleDeclaration && window.CSSStyleDeclaration.prototype;
    if (styleProto) {
      var bgDesc = Object.getOwnPropertyDescriptor(styleProto, 'backgroundImage');
      if (bgDesc && bgDesc.set && bgDesc.get) {
        Object.defineProperty(styleProto, 'backgroundImage', {
          configurable: true,
          enumerable: bgDesc.enumerable,
          get: function () {
            return bgDesc.get.call(this);
          },
          set: function (value) {
            var next = String(value).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
              return 'url(' + rewrite(u) + ')';
            });
            bgDesc.set.call(this, next);
          }
        });
      }
    }
  } catch (e) {}

  // ---- 节点扫描（新插入的节点）----
  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    for (var i = 0; i < URL_ATTRS.length; i++) {
      var name = URL_ATTRS[i];
      var val = node.getAttribute && node.getAttribute(name);
      if (!val || isBypass(val)) continue;
      var next = rewriteAttrValue(name, val);
      if (next && next !== val && nativeSetAttribute) {
        nativeSetAttribute.call(node, name, next);
      }
    }
    var tags = node.querySelectorAll ? node.querySelectorAll('*') : [];
    for (var k = 0; k < tags.length; k++) scanNode(tags[k]);
  }

  // ---- MutationObserver ----
  try {
    if (typeof window.MutationObserver === 'function') {
      var observer = new window.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var rec = records[i];
          if (rec.type === 'attributes') {
            var el = rec.target;
            var attrName = rec.attributeName;
            if (URL_ATTRS.indexOf(attrName) < 0) continue;
            var val = el.getAttribute(attrName);
            if (!val || isBypass(val)) continue;
            var next = rewriteAttrValue(attrName, val);
            if (next && next !== val && nativeSetAttribute) {
              nativeSetAttribute.call(el, attrName, next);
            }
          } else if (rec.type === 'childList') {
            for (var j = 0; j < rec.addedNodes.length; j++) {
              scanNode(rec.addedNodes[j]);
            }
          }
        }
      });
      observer.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: URL_ATTRS
      });
    }
  } catch (e) {}

  // ---- DOM 就绪后全量扫一遍 ----
  function sweep() {
    try {
      var tags = document.querySelectorAll('*');
      for (var i = 0; i < tags.length; i++) {
        scanNode(tags[i]);
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }

  // 首次上报页面地址
  try {
    setTimeout(reportPageInfo, 400);
  } catch (e) {}

  // ---- window.location 赋值拦截 ----
  try {
    var locProto = window.Location && window.Location.prototype;
    if (locProto) {
      var hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
      if (hrefDesc && hrefDesc.set && hrefDesc.get) {
        var _locNavigating = false;
        Object.defineProperty(locProto, 'href', {
          configurable: true,
          enumerable: hrefDesc.enumerable,
          get: function () { return hrefDesc.get.call(this); },
          set: function (value) {
            if (_locNavigating) { hrefDesc.set.call(this, value); return; }
            var s = String(value);
            var rewritten = rewrite(s);
            if (rewritten !== s) {
              _locNavigating = true;
              try { hrefDesc.set.call(this, rewritten); } finally { _locNavigating = false; }
              reportPageInfo();
            } else {
              hrefDesc.set.call(this, value);
            }
          }
        });
      }
      var nativeAssign = locProto.assign;
      if (typeof nativeAssign === 'function') {
        locProto.assign = function (url) {
          return nativeAssign.call(this, rewrite(String(url)));
        };
      }
      var nativeReplace = locProto.replace;
      if (typeof nativeReplace === 'function') {
        locProto.replace = function (url) {
          var rewritten = rewrite(String(url));
          var result = nativeReplace.call(this, rewritten);
          reportPageInfo();
          return result;
        };
      }
    }
  } catch (e) {}

  // ---- 表单提交拦截 ----
  try {
    var formSubmit = window.HTMLFormElement && window.HTMLFormElement.prototype.submit;
    if (typeof formSubmit === 'function') {
      window.HTMLFormElement.prototype.submit = function () {
        try {
          var action = this.getAttribute('action');
          if (action && !isBypass(action)) {
            var rewritten = rewrite(action);
            if (rewritten !== action) this.setAttribute('action', rewritten);
          }
        } catch (e) {}
        return formSubmit.call(this);
      };
    }
  } catch (e) {}

  // ---- 链接跳转拦截：所有外链通过代理打开 ----
  try {
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el.tagName !== 'A') el = el.parentElement;
      if (!el) return;
      var href = el.getAttribute('href');
      var tgt = el.getAttribute('target');
      if (!href || isBypass(href)) return;
      // 已经是代理 URL 的不处理
      if (href.indexOf(PROXY_BASE + '/') === 0) return;
      var rewritten = rewrite(href);
      if (!rewritten || rewritten === href) return;
      e.preventDefault();
      if (tgt === '_blank' || tgt === '_new') {
        window.open(rewritten, '_blank');
      } else {
        // 同 iframe 内导航：改写为代理 URL 后跳转
        window.location.href = rewritten;
      }
    }, true);
  } catch (e) {}

  window.__PROXY_HOOK__ = {
    base: PROXY_BASE,
    page: PAGE,
    rewrite: rewrite,
    unrewrite: unrewrite
  };
})();
