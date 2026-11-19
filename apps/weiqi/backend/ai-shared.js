/*
 * 围棋 —— AI 查询与整盘复盘的共用逻辑
 *
 * 这里放「不属于 HTTP 路由」的三件事：
 *   1. 把前端的复盘/分析请求校验并构造成 KataGo analysis JSON 行协议；
 *   2. 把 KataGo 的原始响应转换成前端要的形状；
 *   3. 逐手评级（本手 / 俗手 / 妙手 / 失误 / 恶手）。
 *
 * ⚠️ 评级只有这一份实现：整盘复盘已改为服务端后台任务，前端直接消费
 *    服务端算好的 results/summary。不要再在前端复制一份阈值，否则两处
 *    阈值一旦漂移，会出现「同一个棋谱在复盘页和后台结果里评级不同」。
 */
'use strict';

var path = require('path');
var Core = require(path.join(__dirname, '..', 'core', 'go-core.js'));

var ALLOWED_SIZES = [9, 13, 19];
var ALLOWED_HANDICAPS = [0, 2, 3, 4, 5, 6, 7, 8, 9];
var DEFAULT_KOMI = 7.5;

var GTP_LETTERS = 'ABCDEFGHJKLMNOPQRST';

function aiBudget(level, purpose) {
  var l = Number(level);
  if (!isFinite(l) || l < 1) l = 2;
  if (l > 3) l = 3;
  // 复盘整盘要逐手分析，预算压低靠数量换覆盖面。
  // 这台服务器是 Intel UHD 730 核显，b18 每 visit 约 70ms：
  // 16 visits ≈ 1.15s/手。8 visits 只要 0.66s，但只产生 3~4 个候选，
  // 实战着法几乎永远不在候选里，评级只能退化成「相邻局面胜率差」，
  // 噪声大到会把好棋判成恶手——这才是「评手不准」的根因。
  // 16 visits 候选 6~9 个，实战着法覆盖率明显提升，评级才站得住。
  if (purpose === 'review') {
    return { visits: 16, time: 1.2, level: 2 };
  }
  // 对局应手走快速预算，单项分析和整盘复盘走更深的预算，但模型一致。
  var visits = l === 1 ? 24 : l === 2 ? 56 : 120;
  var time = l === 1 ? 1.8 : l === 2 ? 3.3 : 7.0;
  if (purpose === 'analyze') {
    visits = l === 1 ? 32 : l === 2 ? 56 : 100;
    time = l === 1 ? 2.2 : l === 2 ? 3.5 : 6.0;
  }
  return { visits: visits, time: time, level: l };
}

function gtpPoint(size, row, col) {
  return GTP_LETTERS.charAt(col) + String(size - row);
}

function parseGtpPoint(size, value) {
  if (!value || value === 'pass' || value === 'resign') return null;
  var text = String(value).toUpperCase();
  var col = GTP_LETTERS.indexOf(text.charAt(0));
  var rowNum = parseInt(text.slice(1), 10);
  if (col < 0 || !isFinite(rowNum)) return null;
  var row = size - rowNum;
  if (row < 0 || row >= size || col >= size) return null;
  return { row: row, col: col };
}

