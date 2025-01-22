const WORKER_URL = URL.createObjectURL(new Blob([`
  // Worker code starts here
  const COLS = 7;
  const ROWS = 7;
  const PLAYER_WIN = -4;
  const AI_WIN = 4;
  const NO_WIN = 0;

  let gameState;

  class State {
    constructor(prevState) {
      this.board = Array.from({ length: COLS }, () => []);
      this.score = NO_WIN;
      this.winningChips = undefined;

      if (prevState) {
        this.board = prevState.board.map(col => [...col]);
        this.score = prevState.score;
      }
    }

    makeMove(player, col) {
      const row = this.board[col].length;
      if (row < ROWS) {
        this.board[col][row] = player;
        this.updateScore(player, col, row);
        return { col, row };
      }
      return undefined;
    }

    isFull() {
      return this.board.every(col => col.length === ROWS);
    }

    updateScore(player, col, row) {
      const isWin = 
        this.checkRuns(player, col, row, 0, 1) || 
        this.checkRuns(player, col, row, 1, 0) || 
        this.checkRuns(player, col, row, 1, 1) || 
        this.checkRuns(player, col, row, 1, -1);

      this.score = isWin ? (player === 1 ? PLAYER_WIN : AI_WIN) : NO_WIN;
    }

    checkRuns(player, col, row, colStep, rowStep) {
      let count = 0;

      for (let step = -3; step <= 3; step++) {
        if (this.getPlayer(col + step * colStep, row + step * rowStep) === player) {
          count++;
          if (count === 4) {
            this.winningChips = Array.from({ length: 4 }, (_, i) => ({
              col: col + (step - i) * colStep,
              row: row + (step - i) * rowStep
            }));
            return true;
          }
        } else {
          count = 0;
          if (step === 0) break;
        }
      }
      return false;
    }

    getPlayer(col, row) {
      return this.board[col]?.[row];
    }

    hasWinner() {
      return this.score === PLAYER_WIN || this.score === AI_WIN;
    }
  }

  self.addEventListener('message', (e) => {
    const { messageType, col, maxDepth } = e.data;
    if (messageType === 'reset') reset();
    else if (messageType === 'human-move') handleHumanMove(col);
    else if (messageType === 'ai-move') handleAIMove(maxDepth);
  });

  function reset() {
    gameState = new State();
    self.postMessage({ messageType: 'reset-done' });
  }

  function handleHumanMove(col) {
    const coords = gameState.makeMove(1, col);
    const isWin = gameState.hasWinner();
    const winningChips = gameState.winningChips;
    const isFull = gameState.isFull();
    self.postMessage({
      messageType: 'human-move-done',
      coords,
      isWin,
      winningChips,
      isFull
    });
  }

  function handleAIMove(maxDepth) {
    let col, winImminent = false, lossImminent = false;

    for (let depth = 0; depth <= maxDepth; depth++) {
      const tempState = new State(gameState);
      const isTopLevel = (depth === maxDepth);
      const tentativeCol = think(tempState, 2, depth, isTopLevel);

      if (tempState.score === PLAYER_WIN) {
        lossImminent = true;
        break;
      } else if (tempState.score === AI_WIN) {
        col = tentativeCol;
        winImminent = true;
        break;
      } else {
        col = tentativeCol;
      }
    }

    const coords = gameState.makeMove(2, col);
    const isWin = gameState.hasWinner();
    const winningChips = gameState.winningChips;
    const isFull = gameState.isFull();
    self.postMessage({
      messageType: 'ai-move-done',
      coords,
      isWin,
      winningChips,
      isFull,
      winImminent,
      lossImminent
    });
  }

  function think(node, player, depth, isTopLevel) {
    let scoreSet = false;
    const children = [];

    for (let col = 0; col < COLS; col++) {
      if (isTopLevel) {
        self.postMessage({ messageType: 'progress', col });
      }

      const row = node.board[col].length;
      if (row < ROWS) {
        const childNode = new State(node);
        childNode.makeMove(player, col);
        children[col] = childNode;

        if (!childNode.hasWinner() && depth > 0) {
          const nextPlayer = player === 1 ? 2 : 1;
          think(childNode, nextPlayer, depth - 1);
        }

        if (!scoreSet) {
          node.score = childNode.score;
          scoreSet = true;
        } else if (player === 1 && childNode.score < node.score) {
          node.score = childNode.score;
        } else if (player === 2 && childNode.score > node.score) {
          node.score = childNode.score;
        }
      }
    }

    const candidates = children.reduce((acc, child, idx) => {
      if (child && child.score === node.score) acc.push(idx);
      return acc;
    }, []);
    
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
`], { type: 'application/javascript' }));

const MSGS = {
  start: { header: 'Get Ready', blurb: 'Select your difficulty and start the game.' },
  playerTurn: { header: 'Your Turn', blurb: 'Click on the board to drop your chip.' },
  aiTurn: { header: 'AI\'s Turn', blurb: 'The AI is trying to find the best way to make you lose.' },
  playerWin: { header: 'You Win', blurb: 'You are a champion! Cherish this moment.' },
  aiWin: { header: 'AI Wins', blurb: 'Try again when you are ready to face the AI.' },
  tie: { header: 'It\'s a Tie', blurb: 'Everyone is a winner! Or a loser. Depends on perspective.' }
};

