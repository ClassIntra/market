var express = require('express');
var router = express.Router();

var SIZE = 15;
var rooms = Object.create(null);

function newState() {
  return {
    board: Array.from({ length: SIZE }, function() {
      return Array(SIZE).fill(null);
    }),
    turn: 'black',
    winner: null
  };
}

function roomKey(req) {
  return String((req.user && (req.user.user_id || req.user.id)) || req.get('x-gomoku-room') || 'default');
}

function getState(req) {
  var key = roomKey(req);
  if (!rooms[key]) rooms[key] = newState();
  return rooms[key];
}

function isCoordinate(value) {
  return Number.isInteger(value) && value >= 0 && value < SIZE;
}

function hasWinner(board, row, col, color) {
  var directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

  return directions.some(function(direction) {
    var count = 1;

    [[1, 1], [-1, -1]].forEach(function(sign) {
      var r = row + direction[0] * sign[0];
      var c = col + direction[1] * sign[1];

      while (
        r >= 0 && r < SIZE &&
        c >= 0 && c < SIZE &&
        board[r][c] === color
      ) {
        count += 1;
        r += direction[0] * sign[0];
        c += direction[1] * sign[1];
      }
    });

    return count >= 5;
  });
}

router.get('/state', function(req, res) {
  res.json({ code: 200, data: getState(req) });
});

router.post('/move', function(req, res) {
  var row = req.body && req.body.row;
  var col = req.body && req.body.col;
  var state = getState(req);

  if (!isCoordinate(row) || !isCoordinate(col)) {
    return res.status(400).json({ code: 400, message: '坐标不合法' });
  }
  if (state.winner) {
    return res.status(409).json({ code: 409, message: '对局已结束', data: state });
  }
  if (state.board[row][col]) {
    return res.status(409).json({ code: 409, message: '该位置已有棋子', data: state });
  }

  var color = state.turn;
  state.board[row][col] = color;
  if (hasWinner(state.board, row, col, color)) {
    state.winner = color;
  } else {
    state.turn = color === 'black' ? 'white' : 'black';
  }

  res.json({ code: 200, data: state });
});

router.post('/reset', function(req, res) {
  var key = roomKey(req);
  rooms[key] = newState();
  res.json({ code: 200, data: rooms[key] });
});

module.exports = router;
