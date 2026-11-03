// 财经资讯：东方财富公开接口（与行情同源，校园网络可达）
//   · 7×24 市场快讯：np-listapi.eastmoney.com/comm/web/getNewsByColumns
//   · 个股相关资讯：search-api-web.eastmoney.com/search/jsonp（JSONP，剥掉回调）
// 全部走内存缓存：快讯 2 分钟、个股 5 分钟。资讯是增强功能，
// 上游挂掉时返回空列表而不是抛错 —— 不能因为看不了新闻就让行情页报错。
var https = require('https');

var TIMEOUT = 8000;
var TTL_FAST = 120 * 1000;
var TTL_STOCK = 5 * 60 * 1000;
var CACHE = {};   // key -> { at, data }

function httpsGetRaw(host, path, referer) {
  return new Promise(function (resolve, reject) {
    var req = https.request({
      hostname: host,
      path: path,
      method: 'GET',
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClassIntra-Stock/1.0',
        'Referer': referer || 'https://finance.eastmoney.com/',
        'Accept': '*/*'
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        if (res.statusCode !== 200) return reject(new Error('资讯源返回 ' + res.statusCode));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('timeout', function () { req.destroy(); reject(new Error('资讯请求超时')); });
    req.on('error', reject);
    req.end();
  });
}

function clean(text, max) {
  var s = String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && s.length > max) s = s.slice(0, max) + '…';
  return s;
}

// 标题里常见「【…】」包装，去掉更清爽
function cleanTitle(t) {
  return clean(t).replace(/^【\s*/, '').replace(/\s*】$/, '');
}

function cached(key, ttl, loader) {
  var c = CACHE[key];
  if (c && Date.now() - c.at < ttl) return Promise.resolve(c.data);
  return loader().then(function (data) {
    CACHE[key] = { at: Date.now(), data: data };
    return data;
  });
}

// ---- 7×24 市场快讯 ----
function fastNews(limit) {
  var n = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);
  return cached('fast:' + n, TTL_FAST, function () {
    var path = '/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=345&order=1' +
      '&needInteractData=0&page_index=1&page_size=' + n + '&req_trace=' + Date.now();
    return httpsGetRaw('np-listapi.eastmoney.com', path).then(function (txt) {
      var j = JSON.parse(txt);
      var list = ((j.data && j.data.list) || []).map(function (x) {
        return {
          id: String(x.code || ''),
          title: cleanTitle(x.title || x.summary),
          summary: clean(x.summary, 400),
          source: x.mediaName || '东方财富',
          time: x.showTime || '',
          url: x.uniqueUrl || x.url || ''
        };
      });
      return list.filter(function (x) { return x.title; });
    });
  });
}

// ---- 个股相关资讯（按名称搜，代码搜不到就用代码）----
function stockNews(code, name, limit) {
  var n = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 12);
  var key = 'stock:' + code + ':' + n;
  return cached(key, TTL_STOCK, function () {
    var keyword = name || code;
    var param = JSON.stringify({
      uid: '',
      keyword: keyword,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'default',
          pageIndex: 1,
          pageSize: n,
          preTag: '',
          postTag: ''
        }
      }
    });
    var path = '/search/jsonp?cb=cb&param=' + encodeURIComponent(param);
    return httpsGetRaw('search-api-web.eastmoney.com', path).then(function (txt) {
      var json = txt.replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
      var j = JSON.parse(json);
      var arr = (j.result && j.result.cmsArticleWebOld) || [];
      return arr.map(function (x) {
        return {
          id: String(x.code || ''),
          title: cleanTitle(x.title),
          summary: clean(x.content, 800),
          source: x.mediaName || '东方财富',
          time: x.date || '',
          url: x.url || ''
        };
      }).filter(function (x) { return x.title; });
    });
  });
}

module.exports = {
  fastNews: fastNews,
  stockNews: stockNews
};
