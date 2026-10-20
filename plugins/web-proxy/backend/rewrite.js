// backend/rewrite.js
// 网页代理的内容重写模块：把目标站点 HTML/CSS/JS 中的资源与链接
// 全部改写为经代理转发的 URL，并注入客户端 hook 脚本。
//
// 代理 URL 形态：http://<proxy-host>:<port>/<scheme>/<host>/<path>?<query>
//   <scheme> 为 http 或 https，<host> 含端口（非默认端口时）
//
// 代码风格遵循 ClassIntra 约定：var / function / 单引号 / 2 空格缩进。

var fs = require('fs');
var path = require('path');
var URL = require('url').URL;

// ---- 资源 URL 判定 ----

// 不可代理的协议或片段
function isNonProxyable(u) {
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
  return false;
}

// 真实绝对 URL 转代理 URL；非 http(s) 返回 null
function toProxyUrl(realUrl, proxyBase) {
  if (!realUrl || typeof realUrl !== 'string') return null;
  if (proxyBase && realUrl.indexOf(proxyBase + '/') === 0) return realUrl;
  var parsed;
  try {
    parsed = new URL(realUrl);
  } catch (e) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  var scheme = parsed.protocol === 'https:' ? 'https' : 'http';
  var host = parsed.host;
  var pathname = parsed.pathname || '/';
  var out = proxyBase + '/' + scheme + '/' + host + pathname;
  if (parsed.search) out += parsed.search;
  if (parsed.hash) out += parsed.hash;
  return out;
}

// 以页面真实 URL 为基准解析相对路径
function resolveAgainst(u, realUrl) {
  if (!realUrl) return u;
  try {
    return new URL(u, realUrl).href;
  } catch (e) {
    return u;
  }
}

// 把页面里的任意 URL 引用（绝对/协议相对/根相对/相对）统一转代理 URL
// 转不了时返回 null，调用方保留原值
function rewriteUrlRef(u, ctx) {
  if (isNonProxyable(u)) return null;
  var trimmed = String(u).trim();
  if (!trimmed) return null;
  var absolute = trimmed;
  if (trimmed.indexOf('//') === 0) {
    absolute = (ctx.scheme || 'https') + ':' + trimmed;
  } else if (trimmed.charAt(0) !== '/') {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      absolute = resolveAgainst(trimmed, ctx.realUrl);
    }
  } else {
    absolute = resolveAgainst(trimmed, ctx.realUrl);
  }
  var proxied = toProxyUrl(absolute, ctx.proxyBase);
  if (!proxied) return null;
  if (proxied === u) return null;
  return proxied;
}

// ---- HTML 属性重写 ----

var REWRITABLE_ATTRS = {
  href: true,
  src: true,
  action: true,
  'data-src': true,
  'data-href': true,
  poster: true,
  background: true,
  srcset: true,
  content: true,
  formaction: true,
  srcdoc: true,
  data: true,
  codebase: true,
  icon: true,
  manifest: true,
  'xlink:href': true
};

// 匹配带引号和不带引号的属性值
var ATTR_RE = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function rewriteAttrs(html, ctx) {
  return html.replace(ATTR_RE, function (match, name, dq, sq, bare) {
    var lower = String(name).toLowerCase();
    if (!REWRITABLE_ATTRS[lower]) return match;
    var value = dq || sq || bare || '';
    var quote = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
    if (!value || value.length < 3) return match;
    if (lower === 'content') {
      // meta content 只处理绝对 http(s) URL（og:image 等）
      if (!/^https?:\/\//i.test(value)) return match;
    }
    if (lower === 'srcdoc') {
      // iframe srcdoc 包含 HTML，需要递归重写
      var inner = rewriteHtml(value, ctx);
      return name + '=' + quote + inner + quote;
    }
    if (lower === 'srcset') {
      var parts = value.split(',');
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (!part) continue;
        var idx = part.lastIndexOf(' ');
        var urlish = idx > 0 ? part.substring(0, idx).trim() : part;
        var desc = idx > 0 ? part.substring(idx) : '';
        var next = rewriteUrlRef(urlish, ctx);
        out.push((next || urlish) + desc);
      }
      return name + '=' + quote + out.join(', ') + quote;
    }
    var proxied = rewriteUrlRef(value, ctx);
    if (!proxied) return match;
    return name + '=' + quote + proxied + quote;
  });
}

