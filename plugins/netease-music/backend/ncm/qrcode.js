// 内置二维码编码器（字节模式，纠错等级 L/M/Q/H，版本 1-10）
// 用于离线 / 内网环境生成网易云扫码登录二维码，避免引入 qrcode 等第三方依赖。
// 算法依据 ISO/IEC 18004，输出 { size, modules }，modules[row][col] 为 0 / 1。

// 各版本纠错分块表：[每块纠错码字数, [[块数, 每块数据码字数], ...]]，版本 1-10
var EC_BLOCKS = {
  L: {
    1: [7, [[1, 19]]], 2: [10, [[1, 34]]], 3: [15, [[1, 55]]], 4: [20, [[1, 80]]], 5: [26, [[1, 108]]],
    6: [18, [[2, 68]]], 7: [20, [[2, 78]]], 8: [24, [[2, 97]]], 9: [30, [[2, 116]]], 10: [18, [[2, 68], [2, 69]]]
  },
  M: {
    1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
    6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]]
  },
  Q: {
    1: [13, [[1, 13]]], 2: [22, [[1, 22]]], 3: [18, [[2, 17]]], 4: [26, [[2, 24]]], 5: [18, [[2, 15], [2, 16]]],
    6: [24, [[4, 19]]], 7: [18, [[2, 14], [4, 15]]], 8: [22, [[4, 18], [2, 19]]], 9: [20, [[4, 16], [4, 17]]],
    10: [24, [[6, 19], [2, 20]]]
  },
  H: {
    1: [17, [[1, 9]]], 2: [28, [[1, 16]]], 3: [22, [[2, 13]]], 4: [16, [[4, 9]]], 5: [22, [[2, 11], [2, 12]]],
    6: [28, [[4, 15]]], 7: [26, [[4, 13], [1, 14]]], 8: [26, [[4, 14], [2, 15]]], 9: [24, [[4, 12], [4, 13]]],
    10: [28, [[6, 15], [2, 16]]]
  }
};

// 校正图案中心坐标
var ALIGN_POS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

var ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// GF(256) 对数 / 反对数表
var GF_EXP = new Array(512);
var GF_LOG = new Array(256);
(function () {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// 生成多项式（次数 = 纠错码字数）
function rsGeneratorPoly(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    var next = new Array(poly.length + 1);
    for (var k = 0; k < next.length; k++) next[k] = 0;
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// 计算单块纠错码字
function rsEncode(dataCodewords, ecCount) {
  var generator = rsGeneratorPoly(ecCount);
  var result = new Array(ecCount);
  for (var i = 0; i < ecCount; i++) result[i] = 0;
  for (var d = 0; d < dataCodewords.length; d++) {
    var factor = dataCodewords[d] ^ result[0];
    result.shift();
    result.push(0);
    for (var g = 0; g < ecCount; g++) {
      result[g] ^= gfMul(generator[g + 1], factor);
    }
  }
  return result;
}

function bitLength(value) {
  var n = 0;
  while (value !== 0) {
    n++;
    value >>>= 1;
  }
  return n;
}

// 格式信息（15 位，BCH 校验 + 固定掩码）
function formatInfoBits(level, mask) {
  var data = (ECC_FORMAT_BITS[level] << 3) | mask;
  var d = data << 10;
  while (bitLength(d) - bitLength(0x537) >= 0) {
    d ^= 0x537 << (bitLength(d) - bitLength(0x537));
  }
  return ((data << 10) | d) ^ 0x5412;
}

// 版本信息（18 位，仅版本 7 及以上需要）
function versionInfoBits(version) {
  var d = version << 12;
  while (bitLength(d) - bitLength(0x1f25) >= 0) {
    d ^= 0x1f25 << (bitLength(d) - bitLength(0x1f25));
  }
  return (version << 12) | d;
}

function totalDataCodewords(version, level) {
  var spec = EC_BLOCKS[level][version];
  var total = 0;
  for (var i = 0; i < spec[1].length; i++) total += spec[1][i][0] * spec[1][i][1];
  return total;
}

function charCountBits(version) {
  return version < 10 ? 8 : 16;
}

// 选择最小可用版本（返回 null 表示内容过长）
function chooseVersion(byteLength, level) {
  for (var version = 1; version <= 10; version++) {
    var capacity = totalDataCodewords(version, level) * 8;
    var needed = 4 + charCountBits(version) + byteLength * 8;
    if (capacity >= needed) return version;
  }
  return null;
}

// 数据编码（字节模式）+ 纠错 + 交织，返回最终码字序列
function buildCodewords(text, version, level) {
  var bytes = Buffer.from(text, 'utf8');
  var capacity = totalDataCodewords(version, level);
  var bits = [];
  function push(value, length) {
    for (var i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }
  push(4, 4); // 字节模式指示符 0100
  push(bytes.length, charCountBits(version));
  for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
  // 终止符 + 补齐字节
  var maxBits = capacity * 8;
  var terminator = Math.min(4, maxBits - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  var dataCodewords = [];
  for (var b = 0; b < bits.length; b += 8) {
    var byteVal = 0;
    for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bits[b + k];
    dataCodewords.push(byteVal);
  }
  // 交替填充 0xEC / 0x11
  var padBytes = [0xec, 0x11];
  var padIndex = 0;
  while (dataCodewords.length < capacity) {
    dataCodewords.push(padBytes[padIndex % 2]);
    padIndex++;
  }

  // 分块计算纠错
  var spec = EC_BLOCKS[level][version];
  var ecCount = spec[0];
  var blocks = [];
  var pos = 0;
  for (var s = 0; s < spec[1].length; s++) {
    var blockCount = spec[1][s][0];
    var dataLen = spec[1][s][1];
    for (var n = 0; n < blockCount; n++) {
      var chunk = dataCodewords.slice(pos, pos + dataLen);
      pos += dataLen;
      blocks.push({ data: chunk, ec: rsEncode(chunk, ecCount) });
    }
  }

  // 交织
  var result = [];
  var maxDataLen = 0;
  for (var m = 0; m < blocks.length; m++) maxDataLen = Math.max(maxDataLen, blocks[m].data.length);
  for (var d = 0; d < maxDataLen; d++) {
    for (var q = 0; q < blocks.length; q++) {
      if (d < blocks[q].data.length) result.push(blocks[q].data[d]);
    }
  }
  for (var e = 0; e < ecCount; e++) {
    for (var r = 0; r < blocks.length; r++) result.push(blocks[r].ec[e]);
  }
  return result;
}

// 矩阵骨架（功能图案），同时返回保留位图
function createMatrix(version) {
  var size = version * 4 + 17;
  var modules = [];
  var reserved = [];
  for (var i = 0; i < size; i++) {
    modules.push(new Array(size).fill(0));
    reserved.push(new Array(size).fill(false));
  }

  function setFunction(row, col, value) {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = value;
    reserved[row][col] = true;
  }

  // 定位图案 + 分隔符
  var finderPositions = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (var f = 0; f < finderPositions.length; f++) {
    var baseRow = finderPositions[f][0];
    var baseCol = finderPositions[f][1];
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var row = baseRow + r;
        var col = baseCol + c;
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        var isBorder = r === -1 || r === 7 || c === -1 || c === 7;
        var inFinder = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        if (isBorder) {
          setFunction(row, col, 0);
        } else if (inFinder) {
          var isDark = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setFunction(row, col, isDark ? 1 : 0);
        }
      }
    }
  }

  // 定时图案
  for (var t = 8; t < size - 8; t++) {
    var value = t % 2 === 0 ? 1 : 0;
    setFunction(6, t, value);
    setFunction(t, 6, value);
  }

  // 校正图案
  var aligns = ALIGN_POS[version];
  for (var a = 0; a < aligns.length; a++) {
    for (var b2 = 0; b2 < aligns.length; b2++) {
      var centerRow = aligns[a];
      var centerCol = aligns[b2];
      // 跳过与定位图案重叠的位置
      if ((centerRow === 6 && centerCol === 6) || (centerRow === 6 && centerCol === size - 7) || (centerRow === size - 7 && centerCol === 6)) continue;
      for (var dr = -2; dr <= 2; dr++) {
        for (var dc = -2; dc <= 2; dc++) {
          var isDarkAlign = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunction(centerRow + dr, centerCol + dc, isDarkAlign ? 1 : 0);
        }
      }
    }
  }

  // 固定暗模块
  setFunction(size - 8, 8, 1);

  // 预留格式信息区
  for (var i2 = 0; i2 < 9; i2++) {
    if (!reserved[8][i2]) { modules[8][i2] = 0; reserved[8][i2] = true; }
    if (!reserved[i2][8]) { modules[i2][8] = 0; reserved[i2][8] = true; }
  }
  for (var j2 = size - 8; j2 < size; j2++) {
    if (!reserved[8][j2]) { modules[8][j2] = 0; reserved[8][j2] = true; }
    if (!reserved[j2][8]) { modules[j2][8] = 0; reserved[j2][8] = true; }
  }

  // 预留版本信息区（版本 7+）
  if (version >= 7) {
    for (var v = 0; v < 18; v++) {
      var vr = Math.floor(v / 3);
      var vc = v % 3 + size - 8 - 3;
      modules[vr][vc] = 0;
      reserved[vr][vc] = true;
      modules[vc][vr] = 0;
      reserved[vc][vr] = true;
    }
  }

  return { size: size, modules: modules, reserved: reserved };
}

// 数据位填充（右下角起，两列一组蛇形上升/下降）
function placeData(matrix, codewords) {
  var size = matrix.size;
  var modules = matrix.modules;
  var reserved = matrix.reserved;
  var bits = [];
  for (var i = 0; i < codewords.length; i++) {
    for (var b = 7; b >= 0; b--) bits.push((codewords[i] >>> b) & 1);
  }
  var index = 0;
  var upward = true;
  for (var col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (var n = 0; n < size; n++) {
      var row = upward ? size - 1 - n : n;
      for (var c = 0; c < 2; c++) {
        var targetCol = col - c;
        if (reserved[row][targetCol]) continue;
        modules[row][targetCol] = index < bits.length ? bits[index] : 0;
        index++;
      }
    }
    upward = !upward;
  }
}

// 掩码条件
function maskCondition(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(modules, reserved, mask) {
  var size = modules.length;
  for (var row = 0; row < size; row++) {
    for (var col = 0; col < size; col++) {
      if (reserved[row][col]) continue;
      if (maskCondition(mask, row, col)) modules[row][col] ^= 1;
    }
  }
}

// 掩码罚分（ISO/IEC 18004 §8.8.2）
function penaltyScore(modules) {
  var size = modules.length;
  var score = 0;
  var row;
  var col;

  // 规则 1：同色连续 5 个以上
  for (row = 0; row < size; row++) {
    var runColor = modules[row][0];
    var runLength = 1;
    for (col = 1; col < size; col++) {
      if (modules[row][col] === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = modules[row][col];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
  }
  for (col = 0; col < size; col++) {
    var runColorV = modules[0][col];
    var runLengthV = 1;
    for (row = 1; row < size; row++) {
      if (modules[row][col] === runColorV) {
        runLengthV++;
      } else {
        if (runLengthV >= 5) score += 3 + (runLengthV - 5);
        runColorV = modules[row][col];
        runLengthV = 1;
      }
    }
    if (runLengthV >= 5) score += 3 + (runLengthV - 5);
  }

  // 规则 2：2x2 同色块
  for (row = 0; row < size - 1; row++) {
    for (col = 0; col < size - 1; col++) {
      var v = modules[row][col];
      if (v === modules[row][col + 1] && v === modules[row + 1][col] && v === modules[row + 1][col + 1]) {
        score += 3;
      }
    }
  }

  // 规则 3：1011101 类图案
  var pattern1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  var pattern2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (row = 0; row < size; row++) {
    for (col = 0; col <= size - 11; col++) {
      var match1 = true;
      var match2 = true;
      for (var p = 0; p < 11; p++) {
        if (modules[row][col + p] !== pattern1[p]) match1 = false;
        if (modules[row][col + p] !== pattern2[p]) match2 = false;
      }
      if (match1) score += 40;
      if (match2) score += 40;
    }
  }
  for (col = 0; col < size; col++) {
    for (row = 0; row <= size - 11; row++) {
      var vMatch1 = true;
      var vMatch2 = true;
      for (var q = 0; q < 11; q++) {
        if (modules[row + q][col] !== pattern1[q]) vMatch1 = false;
        if (modules[row + q][col] !== pattern2[q]) vMatch2 = false;
      }
      if (vMatch1) score += 40;
      if (vMatch2) score += 40;
    }
  }

  // 规则 4：黑白比例偏离 50%（与参考库一致的 ceil 算法）
  var dark = 0;
  for (row = 0; row < size; row++) {
    for (col = 0; col < size; col++) {
      if (modules[row][col]) dark++;
    }
  }
  var total = size * size;
  var k = Math.abs(Math.ceil((dark * 100 / total) / 5) - 10);
  score += k * 10;
  return score;
}

// 写入格式信息（15 位），并设置固定暗模块
function placeFormatInfo(modules, level, mask) {
  var size = modules.length;
  var bits = formatInfoBits(level, mask);
  for (var i = 0; i < 15; i++) {
    var mod = ((bits >>> i) & 1) === 1 ? 1 : 0;
    // 竖向副本：列 8（第 6 行为定时图案，跳过）
    if (i < 6) {
      modules[i][8] = mod;
    } else if (i < 8) {
      modules[i + 1][8] = mod;
    } else {
      modules[size - 15 + i][8] = mod;
    }
    // 横向副本：行 8（第 6 列为定时图案，跳过）
    if (i < 8) {
      modules[8][size - i - 1] = mod;
    } else if (i < 9) {
      modules[8][15 - i] = mod;
    } else {
      modules[8][15 - i - 1] = mod;
    }
  }
  // 固定暗模块
  modules[size - 8][8] = 1;
}

// 写入版本信息（版本 7+）
function placeVersionInfo(modules, version) {
  var size = modules.length;
  if (version < 7) return;
  var bits = versionInfoBits(version);
  for (var i = 0; i < 18; i++) {
    var bit = ((bits >>> i) & 1) === 1 ? 1 : 0;
    var row = Math.floor(i / 3);
    var col = i % 3 + size - 8 - 3;
    modules[row][col] = bit;
    modules[col][row] = bit;
  }
}

// 生成二维码矩阵
// text: 文本内容；level: 'L' | 'M' | 'Q' | 'H'（默认 M）
function encode(text, level) {
  level = EC_BLOCKS[level] ? level : 'M';
  var bytes = Buffer.from(String(text), 'utf8');
  var version = chooseVersion(bytes.length, level);
  if (!version) {
    throw new Error('内容过长（' + bytes.length + ' 字节），超出内置编码器支持的二维码版本上限');
  }
  var codewords = buildCodewords(String(text), version, level);
  var matrix = createMatrix(version);
  placeData(matrix, codewords);

  var bestMask = 0;
  var bestScore = Infinity;
  for (var mask = 0; mask < 8; mask++) {
    applyMask(matrix.modules, matrix.reserved, mask);
    placeFormatInfo(matrix.modules, level, mask);
    var score = penaltyScore(matrix.modules);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(matrix.modules, matrix.reserved, mask);
  }
  applyMask(matrix.modules, matrix.reserved, bestMask);
  placeFormatInfo(matrix.modules, level, bestMask);
  placeVersionInfo(matrix.modules, version);

  return { size: matrix.size, version: version, mask: bestMask, modules: matrix.modules };
}

// 转为紧凑字符串（每行 0/1），便于网络传输
function toRows(qr) {
  var rows = [];
  for (var i = 0; i < qr.size; i++) rows.push(qr.modules[i].join(''));
  return rows;
}

module.exports = { encode: encode, toRows: toRows };