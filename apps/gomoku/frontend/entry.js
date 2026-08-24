(function() {
  var NAME = 'gomoku';
  var SIZE = 15;
  var definitions = window.ClassIntraMarket && window.ClassIntraMarket.apps;

  function createBoard() {
    return Array.from({ length: SIZE }, function() {
      return Array(SIZE).fill(null);
    });
  }

  function request(context, method, path, body) {
    var action = context.api && context.api[method.toLowerCase()];
    if (typeof action !== 'function') return Promise.reject(new Error('SDK API 不可用'));
    var response = method === 'GET'
      ? action.call(context.api, path)
      : action.call(context.api, path, body);
    return response.then(function(response) {
      var payload = response && response.data ? response.data : response;
      return payload && payload.data ? payload.data : payload;
    });
  }

  function mount(container, context) {
    if (!container || container.__gomokuUnmount) return;
    var board = createBoard();
    var turn = 'black';
    var winner = null;
    var disposed = false;
    var root = document.createElement('section');
    root.className = 'gomoku-app';
    root.innerHTML = '<div class="gomoku-header"><div><h1>五子棋</h1><p class="gomoku-status"></p></div><div class="gomoku-actions"><button type="button" data-action="reset">重开</button><button type="button" data-action="leave">离开</button></div></div><div class="gomoku-board" role="grid" aria-label="五子棋棋盘"></div>';
    container.replaceChildren(root);

    var status = root.querySelector('.gomoku-status');
    var boardElement = root.querySelector('.gomoku-board');

    function checkWinner(row, col, color) {
      var directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
      return directions.some(function(direction) {
        var count = 1;
        [[1, 1], [-1, -1]].forEach(function(sign) {
          var r = row + direction[0] * sign[0];
          var c = col + direction[1] * sign[1];
          while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === color) {
            count += 1;
            r += direction[0] * sign[0];
            c += direction[1] * sign[1];
          }
        });
        return count >= 5;
      });
    }

    function updateStatus() {
      status.textContent = winner ? (winner === 'black' ? '黑棋获胜' : '白棋获胜') : (turn === 'black' ? '轮到黑棋' : '轮到白棋');
    }

    function render() {
      boardElement.replaceChildren();
      board.forEach(function(row, rowIndex) {
        row.forEach(function(color, colIndex) {
          var cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'gomoku-cell' + (color ? ' is-' + color : '');
          cell.dataset.row = rowIndex;
          cell.dataset.col = colIndex;
          cell.setAttribute('aria-label', (rowIndex + 1) + '行' + (colIndex + 1) + '列');
          cell.disabled = !!color || !!winner || disposed;
          boardElement.appendChild(cell);
        });
      });
      updateStatus();
    }

    function loadState() {
      return request(context, 'GET', '/gomoku/state').then(function(data) {
        if (data && Array.isArray(data.board)) board = data.board;
        turn = data && data.turn ? data.turn : 'black';
        winner = data && data.winner ? data.winner : null;
        render();
      }).catch(function() { render(); });
    }

    function reset() {
      return request(context, 'POST', '/gomoku/reset').then(function(data) {
        board = data.board || createBoard();
        turn = data.turn || 'black';
        winner = null;
        render();
      });
    }

    function onBoardClick(event) {
      var cell = event.target.closest('.gomoku-cell');
      if (!cell || winner || disposed) return;
      var row = Number(cell.dataset.row);
      var col = Number(cell.dataset.col);
      if (board[row][col]) return;

      cell.disabled = true;
      request(context, 'POST', '/gomoku/move', { row: row, col: col })
        .then(function(data) {
          board = data.board || createBoard();
          turn = data.turn || turn;
          winner = data.winner || null;
          render();
        })
        .catch(function() {
          render();
        });
    }

    function onAction(event) {
      var action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'reset') reset().catch(function() { updateStatus(); });
      if (action.dataset.action === 'leave' && context.router && typeof context.router.push === 'function') context.router.push('/');
    }

    boardElement.addEventListener('click', onBoardClick);
    root.addEventListener('click', onAction);
    container.__gomokuUnmount = function() {
      disposed = true;
      boardElement.removeEventListener('click', onBoardClick);
      root.removeEventListener('click', onAction);
      container.replaceChildren();
      delete container.__gomokuUnmount;
    };
    loadState();
  }

  function unmount(container) {
    if (container && typeof container.__gomokuUnmount === 'function') container.__gomokuUnmount();
  }

  var definition = { name: NAME, mount: mount, unmount: unmount };
  if (window.ClassIntraMarket && typeof window.ClassIntraMarket.define === 'function') window.ClassIntraMarket.define(definition);
  else if (definitions) definitions[NAME] = definition;
})();
