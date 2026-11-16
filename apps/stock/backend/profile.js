// 公司概况（F10 摘要）：行业 / 上市日期 / 总市值 / 流通市值 / PE / PB
// 数据源同行情：东财 push2 主源；本机校园网封东财 HTTPS（socket hang up），
// 此时退回腾讯 qt.gtimg（明文 HTTP）取估值四项 —— 行业/上市日期腾讯没有，留空显示「—」。
// 只做「概况」不做财报：教学目的是让学生下单前知道自己在买什么行业、市值多大、估值贵不贵。
var https = require('https');
var http = require('http');

var TIMEOUT = 8000;
var TTL = 10 * 60 * 1000;
var CACHE = {};

function httpsGetJson(host, path) {
  return new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: host,
      path: path,
      method: 'GET',
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClassIntra-Stock/1.0',
        'Referer': 'https://quote.eastmoney.com/'
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error('F10 源返回 ' + res.statusCode));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('F10 源返回了非 JSON')); }
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('F10 请求超时')); });
    req.on('error', reject);
    req.end();
  });
}

function secid(code) {
  var c = String(code || '').replace(/\D/g, '');
  var sh = c.charAt(0) === '6' || c.indexOf('9') === 0;
  return (sh ? '1.' : '0.') + c;
}

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function listDate(v) {
  // 19960312 -> 1996-03-12
  var s = String(v || '');
  if (s.length !== 8) return '';
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

function getProfileEastmoney(c) {
  var path = '/api/qt/stock/get?secid=' + secid(c) +
    '&fields=f57,f58,f84,f85,f116,f117,f127,f162,f167,f189';
  return httpsGetJson('push2.eastmoney.com', path).then(function (j) {
    var d = (j && j.data) || {};
    return {
      code: String(d.f57 || c),
      name: String(d.f58 || ''),
      industry: String(d.f127 || ''),
      list_date: listDate(d.f189),
      total_mv: num(d.f116),        // 元
      float_mv: num(d.f117),        // 元
      total_shares: num(d.f84),
      float_shares: num(d.f85),
      // 东财这两个字段是 ×100 的整数
      pe: d.f162 ? num(d.f162) / 100 : 0,
      pb: d.f167 ? num(d.f167) / 100 : 0,
      source: 'eastmoney'
    };
  });
}

// 腾讯 qt.gtimg（明文 HTTP）：44 流通市值(亿) / 45 总市值(亿) / 39 PE / 46 PB。
// 名称是 GBK —— Node 自带 full-icu 时 TextDecoder('gbk') 可用，否则按 latin1 读结构。
function getProfileTencent(c) {
  var symbol = (c.charAt(0) === '6' || c.indexOf('9') === 0 ? 'sh' : 'sz') + c;
  return new Promise(function (resolve, reject) {
    var req = http.request({
      hostname: 'qt.gtimg.cn',
      path: '/q=' + symbol,
      method: 'GET',
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClassIntra-Stock/1.0',
        'Referer': 'http://gu.qq.com/'
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error('备用 F10 源返回 ' + res.statusCode));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('备用 F10 请求超时')); });
    req.on('error', function (e) { reject(new Error('备用 F10 请求失败: ' + e.message)); });
    req.end();
  }).then(function (buf) {
    var txt;
    try { txt = new TextDecoder('gbk').decode(buf); }
    catch (e) { txt = buf.toString('latin1'); }
    var m = txt.match(/v_(?:sh|sz)\d{6}="([^"]*)"/);
    var f = m ? m[1].split('~') : [];
    if (f.length < 47) throw new Error('备用 F10 源没有返回数据');
    if (!num(f[3], 0)) throw new Error('备用 F10 源数据不完整');
    return {
      code: String(f[2] || c),
      name: String(f[1] || ''),
      industry: '',      // 腾讯行情不提供行业/上市日期
      list_date: '',
      total_mv: num(f[45], 0) * 1e8,
      float_mv: num(f[44], 0) * 1e8,
      total_shares: 0,
      float_shares: 0,
      pe: num(f[39], 0),
      pb: num(f[46], 0),
      source: 'tencent'
    };
  });
}

function getProfile(code) {
  var c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return Promise.reject(new Error('代码不合法'));
  var hit = CACHE[c];
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);

  return getProfileEastmoney(c).catch(function () {
    return getProfileTencent(c);
  }).then(function (data) {
    CACHE[c] = { at: Date.now(), data: data };
    return data;
  });
}

module.exports = { getProfile: getProfile };