// ---- 内联 style 中的 url() ----

var STYLE_ATTR_RE = /style\s*=\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\s>]+))/gi;
var CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function rewriteInlineStyles(html, ctx) {
  return html.replace(STYLE_ATTR_RE, function (match, dq, sq, bare) {
    var body = dq || sq || bare || '';
    var quote = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
    if (!body) return match;
    var next = body.replace(CSS_URL_RE, function (m, q, u) {
      var proxied = rewriteUrlRef(u, ctx);
      if (!proxied) return m;
      return 'url(' + proxied + ')';
    });
    if (next === body) return match;
    return 'style=' + quote + next + quote;
  });
}

// ---- 内联 <style> 块中的 url()/@import ----
// 此前只改写了「style 属性」与外部 CSS 文件，页面内联 <style> 块未被处理：
// 其中的根相对路径会绕过代理落到代理根而 404，深层页面的相对路径也会因
// <base> 基准不同而解析错误，导致背景图等资源缺失（表现为「代理不完全」）。

var STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;

function rewriteStyleBlocks(html, ctx) {
  return html.replace(STYLE_BLOCK_RE, function (match, open, body, close) {
    if (!body || (body.indexOf('url(') < 0 && body.indexOf('@import') < 0)) return match;
    var next = rewriteCss(body, ctx);
    if (next === body) return match;
    return open + next + close;
  });
}

// ---- <base href> 重写 ----
// 目标站点若带 <base>，相对路径会以它为基准解析；必须同步改写成代理 URL，
// 否则相对资源会落到代理根路径而解析失败。

var BASE_RE = /<base\b([^>]*)>/gi;

function rewriteBaseTag(html, ctx) {
  return html.replace(BASE_RE, function (match, attrs) {
    var hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (!hrefMatch) return match;
    var value = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '';
    var quote = hrefMatch[1] !== undefined ? '"' : (hrefMatch[2] !== undefined ? "'" : '');
    var proxied = rewriteUrlRef(value, ctx);
    if (!proxied) return match;
    var next = attrs.replace(/href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, 'href=' + quote + proxied + quote);
    return '<base' + next + '>';
  });
}

// ---- meta 标签处理 ----
// 1. <meta http-equiv="refresh" content="0;url=..."> - 重写 URL
// 2. <meta http-equiv="Content-Security-Policy" content="..."> - 剥离
// 3. <meta http-equiv="X-Frame-Options" content="..."> - 剥离

var META_RE = /<meta\b([^>]*)\s*\/?>/gi;

function rewriteMetaTags(html, ctx) {
  return html.replace(META_RE, function (match, attrs) {
    var equivMatch = /http-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (!equivMatch) return match;
    var equiv = (equivMatch[1] || equivMatch[2] || equivMatch[3] || '').toLowerCase();

    // 剥离 CSP meta 标签
    if (equiv === 'content-security-policy' || equiv === 'x-frame-options' ||
        equiv === 'content-security-policy-report-only') {
      return '';
    }

    // 重写 refresh meta 标签中的 URL
    if (equiv === 'refresh') {
      var contentMatch = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      if (!contentMatch) return match;
      var content = contentMatch[1] || contentMatch[2] || contentMatch[3] || '';
      var quote = contentMatch[1] !== undefined ? '"' : (contentMatch[2] !== undefined ? "'" : '');
      // 解析 content="seconds;url=URL" 或 "seconds; URL=URL"
      var urlMatch = /url\s*=\s*(.+)$/i.exec(content);
      if (!urlMatch) return match;
      var url = urlMatch[1].trim();
      var proxied = rewriteUrlRef(url, ctx);
      if (!proxied) return match;
      var newContent = content.replace(/url\s*=\s*.+$/i, 'url=' + proxied);
      var nextAttrs = attrs.replace(/content\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, 'content=' + quote + newContent + quote);
      return '<meta' + nextAttrs + '>';
    }

    return match;
  });
}