// 校验并构造一次 KataGo analysis 查询。不合法直接抛错，由调用方转成 400。
function buildAiQuery(body, purpose) {
  var input = body || {};
  var size = Number(input.size);
  if (ALLOWED_SIZES.indexOf(size) === -1) throw new Error('棋盘规格不支持');
  var komi = Number(input.komi);
  if (!isFinite(komi) || komi < 0 || komi > 100) komi = DEFAULT_KOMI;
  var handicap = Number(input.handicap);
  if (!isFinite(handicap) || ALLOWED_HANDICAPS.indexOf(handicap) === -1) handicap = 0;
  var list = Array.isArray(input.moves) ? input.moves : [];
  if (list.length > size * size * 2 + 10) throw new Error('着法数量异常');

  var state = Core.createState({
    size: size,
    komi: komi,
    handicap: handicap,
    rules: 'chinese',
    setup: Array.isArray(input.setup) ? input.setup : [],
    turn: input.turn
  });
  var gtpMoves = [];
  for (var i = 0; i < list.length; i += 1) {
    var m = list[i] || {};
    var color = m.color === Core.BLACK || m.color === 'B' || m.color === 'b' ? Core.BLACK
      : m.color === Core.WHITE || m.color === 'W' || m.color === 'w' ? Core.WHITE : null;
    if (!color) throw new Error('着法颜色异常');
    if (m.pass) {
      var pass = Core.applyPass(state, color, { ignoreTurn: true });
      if (!pass.ok) throw new Error('着法不合法：' + (pass.error || '停一手'));
      gtpMoves.push([color === Core.BLACK ? 'B' : 'W', 'pass']);
      continue;
    }
    var row = Number(m.row);
    var col = Number(m.col);
    if (!isFinite(row) || !isFinite(col) || row < 0 || col < 0 || row >= size || col >= size) {
      throw new Error('着法坐标异常');
    }
    var applied = Core.applyMove(state, color, row, col, { ignoreTurn: true });
    if (!applied.ok) throw new Error('着法不合法：' + (applied.error || ''));
    gtpMoves.push([color === Core.BLACK ? 'B' : 'W', gtpPoint(size, row, col)]);
  }

  var initialStones = [];
  if (state.setup && state.setup.length) {
    for (var s = 0; s < state.setup.length; s += 1) {
      var stone = state.setup[s];
      initialStones.push([
        stone.color === Core.BLACK ? 'B' : 'W',
        gtpPoint(size, stone.row, stone.col)
      ]);
    }
  }
  var budget = aiBudget(input.level, purpose);
  var payload = {
    moves: gtpMoves,
    rules: 'chinese',
    komi: komi,
    boardXSize: size,
    boardYSize: size,
    maxVisits: budget.visits,
    maxTime: budget.time,
    includeOwnership: false
  };
  if (initialStones.length) {
    payload.initialStones = initialStones;
    payload.initialPlayer = state.initialTurn === Core.WHITE ? 'W' : 'B';
  }
  return { payload: payload, size: size, komi: komi, budget: budget };
}

function convertAiResult(raw, size, body) {
  var root = raw && raw.rootInfo ? raw.rootInfo : {};
  var infos = raw && Array.isArray(raw.moveInfos) ? raw.moveInfos.slice() : [];
  infos.sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
  var avoid = {};
  if (body && Array.isArray(body.avoid)) {
    for (var a = 0; a < body.avoid.length && a < 20; a += 1) {
      var av = Number(body.avoid[a]);
      if (isFinite(av)) avoid[av] = true;
    }
  }
  var picked = null;
  for (var i = 0; i < infos.length; i += 1) {
    var pm = parseGtpPoint(size, infos[i].move);
    if (pm && avoid[pm.row * size + pm.col]) continue;
    picked = infos[i];
    break;
  }
  if (!picked && infos.length) picked = infos[0];
  var move = null;
  var pass = false;
  if (!picked || !picked.move || picked.move === 'pass') {
    pass = true;
  } else {
    var point = parseGtpPoint(size, picked.move);
    if (point) move = point;
    else pass = true;
  }
  var blackWin = isFinite(Number(root.winrate)) ? Number(root.winrate) : 0.5;
  var blackLead = isFinite(Number(root.scoreLead)) ? Number(root.scoreLead) : 0;
  var candidates = [];
  for (var c = 0; c < infos.length && candidates.length < 8; c += 1) {
    var cp = parseGtpPoint(size, infos[c].move);
    if (!cp) continue;
    candidates.push({
      row: cp.row,
      col: cp.col,
      blackWinrate: isFinite(Number(infos[c].winrate)) ? Number(infos[c].winrate) : blackWin,
      blackScoreLead: isFinite(Number(infos[c].scoreLead)) ? Number(infos[c].scoreLead) : blackLead,
      visits: isFinite(Number(infos[c].visits)) ? Number(infos[c].visits) : 0,
      gtp: infos[c].move
    });
  }
  return {
    engine: 'katago',
    move: move,
    pass: pass,
    winrate: blackWin,
    scoreLead: blackLead,
    blackWinrate: blackWin,
    blackScoreLead: blackLead,
    visits: isFinite(Number(root.visits)) ? Number(root.visits) : 0,
    candidates: candidates,
    pv: picked && Array.isArray(picked.pv) ? picked.pv.slice(0, 10) : []
  };
}

