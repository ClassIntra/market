// 公司概况（F10 摘要）：行业 / 上市日期 / 总市值 / 流通市值 / PE / PB
// 数据源与行情同源（push2.eastmoney.com/api/qt/stock/get），缓存 10 分钟。
// 只做「概况」不做财报：教学目的是让学生下单前知道自己在买什么行业、市值多大、估值贵不贵。
var https = require('https');

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

function getProfile(code) {
  var c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return Promise.reject(new Error('代码不合法'));
  var hit = CACHE[c];
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);

  var path = '/api/qt/stock/get?secid=' + secid(c) +
    '&fields=f57,f58,f84,f85,f116,f117,f127,f162,f167,f189';
  return httpsGetJson('push2.eastmoney.com', path).then(function (j) {
    var d = (j && j.data) || {};
    var data = {
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
      pb: d.f167 ? num(d.f167) / 100 : 0
    };
    CACHE[c] = { at: Date.now(), data: data };
    return data;
  });
}

module.exports = { getProfile: getProfile };