const OUTLOOKS = {
  winImminent: 'Uh oh, the AI is making a strong move!',
  lossImminent: 'The AI is unsure. Now\'s your chance!'
};

let worker;
let currentState;

$(function() {
  $('.start-game button').on('click', startGame);
  setBlurb('start');
  setOutlook();

  worker = new Worker(WORKER_URL);
  worker.addEventListener('message', (e) => {
    const { messageType, coords, isWin, winningChips, isFull, col, isWinImminent, isLossImminent } = e.data;
    if (messageType === 'reset-done') startTurn();
    else if (messageType === 'human-move-done') endTurn(coords, isWin, winningChips, isFull);
    else if (messageType === 'progress') updateAITurn(col);
    else if (messageType === 'ai-move-done') endAITurn(coords, isWin, winningChips, isFull, isWinImminent, isLossImminent);
  });
});

function setBlurb(key) {
  $('.info-panel h2').text(MSGS[key].header);
  $('.info-panel .info-blurb').text(MSGS[key].blurb);
}

function setOutlook(key) {
  const $outlook = $('.info-panel .game-outlook');
  if (key) {
    $outlook.text(OUTLOOKS[key]).show();
  } else {
    $outlook.hide();
  }
}

function startGame() {
  $('.difficulty-panel').addClass('freeze').addClass('small'); 
  $('.difficulty-panel input').prop('disabled', true);
  $('.highlighted-cells, .game-chips').empty();
  $('.game-board').show(); 
  worker.postMessage({ messageType: 'reset' });
}

function startTurn() {
  setBlurb('playerTurn');
  $('.clickable-columns div').addClass('hover');

  const col = $('.clickable-columns div:hover').index();
  if (col !== -1) createCursor(1, col);

  $('.clickable-columns')
    .on('mouseenter', () => {
      const col = $('.clickable-columns div:hover').index();
      createCursor(1, col);
    })
    .on('mouseleave', removeCursor);

  $('.clickable-columns div')
    .on('mouseenter', function() {
      const col = $(this).index();
      moveCursor(col);
    })
    .on('click', function() {
      $('.clickable-columns, .clickable-columns div').off();
      const col = $(this).index();
      worker.postMessage({ messageType: 'human-move', col });
    });
}

function endTurn(coords, isWin, winningChips, isFull) {
  $('.clickable-columns div').removeClass('hover');
  if (!coords) {
    startTurn();
  } else {
    dropCursor(coords.row, () => {
      if (isWin) {
        finishGame('playerWin', winningChips);
      } else if (isFull) {
        finishGame('tie');
      } else {
        startAITurn();
      }
    });
  }
}

function startAITurn() {
  setBlurb('aiTurn');
  createCursor(2, 0);
  const maxDepth = parseInt($('input[name=difficulty]:checked').val(), 10) + 1;
  worker.postMessage({ messageType: 'ai-move', maxDepth });
}

function updateAITurn(col) {
  moveCursor(col);
}

function endAITurn(coords, isWin, winningChips, isFull, winImminent, lossImminent) {
  moveCursor(coords.col, () => {
    dropCursor(coords.row, () => {
      if (isWin) {
        finishGame('aiWin', winningChips);
      } else if (isFull) {
        finishGame('tie');
      } else {
        if (winImminent) {
          setOutlook('winImminent');
        } else if (lossImminent) {
          setOutlook('lossImminent');
        } else {
          setOutlook();
        }
        startTurn();
      }
    });
  });
}

function finishGame(blurbKey, winningChips) {
  $('.difficulty-panel').removeClass('freeze');
  $('.difficulty-panel input').prop('disabled', false);
  setBlurb(blurbKey); 
  setOutlook();

  if (winningChips) {
    winningChips.forEach(chip => createHighlight(chip.col, chip.row));
  }
}

function createHighlight(col, row) {
  $('<div>')
    .css({ left: indexToPixels(col), bottom: indexToPixels(row) })
    .appendTo('.highlighted-cells');
}

function createCursor(player, col) {
  const playerClass = 'player' + player;
  $('<div>', { class: 'cursor ' + playerClass })
    .css('left', indexToPixels(col))
    .appendTo('.game-chips');

  $('.highlighted-columns div').eq(col).addClass('lit');
}

function removeCursor() {
  $('.game-chips .cursor').remove();
  $('.highlighted-columns .lit').removeClass('lit');
}

function moveCursor(col, callback) {
  $('.game-chips .cursor').css('left', indexToPixels(col));
  $('.highlighted-columns .lit').removeClass('lit');
  $('.highlighted-columns div').eq(col).addClass('lit');
  setTimeout(callback, 300);
}

function dropCursor(row, callback) {
  const ms = (7 - row) * 40;
  const duration = (ms / 1000) + 's';

  $('.game-chips .cursor')
    .removeClass('cursor')
    .css({
      bottom: indexToPixels(row),
      'transition-duration': duration,
      'animation-delay': duration
    })
    .addClass('dropped');

  $('.highlighted-columns .lit').removeClass('lit');
  setTimeout(callback, ms);
}

function indexToPixels(index) {
  return (index * 61 + 1) + 'px';
}