// 逐手评级。prev / curr 是相邻两个局面的分析结果（含 candidates）。
//
// ⚠️ 两套阈值，别混用（2026-11-19 修复「评手不准」）：
//   - 实战着法在候选里（有依据）：候选胜率是同一棵搜索树里的横向对比，
//     16 visits 下精度约 ±0.02，用严阈值。
//   - 不在候选里（只有局面差）：posLoss 是两棵不同搜索树的纵向差，
//     混着对手先手权与低预算噪声，实测能虚高 0.1~0.3，
//     必须用宽阈值，否则正常手会被成片误判成失误/恶手。
//   妙手依据取「最佳与次佳的差」而不是「最佳与最差的差」：
//   后者几乎恒 ≥0.08，等于「与 AI 首选一致就是妙手」。
function classifyReviewMove(index, prev, curr, move) {
  var mover = move.color;
  var posLoss = mover === Core.BLACK ? prev.blackWin - curr.blackWin : curr.blackWin - prev.blackWin;
  var bestWin = null;
  var best = null;
  var i;
  var cands = prev.candidates || [];
  for (i = 0; i < cands.length; i++) {
    var c = cands[i];
    if (!c || !isFinite(c.blackWinrate)) continue;
    var w = Number(c.blackWinrate);
    if (bestWin === null || (mover === Core.BLACK ? w > bestWin : w < bestWin)) {
      bestWin = w;
      best = c;
    }
  }
  var played = null;
  if (!move.pass) {
    for (i = 0; i < cands.length; i++) {
      var p = cands[i];
      if (Number(p.row) === move.row && Number(p.col) === move.col) { played = p; break; }
    }
  }
  var loss = posLoss;
  if (played && bestWin !== null) {
    var pw = Number(played.blackWinrate);
    var direct = mover === Core.BLACK ? bestWin - pw : pw - bestWin;
    if (isFinite(direct) && direct > -0.02) loss = direct;
  }
  if (!isFinite(loss) || loss < 0) loss = 0;
  var secondGap = 0;
  if (bestWin !== null) {
    var secondWin = null;
    for (i = 0; i < cands.length; i++) {
      var w2 = Number(cands[i].blackWinrate);
      if (!isFinite(w2) || w2 === bestWin) continue;
      if (secondWin === null || (mover === Core.BLACK ? w2 > secondWin : w2 < secondWin)) secondWin = w2;
    }
    if (secondWin !== null) secondGap = Math.abs(bestWin - secondWin);
  }
  var isBest = !!(played && bestWin !== null && Math.abs(Number(played.blackWinrate) - bestWin) < 0.005);
  var hasEvidence = !!played;
  var grade;
  if (isBest && secondGap >= 0.06 && loss <= 0.015) grade = 'brilliant';
  else if (hasEvidence) {
    if (loss <= 0.025) grade = 'proper';
    else if (loss <= 0.06) grade = 'vulgar';
    else if (loss <= 0.15) grade = 'mistake';
    else grade = 'blunder';
  } else {
    if (loss <= 0.05) grade = 'proper';
    else if (loss <= 0.12) grade = 'vulgar';
    else if (loss <= 0.25) grade = 'mistake';
    else grade = 'blunder';
  }
  return {
    index: index,
    color: mover,
    row: move.row,
    col: move.col,
    pass: !!move.pass,
    grade: grade,
    loss: loss,
    bestRow: best ? Number(best.row) : null,
    bestCol: best ? Number(best.col) : null,
    bestWin: bestWin,
    playedWin: played ? Number(played.blackWinrate) : null
  };
}

function emptySummary() {
  return { brilliant: 0, proper: 0, vulgar: 0, mistake: 0, blunder: 0 };
}

module.exports = {
  ALLOWED_SIZES: ALLOWED_SIZES,
  ALLOWED_HANDICAPS: ALLOWED_HANDICAPS,
  DEFAULT_KOMI: DEFAULT_KOMI,
  GTP_LETTERS: GTP_LETTERS,
  aiBudget: aiBudget,
  gtpPoint: gtpPoint,
  parseGtpPoint: parseGtpPoint,
  buildAiQuery: buildAiQuery,
  convertAiResult: convertAiResult,
  classifyReviewMove: classifyReviewMove,
  emptySummary: emptySummary
};