// ---- 内联脚本中的 URL 字符串 ----
// 处理 "https://..." 和 "/path"（根相对）形态的字符串字面量，尽量不触碰业务逻辑。
// 根相对 URL 必须重写：<base> 标签不影响根相对路径（HTML 规范），
// 动态 import("/_astro/xxx.js") 会直接解析为 http://host:port/_astro/xxx.js 而绕过代理路径。

var SCRIPT_BODY_RE = /(<script\b[^>]*>)([\s\S]*?)(<\/script)/gi;
var ABS_STRING_RE = /(["'])(https?:\/\/[^"']+)\1/g;
// 根相对URL：以 / 开头但不是 //（协议相对URL），且第二个字符不是 / 也不是空白
var ROOT_REL_STRING_RE = /(["'])(\/[^'"\s\/][^"']*)\1/g;

function rewriteUrlStringInCode(m, quote, u, ctx) {
  if (u.indexOf(ctx.proxyBase) === 0) return m;
  var proxied = rewriteUrlRef(u, ctx);
  if (!proxied) return m;
  return quote + proxied + quote;
}

function rewriteInlineScripts(html, ctx) {
  return html.replace(SCRIPT_BODY_RE, function (match, open, body, close) {
    if (open.indexOf('data-proxy-hook') >= 0) return match;
    if (!body || (body.indexOf('http') < 0 && body.indexOf('/') < 0)) return match;
    var next = body.replace(ABS_STRING_RE, function (m, quote, u) {
      return rewriteUrlStringInCode(m, quote, u, ctx);
    });
    // 根相对URL仅在ctx.realUrl可用时重写（需要解析基准）
    if (ctx.realUrl) {
      next = next.replace(ROOT_REL_STRING_RE, function (m, quote, u) {
        return rewriteUrlStringInCode(m, quote, u, ctx);
      });
    }
    if (next === body) return match;
    return open + next + close;
  });
}

// ---- CSS 重写 ----

function rewriteCss(css, ctx) {
  if (!css) return css;
  var next = css.replace(CSS_URL_RE, function (m, q, u) {
    var proxied = rewriteUrlRef(u, ctx);
    if (!proxied) return m;
    return 'url(' + proxied + ')';
  });
  // image-set(url(...) ...) 形式
  next = next.replace(/image-set\s*\(\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
    var proxied = rewriteUrlRef(u, ctx);
    if (!proxied) return m;
    return 'image-set(url(' + proxied + ')';
  });
  // @import url(...) 形式已由上面的 url() 处理覆盖
  return next;
}

// ---- JS 重写 ----
// 处理 webpack publicPath、绝对 URL 和根相对 URL 字符串。
// 外部 JS 文件中的 URL 必须全部重写，否则浏览器会直接请求原始域名（CORS 失败）。

var WEBPACK_PUBLIC_PATH_RE = /(__webpack_require__\s*\.\s*p\s*=|__webpack_public_path__\s*=\s*)(["'])((?:https?:\/\/|\/[^'"\s\/])[^"']*)\2/gi;

function rewriteJs(js, ctx) {
  if (!js || (js.indexOf('http') < 0 && js.indexOf('/') < 0)) return js;
  var next = js.replace(WEBPACK_PUBLIC_PATH_RE, function (m, assign, quote, u) {
    if (u.indexOf(ctx.proxyBase) === 0) return m;
    var proxied = rewriteUrlRef(u, ctx);
    if (!proxied) return m;
    return assign + quote + proxied + quote;
  });
  // 绝对 URL 字符串
  next = next.replace(ABS_STRING_RE, function (m, quote, u) {
    return rewriteUrlStringInCode(m, quote, u, ctx);
  });
  // 根相对 URL 字符串（仅在 ctx.realUrl 可用时）
  if (ctx.realUrl) {
    next = next.replace(ROOT_REL_STRING_RE, function (m, quote, u) {
      return rewriteUrlStringInCode(m, quote, u, ctx);
    });
  }
  return next;
}

// ---- 重定向 Location 重写 ----

function rewriteLocation(location, realUrl, ctx) {
  if (!location) return location;
  if (ctx.proxyBase && location.indexOf(ctx.proxyBase + '/') === 0) return location;
  var absolute = location;
  if (/^https?:\/\//i.test(location)) {
    absolute = location;
  } else if (location.indexOf('//') === 0) {
    absolute = (ctx.scheme || 'https') + ':' + location;
  } else {
    absolute = resolveAgainst(location, realUrl);
  }
  var proxied = toProxyUrl(absolute, ctx.proxyBase);
  return proxied || location;
}

// ---- 注入客户端 hook ----

var _hookSource = null;

function loadHookSource() {
  if (_hookSource !== null) return _hookSource;
  try {
    _hookSource = fs.readFileSync(path.join(__dirname, 'hook.js'), 'utf8');
  } catch (e) {
    _hookSource = '';
  }
  return _hookSource;
}

function injectHook(html, ctx) {
  var hook = loadHookSource();
  if (!hook) return html;
  var snippet = '<script data-proxy-hook="true">' +
    'window.__PROXY_BASE__="' + ctx.proxyBase + '";' +
    'window.__PROXY_TOKEN__="";' +
    hook +
    '</script>';
  // 注入 <base> 标签，使相对 URL（含动态 import()）按代理路径解析
  var baseHref = ctx.proxyBase + '/' + ctx.scheme + '/' + ctx.host + '/';
  var baseTag = '<base href="' + baseHref + '">';
  var headMatch = /<head\b[^>]*>/i.exec(html);
  if (headMatch) {
    var at = headMatch.index + headMatch[0].length;
    // 检查是否已有 <base> 标签，有则重写，无则注入
    var existingBase = /<base\b[^>]*>/i.exec(html);
    if (!existingBase) {
      return html.substring(0, at) + baseTag + snippet + html.substring(at);
    }
    return html.substring(0, at) + snippet + html.substring(at);
  }
  var htmlMatch = /<html\b[^>]*>/i.exec(html);
  if (htmlMatch) {
    var at2 = htmlMatch.index + htmlMatch[0].length;
    return html.substring(0, at2) + '<head>' + baseTag + snippet + '</head>' + html.substring(at2);
  }
  return baseTag + snippet + html;
}

// ---- SRI / crossorigin 清理 ----
// 资源地址被改写后，页面内容与原始站点已不是「同一份字节」，
// 浏览器按 integrity 校验必然失败并把脚本/样式直接拦掉（表现为整页白屏或功能缺失）；
// 而代理后所有资源同源，crossorigin 也失去意义。故统一清除这两个属性。
var SRI_ATTR_RE = /\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
var CROSSORIGIN_ATTR_RE = /\s+crossorigin(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s>\/])/gi;

function stripSecurityAttrs(html) {
  return String(html).replace(SRI_ATTR_RE, '').replace(CROSSORIGIN_ATTR_RE, '');
}

// ---- 对外入口 ----

function rewriteHtml(html, ctx) {
  var out = stripSecurityAttrs(html);
  out = rewriteAttrs(out, ctx);
  out = rewriteInlineStyles(out, ctx);
  out = rewriteStyleBlocks(out, ctx);
  out = rewriteBaseTag(out, ctx);
  out = rewriteMetaTags(out, ctx);
  out = rewriteInlineScripts(out, ctx);
  out = injectHook(out, ctx);
  return out;
}

module.exports = {
  isNonProxyable: isNonProxyable,
  toProxyUrl: toProxyUrl,
  rewriteUrlRef: rewriteUrlRef,
  rewriteHtml: rewriteHtml,
  rewriteCss: rewriteCss,
  rewriteJs: rewriteJs,
  rewriteLocation: rewriteLocation
};
