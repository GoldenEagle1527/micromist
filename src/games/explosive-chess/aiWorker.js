/**
 * 爆炸棋 AI Worker - 性能优化版
 * 
 * 优化内容：
 * 1. Undo/Redo 替代 Clone/Restore（消除 TypedArray 分配和 GC 压力）
 * 2. 增量式胜负检测（维护 redCount/blueCount 计数器，O(1) 检查）
 * 3. Zobrist Hashing + Transposition Table（避免重复评估）
 * 4. Minimax 内部 Move Ordering（提高 Alpha-Beta 剪枝效率）
 * 5. 迭代加深 + 时间控制（保证响应时间，允许更深搜索）
 * 
 * 运行在 Web Worker 线程中，不阻塞主线程
 */

'use strict';

// === 常量 ===
const COLOR_EMPTY = 0;
const COLOR_RED = 1;
const COLOR_BLUE = 2;

const WIN_MODE_ANNIHILATION = 'annihilation';
const WIN_MODE_STEPS = 'steps';
const WIN_MODE_AREA = 'area';

// === Zobrist Hashing 初始化 ===

// 用于生成伪随机 32 位整数的简单 PRNG（xorshift32）
let _rngState = 123456789;
function xorshift32() {
  let x = _rngState;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  _rngState = x;
  return x >>> 0;
}

// Zobrist 表将在 createSimGame 中按棋盘大小初始化
// zobristTable[idx][color][count] = { lo, hi } 两个 32 位值模拟 64 位 hash
// turnHash = 当前轮次的额外 hash 值

// === Transposition Table ===

const TT_SIZE = 1 << 18; // 262144 条目
const TT_EXACT = 0;
const TT_LOWER = 1; // Alpha cutoff (fail high)
const TT_UPPER = 2; // Beta cutoff (fail low)

// 每个条目: { hashLo, hashHi, depth, value, flag, generation }
// 使用 generation 机制避免每次重新分配数组
let ttTable = null;
let ttGeneration = 0;

function initTT() {
  if (ttTable === null) {
    // 仅首次分配
    ttTable = new Array(TT_SIZE);
    for (let i = 0; i < TT_SIZE; i++) {
      ttTable[i] = { hashLo: 0, hashHi: 0, depth: -1, value: 0, flag: TT_EXACT, generation: 0 };
    }
  }
  // 后续调用只递增 generation，使所有旧条目失效
  ttGeneration++;
}

function probeTT(hashLo, hashHi, depth, alpha, beta) {
  const idx = hashLo & (TT_SIZE - 1);
  const entry = ttTable[idx];
  if (entry.generation === ttGeneration && entry.hashLo === hashLo && entry.hashHi === hashHi && entry.depth >= depth) {
    if (entry.flag === TT_EXACT) return { hit: true, value: entry.value };
    if (entry.flag === TT_LOWER && entry.value >= beta) return { hit: true, value: entry.value };
    if (entry.flag === TT_UPPER && entry.value <= alpha) return { hit: true, value: entry.value };
  }
  return { hit: false, value: 0 };
}

function storeTT(hashLo, hashHi, depth, value, flag) {
  const idx = hashLo & (TT_SIZE - 1);
  const entry = ttTable[idx];
  // 替换策略：同 generation 时更深的搜索优先保留；不同 generation 直接替换
  if (entry.generation !== ttGeneration || entry.depth <= depth) {
    entry.hashLo = hashLo;
    entry.hashHi = hashHi;
    entry.depth = depth;
    entry.value = value;
    entry.flag = flag;
    entry.generation = ttGeneration;
  }
}

// === 精简版游戏引擎（纯计算，支持 Undo） ===

function createSimGame(config) {
  const { boardSize, winMode, winParam } = config;
  const totalCells = boardSize * boardSize;

  const counts = new Uint8Array(totalCells);
  const colors = new Uint8Array(totalCells);
  const capacities = new Uint8Array(totalCells);

  // 预计算容量
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const idx = r * boardSize + c;
      const isTop = r === 0;
      const isBottom = r === boardSize - 1;
      const isLeft = c === 0;
      const isRight = c === boardSize - 1;
      const edgeCount = (isTop ? 1 : 0) + (isBottom ? 1 : 0) + (isLeft ? 1 : 0) + (isRight ? 1 : 0);
      if (edgeCount >= 2) {
        capacities[idx] = 2;
      } else if (edgeCount === 1) {
        capacities[idx] = 3;
      } else {
        capacities[idx] = 4;
      }
    }
  }

  // 预计算邻居表
  const neighborsTable = new Array(totalCells);
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const idx = r * boardSize + c;
      const neighbors = [];
      if (r > 0) neighbors.push((r - 1) * boardSize + c);
      if (r < boardSize - 1) neighbors.push((r + 1) * boardSize + c);
      if (c > 0) neighbors.push(r * boardSize + (c - 1));
      if (c < boardSize - 1) neighbors.push(r * boardSize + (c + 1));
      neighborsTable[idx] = neighbors;
    }
  }

  // === Zobrist 初始化（每个位置 × 颜色 × count 组合一个随机数） ===
  // 爆炸链式反应中 count 可能临时超过 capacity（多个邻居同时溢出），需覆盖到更大值
  const maxCount = 9; // count 范围 0-8（安全上限）
  const zobristPiece = new Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    zobristPiece[i] = new Array(3); // COLOR_EMPTY=0, RED=1, BLUE=2
    for (let c = 0; c <= 2; c++) {
      zobristPiece[i][c] = new Array(maxCount);
      for (let cnt = 0; cnt < maxCount; cnt++) {
        zobristPiece[i][c][cnt] = { lo: xorshift32(), hi: xorshift32() };
      }
    }
  }
  const zobristTurn = { lo: xorshift32(), hi: xorshift32() };

  // === 游戏状态 ===
  let currentTurn = COLOR_RED;
  let stepCount = 0;
  let gameOver = false;
  let winner = null;

  // 增量计数器
  let redCount = 0;
  let blueCount = 0;

  // 增量 hash
  let hashLo = 0;
  let hashHi = 0;

  // 用于 undo 日志的"已记录"标记（避免同一格子重复记录）
  // 使用递增的 generation 号代替每次清零
  const changeGeneration = new Uint32Array(totalCells);
  let currentGeneration = 0;

  // === 内部方法 ===

  function updateHash(idx, color, count) {
    // XOR toggles: XOR on removes, XOR on adds
    // 钳制 count 到有效范围内，防止极端情况下越界
    const clampedCount = count < maxCount ? count : maxCount - 1;
    const z = zobristPiece[idx][color][clampedCount];
    hashLo ^= z.lo;
    hashHi ^= z.hi;
  }

  function toggleTurnHash() {
    hashLo ^= zobristTurn.lo;
    hashHi ^= zobristTurn.hi;
  }

  function isValidMove(row, col, playerColor) {
    if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return false;
    if (gameOver) return false;
    const idx = row * boardSize + col;
    const cellColor = colors[idx];
    return cellColor === COLOR_EMPTY || cellColor === playerColor;
  }

  /**
   * 执行落子，返回 undo 日志用于回退
   * 返回 { gameOver, winner, undoLog } 或 null（非法走法）
   */
  function makeMove(row, col, playerColor) {
    if (!isValidMove(row, col, playerColor)) return null;
    if (playerColor !== currentTurn) return null;

    const idx = row * boardSize + col;

    // 新的 generation：本次 makeMove 的所有变更使用同一个 generation
    currentGeneration++;
    const gen = currentGeneration;

    // 记录 undo 日志
    const undoLog = {
      changes: [], // [{idx, oldColor, oldCount}]
      oldTurn: currentTurn,
      oldStep: stepCount,
      oldGameOver: gameOver,
      oldWinner: winner,
      oldRedCount: redCount,
      oldBlueCount: blueCount,
      oldHashLo: hashLo,
      oldHashHi: hashHi
    };

    // 移除旧 hash
    updateHash(idx, colors[idx], counts[idx]);

    // 记录变更前状态（标记为已记录）
    changeGeneration[idx] = gen;
    undoLog.changes.push({ idx, oldColor: colors[idx], oldCount: counts[idx] });

    // 更新颜色计数
    if (colors[idx] === COLOR_EMPTY) {
      if (playerColor === COLOR_RED) redCount++;
      else blueCount++;
    }

    counts[idx] += 1;
    colors[idx] = playerColor;
    stepCount++;

    // 添加新 hash
    updateHash(idx, colors[idx], counts[idx]);

    // 切换轮次 hash
    toggleTurnHash();

    // 处理爆炸
    const explosionResult = processExplosions(idx, undoLog, gen);

    currentTurn = (currentTurn === COLOR_RED) ? COLOR_BLUE : COLOR_RED;

    if (explosionResult.winner) {
      gameOver = true;
      winner = explosionResult.winner;
    } else if (winMode === WIN_MODE_STEPS && stepCount >= winParam) {
      const result = checkStepsWin();
      if (result) {
        gameOver = true;
        winner = result.winner;
      }
    }

    return { gameOver, winner, undoLog };
  }

  /**
   * 回退走法，根据 undoLog 精确恢复状态
   * changes 中只记录每个格子的首次变更（原始状态），可直接恢复
   */
  function undoMove(undoLog) {
    const changes = undoLog.changes;
    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      counts[ch.idx] = ch.oldCount;
      colors[ch.idx] = ch.oldColor;
    }
    // 恢复元数据
    currentTurn = undoLog.oldTurn;
    stepCount = undoLog.oldStep;
    gameOver = undoLog.oldGameOver;
    winner = undoLog.oldWinner;
    redCount = undoLog.oldRedCount;
    blueCount = undoLog.oldBlueCount;
    hashLo = undoLog.oldHashLo;
    hashHi = undoLog.oldHashHi;
  }

  function processExplosions(startIdx, undoLog, gen) {
    let explWinner = null;

    if (counts[startIdx] < capacities[startIdx]) {
      return { winner: null };
    }

    const queue = [startIdx];
    let queueHead = 0;

    while (queueHead < queue.length) {
      const currentIdx = queue[queueHead++];

      if (counts[currentIdx] < capacities[currentIdx]) continue;

      const explodingColor = colors[currentIdx];

      // 移除当前格的 hash
      updateHash(currentIdx, colors[currentIdx], counts[currentIdx]);

      // 只在首次被修改时记录到 undoLog
      if (changeGeneration[currentIdx] !== gen) {
        changeGeneration[currentIdx] = gen;
        undoLog.changes.push({ idx: currentIdx, oldColor: colors[currentIdx], oldCount: counts[currentIdx] });
      }

      counts[currentIdx] = 0;
      // 保持与原逻辑一致：爆炸后 count=0 但 colors 不变
      // count=0 且 color 非空的格子在 checkExplosionWin 中仍计入该颜色

      // 添加新 hash (count=0)
      updateHash(currentIdx, colors[currentIdx], 0);

      const neighbors = neighborsTable[currentIdx];
      for (let i = 0; i < neighbors.length; i++) {
        const nIdx = neighbors[i];

        // 移除邻居旧 hash
        updateHash(nIdx, colors[nIdx], counts[nIdx]);

        // 只在首次被修改时记录到 undoLog
        if (changeGeneration[nIdx] !== gen) {
          changeGeneration[nIdx] = gen;
          undoLog.changes.push({ idx: nIdx, oldColor: colors[nIdx], oldCount: counts[nIdx] });
        }

        // 更新颜色计数（增量维护）
        const oldNColor = colors[nIdx];
        if (oldNColor !== explodingColor) {
          // 旧颜色失去一个格子（如果不是空格）
          if (oldNColor === COLOR_RED) redCount--;
          else if (oldNColor === COLOR_BLUE) blueCount--;
          // 新颜色获得一个格子
          if (explodingColor === COLOR_RED) redCount++;
          else if (explodingColor === COLOR_BLUE) blueCount++;
        }

        counts[nIdx] += 1;
        colors[nIdx] = explodingColor;

        // 添加邻居新 hash
        updateHash(nIdx, colors[nIdx], counts[nIdx]);

        if (counts[nIdx] >= capacities[nIdx]) {
          queue.push(nIdx);
        }
      }

      // 增量胜负检测 O(1)
      if (stepCount >= 2) {
        const checkResult = checkExplosionWin();
        if (checkResult) {
          explWinner = checkResult.winner;
          break;
        }
      }
    }

    return { winner: explWinner };
  }

  function checkExplosionWin() {
    if (winMode === WIN_MODE_ANNIHILATION) {
      // 使用增量计数器 O(1)
      if (redCount > 0 && blueCount === 0) return { winner: COLOR_RED };
      if (blueCount > 0 && redCount === 0) return { winner: COLOR_BLUE };
    } else if (winMode === WIN_MODE_AREA) {
      if (redCount >= winParam) return { winner: COLOR_RED };
      if (blueCount >= winParam) return { winner: COLOR_BLUE };
    }
    return null;
  }

  function checkStepsWin() {
    // 使用增量计数器 O(1)
    if (redCount > blueCount) return { winner: COLOR_RED };
    if (blueCount > redCount) return { winner: COLOR_BLUE };
    return { winner: 'draw' };
  }

  function loadState(state) {
    counts.set(state.counts);
    colors.set(state.colors);
    currentTurn = state.currentTurn;
    stepCount = state.stepCount;
    gameOver = false;
    winner = null;

    // 重新计算增量计数
    redCount = 0;
    blueCount = 0;
    hashLo = 0;
    hashHi = 0;

    for (let i = 0; i < totalCells; i++) {
      if (colors[i] === COLOR_RED) redCount++;
      else if (colors[i] === COLOR_BLUE) blueCount++;
      // 初始化 hash
      if (colors[i] !== COLOR_EMPTY || counts[i] !== 0) {
        updateHash(i, colors[i], counts[i]);
      }
    }
    // 如果当前是蓝方回合，toggle turn hash
    if (currentTurn === COLOR_BLUE) {
      toggleTurnHash();
    }
  }

  function getState() {
    return {
      counts: new Uint8Array(counts),
      colors: new Uint8Array(colors),
      currentTurn,
      stepCount
    };
  }

  function getCellCounts() {
    return { red: redCount, blue: blueCount };
  }

  return {
    boardSize,
    totalCells,
    counts,
    colors,
    capacities,
    neighborsTable,
    zobristPiece,
    zobristTurn,
    get currentTurn() { return currentTurn; },
    set currentTurn(v) { currentTurn = v; },
    get stepCount() { return stepCount; },
    get gameOver() { return gameOver; },
    get winner() { return winner; },
    get redCount() { return redCount; },
    get blueCount() { return blueCount; },
    get hashLo() { return hashLo; },
    get hashHi() { return hashHi; },
    isValidMove,
    makeMove,
    undoMove,
    loadState,
    getState,
    getCellCounts
  };
}

// === 保留旧的 Clone/Restore 用于简单/中等难度（它们只做单步模拟） ===

function cloneState(simGame) {
  return {
    counts: new Uint8Array(simGame.counts),
    colors: new Uint8Array(simGame.colors),
    currentTurn: simGame.currentTurn,
    stepCount: simGame.stepCount
  };
}

function restoreState(simGame, state) {
  simGame.loadState(state);
}

// === 合法位置获取 ===

function getLegalMoves(simGame, playerColor) {
  const moves = [];
  const boardSize = simGame.boardSize;
  const colors = simGame.colors;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const idx = r * boardSize + c;
      const cellColor = colors[idx];
      if (cellColor === COLOR_EMPTY || cellColor === playerColor) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

// === 游戏阶段判定 ===

function getGamePhase(simGame) {
  const totalCells = simGame.totalCells;
  const occupied = simGame.redCount + simGame.blueCount;
  const occupancyRate = occupied / totalCells;

  if (occupancyRate < 0.15) return 'opening';
  if (occupancyRate < 0.50) return 'midgame';
  return 'endgame';
}

// === 评估函数 ===

/**
 * 完整评估函数 - 用于困难/炼狱难度的 Minimax 搜索
 * 阶段感知：开局强调位置/对抗/蓄力，中局攻防平衡，残局进攻为主
 */
function evaluate(simGame, aiColor) {
  const opponentColor = (aiColor === COLOR_RED) ? COLOR_BLUE : COLOR_RED;
  const totalCells = simGame.totalCells;
  const counts = simGame.counts;
  const colors = simGame.colors;
  const capacities = simGame.capacities;
  const neighborsTable = simGame.neighborsTable;

  const phase = getGamePhase(simGame);

  let aiCells = 0, opCells = 0;
  let aiTotalCount = 0, opTotalCount = 0;
  let aiBombs = 0, opBombs = 0;
  let aiCorners = 0, aiEdges = 0, aiCenter = 0;

  // 位置关系指标
  let aiAdjToOp = 0;
  let aiBombAdjToOp = 0;
  let aiConnections = 0;
  let aiChargeScore = 0;
  let opBombAdjToAi = 0;

  for (let i = 0; i < totalCells; i++) {
    const c = colors[i];
    if (c === aiColor) {
      aiCells++;
      aiTotalCount += counts[i];
      if (counts[i] === capacities[i] - 1) aiBombs++;
      if (capacities[i] === 2) aiCorners++;
      else if (capacities[i] === 3) aiEdges++;
      else aiCenter++;

      // 蓄力进度
      aiChargeScore += (counts[i] / capacities[i]) * 5;

      // 邻接分析
      const neighbors = neighborsTable[i];
      for (let j = 0; j < neighbors.length; j++) {
        const nColor = colors[neighbors[j]];
        if (nColor === opponentColor) {
          aiAdjToOp++;
          if (counts[i] === capacities[i] - 1) aiBombAdjToOp++;
        }
        if (nColor === aiColor && neighbors[j] > i) {
          aiConnections++;
        }
      }
    } else if (c === opponentColor) {
      opCells++;
      opTotalCount += counts[i];
      if (counts[i] === capacities[i] - 1) {
        opBombs++;
        const neighbors = neighborsTable[i];
        for (let j = 0; j < neighbors.length; j++) {
          if (colors[neighbors[j]] === aiColor) {
            opBombAdjToAi++;
            break;
          }
        }
      }
    }
  }

  // 胜利/失败检测
  if (simGame.stepCount >= 2) {
    if (opCells === 0 && aiCells > 0) return 100000;
    if (aiCells === 0 && opCells > 0) return -100000;
  }

  let score = 0;

  if (phase === 'opening') {
    score += aiCells * 5;
    score += opCells * -5;
    score += aiCorners * 25;
    score += aiEdges * 10;
    score += aiCenter * 2;
    score += aiChargeScore * 3;
    score += aiAdjToOp * 8;
    score += aiBombAdjToOp * 20;
    score += aiConnections * 4;
    score += aiBombs * 12;
    score += opBombs * -8;
    score += opBombAdjToAi * -15;
  } else if (phase === 'midgame') {
    score += aiCells * 10;
    score += opCells * -10;
    score += aiTotalCount * 1;
    score += opTotalCount * -1;
    score += aiBombs * 10;
    score += opBombs * -7;
    score += aiCorners * 18;
    score += aiEdges * 6;
    score += aiCenter * 3;
    score += aiAdjToOp * 4;
    score += aiBombAdjToOp * 12;
    score += aiConnections * 2;
    score += aiChargeScore * 1;
    score += opBombAdjToAi * -10;
  } else {
    score += aiCells * 10;
    score += opCells * -10;
    score += aiTotalCount * 1;
    score += opTotalCount * -1;
    score += aiBombs * 8;
    score += opBombs * -5;
    score += aiCorners * 15;
    score += aiEdges * 5;
    score += aiCenter * 3;
    score += aiBombAdjToOp * 8;
    score += opBombAdjToAi * -6;
  }

  return score;
}

/**
 * 简化评估函数 - 用于简单/中等难度的单步模拟
 */
function evaluateSimple(simGame, aiColor, prevState) {
  const opponentColor = (aiColor === COLOR_RED) ? COLOR_BLUE : COLOR_RED;
  const totalCells = simGame.totalCells;
  const counts = simGame.counts;
  const colors = simGame.colors;
  const capacities = simGame.capacities;
  const neighborsTable = simGame.neighborsTable;

  let aiCells = 0, opCells = 0;
  let prevAiCells = 0, prevOpCells = 0;
  let aiBombs = 0, opThreats = 0;

  for (let i = 0; i < totalCells; i++) {
    if (colors[i] === aiColor) aiCells++;
    else if (colors[i] === opponentColor) opCells++;

    if (prevState.colors[i] === aiColor) prevAiCells++;
    else if (prevState.colors[i] === opponentColor) prevOpCells++;

    if (colors[i] === aiColor && counts[i] === capacities[i] - 1) aiBombs++;
    if (colors[i] === opponentColor && counts[i] === capacities[i] - 1) {
      const neighbors = neighborsTable[i];
      for (let j = 0; j < neighbors.length; j++) {
        if (colors[neighbors[j]] === aiColor) {
          opThreats++;
          break;
        }
      }
    }
  }

  // 胜利检测
  if (simGame.stepCount >= 2) {
    if (opCells === 0 && aiCells > 0) return 100000;
    if (aiCells === 0 && opCells > 0) return -100000;
  }

  const aiGain = aiCells - prevAiCells;
  const opLoss = prevOpCells - opCells;

  let score = 0;
  score += aiGain * 3;
  score += opLoss * 4;
  score += aiBombs * 2;
  score += opThreats * -3;

  // 角格/边格加分
  for (let i = 0; i < totalCells; i++) {
    if (colors[i] === aiColor && prevState.colors[i] !== aiColor) {
      if (capacities[i] === 2) score += 5;
      else if (capacities[i] === 3) score += 2;
    }
  }

  // === 开局/中局阶段的位置策略增强 ===
  const phase = getGamePhase(simGame);

  if (phase === 'opening') {
    const phaseMultiplier = 1.5;

    for (let i = 0; i < totalCells; i++) {
      if (colors[i] === aiColor) {
        const isNew = (prevState.colors[i] !== aiColor);
        const wasStacked = (!isNew && counts[i] > 0 && prevState.counts[i] > 0 && counts[i] === prevState.counts[i] + 1);

        if (isNew || wasStacked) {
          const neighbors = neighborsTable[i];
          for (let j = 0; j < neighbors.length; j++) {
            if (colors[neighbors[j]] === opponentColor) {
              score += 6 * phaseMultiplier;
            }
          }

          for (let j = 0; j < neighbors.length; j++) {
            if (colors[neighbors[j]] === aiColor && neighbors[j] !== i) {
              score += 2 * phaseMultiplier;
            }
          }
        }

        if (counts[i] === capacities[i] - 1) {
          const wasCritical = (prevState.colors[i] === aiColor && prevState.counts[i] === capacities[i] - 1);
          if (!wasCritical) {
            score += 5 * phaseMultiplier;
            const neighbors = neighborsTable[i];
            for (let j = 0; j < neighbors.length; j++) {
              if (colors[neighbors[j]] === opponentColor) {
                score += 8 * phaseMultiplier;
                break;
              }
            }
          }
        }
      }
    }

    // 蓄力奖励
    for (let i = 0; i < totalCells; i++) {
      if (colors[i] === aiColor && prevState.colors[i] === aiColor
          && prevState.counts[i] > 0 && counts[i] === prevState.counts[i] + 1) {
        score += 3;
        if (capacities[i] === 2) score += 5;
        else if (capacities[i] === 3) score += 2;
      }
    }
  }

  // === 中局阶段增强 ===
  if (phase === 'midgame') {
    for (let i = 0; i < totalCells; i++) {
      if (colors[i] !== aiColor) continue;

      const isNew = (prevState.colors[i] !== aiColor);
      const wasStacked = (!isNew && counts[i] > 0 && prevState.counts[i] > 0 && counts[i] === prevState.counts[i] + 1);
      const neighbors = neighborsTable[i];

      if (isNew) {
        let adjToOp = 0, adjToAi = 0;
        let opCriticalNearby = false;

        for (let j = 0; j < neighbors.length; j++) {
          const nColor = colors[neighbors[j]];
          if (nColor === opponentColor) {
            adjToOp++;
            if (counts[neighbors[j]] === capacities[neighbors[j]] - 1) {
              opCriticalNearby = true;
            }
          } else if (nColor === aiColor) {
            adjToAi++;
          }
        }

        score += adjToOp * 8;
        score += adjToAi * 4;
        if (adjToOp === 0 && adjToAi === 0) score -= 8;
        if (opCriticalNearby) score += 6;

        if (capacities[i] === 2) score += 6;
        else if (capacities[i] === 3) score += 3;
      }

      if (wasStacked) {
        score += 6;
        if (capacities[i] === 2) score += 7;
        else if (capacities[i] === 3) score += 4;

        for (let j = 0; j < neighbors.length; j++) {
          if (colors[neighbors[j]] === opponentColor) {
            score += 6;
          }
        }

        for (let j = 0; j < neighbors.length; j++) {
          if (colors[neighbors[j]] === aiColor && neighbors[j] !== i) {
            score += 3;
          }
        }
      }

      if ((isNew || wasStacked) && counts[i] === capacities[i] - 1) {
        const wasCritical = (prevState.colors[i] === aiColor && prevState.counts[i] === capacities[i] - 1);
        if (!wasCritical) {
          score += 8;
          let adjOpCount = 0;
          for (let j = 0; j < neighbors.length; j++) {
            if (colors[neighbors[j]] === opponentColor) adjOpCount++;
          }
          score += adjOpCount * 10;
        }
      }
    }
  }

  return score;
}

// === 难度策略 ===

/**
 * 简单难度：单步模拟全部合法位置 + 大量随机扰动
 */
function computeEasy(simGame, config, aiColor) {
  const moves = getLegalMoves(simGame, aiColor);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const scores = [];
  const savedState = cloneState(simGame);

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    restoreState(simGame, savedState);
    const result = simGame.makeMove(move.row, move.col, aiColor);

    let score;
    if (result && result.gameOver && result.winner === aiColor) {
      score = 100000;
    } else {
      score = evaluateSimple(simGame, aiColor, savedState);
    }

    // 随机扰动 ±30%
    const noise = (Math.random() - 0.5) * Math.abs(score) * 0.6;
    score += noise;
    score += (Math.random() - 0.5) * 4;

    scores.push({ move, score });
  }

  restoreState(simGame, savedState);

  scores.sort((a, b) => b.score - a.score);

  if (Math.random() < 0.7) {
    return scores[0].move;
  } else {
    const topN = Math.min(5, scores.length);
    const idx = Math.floor(Math.random() * topN);
    return scores[idx].move;
  }
}

/**
 * 中等难度：单步完整模拟 + 精确评估，从 top-3 中随机选一个
 */
function computeMedium(simGame, config, aiColor) {
  const moves = getLegalMoves(simGame, aiColor);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const scores = [];
  const savedState = cloneState(simGame);

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    restoreState(simGame, savedState);
    const result = simGame.makeMove(move.row, move.col, aiColor);

    let score;
    if (result && result.gameOver && result.winner === aiColor) {
      score = 100000;
    } else {
      score = evaluateSimple(simGame, aiColor, savedState);
    }

    scores.push({ move, score });
  }

  restoreState(simGame, savedState);

  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score >= 100000) return scores[0].move;

  const topN = Math.min(3, scores.length);
  const topScores = scores.slice(0, topN);
  const minScore = topScores[topN - 1].score;
  const weights = topScores.map(s => s.score - minScore + 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  for (let i = 0; i < topN; i++) {
    rand -= weights[i];
    if (rand <= 0) return topScores[i].move;
  }
  return topScores[0].move;
}

// === Minimax + Alpha-Beta + TT + 时间控制 ===

// 全局搜索控制变量（每次计算前重置）
let searchStartTime = 0;
let searchTimeLimit = 0;
let searchAborted = false;
let nodesSearchedGlobal = 0;

/**
 * 轻量级 Move Ordering（用于 Minimax 内部节点）
 * 只检查最关键的几个特征，开销远小于完整的 presortMoves
 */
function quickSortMoves(simGame, moves, player, maxCount) {
  const colors = simGame.colors;
  const counts = simGame.counts;
  const capacities = simGame.capacities;
  const neighborsTable = simGame.neighborsTable;
  const boardSize = simGame.boardSize;
  const opponentColor = (player === COLOR_RED) ? COLOR_BLUE : COLOR_RED;

  const scored = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const idx = move.row * boardSize + move.col;
    let priority = 0;

    // 能触发爆炸 = 最高优先
    if (colors[idx] === player && counts[idx] === capacities[idx] - 1) {
      priority += 100;
    }

    // 邻接对方
    const neighbors = neighborsTable[idx];
    for (let j = 0; j < neighbors.length; j++) {
      if (colors[neighbors[j]] === opponentColor) {
        priority += 20;
        break;
      }
    }

    // 位置价值
    if (capacities[idx] === 2) priority += 10;
    else if (capacities[idx] === 3) priority += 5;

    scored[i] = { move, priority };
  }

  // 简单排序
  scored.sort((a, b) => b.priority - a.priority);

  // 截取
  const limit = Math.min(maxCount, scored.length);
  const result = new Array(limit);
  for (let i = 0; i < limit; i++) {
    result[i] = scored[i].move;
  }
  return result;
}

/**
 * Minimax + Alpha-Beta + Transposition Table
 * 使用 Undo/Redo 而非 Clone/Restore
 */
function minimax(simGame, config, aiColor, depth, isMaximizing, alpha, beta) {
  // 时间检查（每 512 节点检查一次）
  nodesSearchedGlobal++;
  if ((nodesSearchedGlobal & 511) === 0) {
    if (performance.now() - searchStartTime > searchTimeLimit) {
      searchAborted = true;
      return evaluate(simGame, aiColor);
    }
  }

  if (searchAborted) return evaluate(simGame, aiColor);

  if (depth === 0 || simGame.gameOver) {
    return evaluate(simGame, aiColor);
  }

  // Transposition Table 查询
  const hashLo = simGame.hashLo;
  const hashHi = simGame.hashHi;
  const ttResult = probeTT(hashLo, hashHi, depth, alpha, beta);
  if (ttResult.hit) {
    return ttResult.value;
  }

  const currentPlayer = isMaximizing ? aiColor : ((aiColor === COLOR_RED) ? COLOR_BLUE : COLOR_RED);
  let moves = getLegalMoves(simGame, currentPlayer);

  if (moves.length === 0) {
    return evaluate(simGame, aiColor);
  }

  // 内部节点 Move Ordering
  const boardSize = simGame.boardSize;
  let maxCandidates;
  if (depth >= 3) {
    maxCandidates = Math.min(15, moves.length);
  } else if (depth === 2) {
    maxCandidates = Math.min(20, moves.length);
  } else {
    // depth === 1: 限制候选数避免最后一层过多无效计算
    maxCandidates = Math.min(25, moves.length);
  }

  if (moves.length > maxCandidates) {
    moves = quickSortMoves(simGame, moves, currentPlayer, maxCandidates);
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    const origAlpha = alpha;
    for (let i = 0; i < moves.length; i++) {
      if (searchAborted) break;

      const result = simGame.makeMove(moves[i].row, moves[i].col, currentPlayer);
      if (!result) continue;

      let val;
      if (result.gameOver) {
        val = (result.winner === aiColor) ? 100000 : -100000;
      } else {
        val = minimax(simGame, config, aiColor, depth - 1, false, alpha, beta);
      }

      simGame.undoMove(result.undoLog);

      if (val > maxEval) maxEval = val;
      if (maxEval >= beta) break; // Beta cutoff
      if (maxEval > alpha) alpha = maxEval;
    }

    // 存入 TT
    if (!searchAborted) {
      let flag;
      if (maxEval >= beta) flag = TT_LOWER;       // Beta cutoff: 真实值 >= maxEval
      else if (maxEval <= origAlpha) flag = TT_UPPER; // 未提升 alpha: 真实值 <= maxEval
      else flag = TT_EXACT;
      storeTT(hashLo, hashHi, depth, maxEval, flag);
    }

    return maxEval;
  } else {
    let minEval = Infinity;
    const origBeta = beta;
    for (let i = 0; i < moves.length; i++) {
      if (searchAborted) break;

      const result = simGame.makeMove(moves[i].row, moves[i].col, currentPlayer);
      if (!result) continue;

      let val;
      if (result.gameOver) {
        val = (result.winner === aiColor) ? 100000 : -100000;
      } else {
        val = minimax(simGame, config, aiColor, depth - 1, true, alpha, beta);
      }

      simGame.undoMove(result.undoLog);

      if (val < minEval) minEval = val;
      if (minEval <= alpha) break; // Alpha cutoff
      if (minEval < beta) beta = minEval;
    }

    // 存入 TT
    if (!searchAborted) {
      let flag;
      if (minEval <= alpha) flag = TT_UPPER;       // Alpha cutoff: 真实值 <= minEval
      else if (minEval >= origBeta) flag = TT_LOWER; // 未降低 beta: 真实值 >= minEval
      else flag = TT_EXACT;
      storeTT(hashLo, hashHi, depth, minEval, flag);
    }

    return minEval;
  }
}

// === Move Ordering（顶层候选位置排序） ===

function presortMoves(simGame, moves, aiColor, maxCount) {
  const opponentColor = (aiColor === COLOR_RED) ? COLOR_BLUE : COLOR_RED;
  const counts = simGame.counts;
  const colors = simGame.colors;
  const capacities = simGame.capacities;
  const neighborsTable = simGame.neighborsTable;
  const boardSize = simGame.boardSize;
  const phase = getGamePhase(simGame);

  const scored = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const idx = move.row * boardSize + move.col;
    let priority = 0;

    // 1. 能立即触发爆炸（最高优先级）
    if (colors[idx] === aiColor && counts[idx] === capacities[idx] - 1) {
      priority += 100;
    }

    // 2. 己方 count = capacity-2（接近临界格）
    if (colors[idx] === aiColor && counts[idx] >= capacities[idx] - 2) {
      priority += 50;
    }

    // 3. 对方格子的邻居（进攻位）
    const neighbors = neighborsTable[idx];
    for (let j = 0; j < neighbors.length; j++) {
      if (colors[neighbors[j]] === opponentColor) {
        priority += 20;
        if (counts[neighbors[j]] === capacities[neighbors[j]] - 1) {
          priority += 30;
        }
        break;
      }
    }

    // 4. 己方格子的邻居（扩张位）
    for (let j = 0; j < neighbors.length; j++) {
      if (colors[neighbors[j]] === aiColor) {
        priority += 5;
        break;
      }
    }

    // 5. 位置价值：角 > 边 > 中间
    if (capacities[idx] === 2) priority += 15;
    else if (capacities[idx] === 3) priority += 8;
    else priority += 3;

    // === 开局阶段增强 ===
    if (phase === 'opening') {
      if (capacities[idx] === 2) priority += 25;

      if (colors[idx] === aiColor) {
        priority += 15;
        if (counts[idx] === capacities[idx] - 2) priority += 20;
      }

      if (colors[idx] === COLOR_EMPTY) {
        for (let j = 0; j < neighbors.length; j++) {
          if (colors[neighbors[j]] === opponentColor) {
            priority += 15;
            break;
          }
        }
      }
    }

    // === 中局阶段增强 ===
    if (phase === 'midgame') {
      if (colors[idx] === aiColor) {
        priority += 12;
        if (counts[idx] === capacities[idx] - 2) priority += 15;
      }

      if (colors[idx] === COLOR_EMPTY) {
        let adjOp = false, adjAi = false;
        for (let j = 0; j < neighbors.length; j++) {
          if (colors[neighbors[j]] === opponentColor) adjOp = true;
          if (colors[neighbors[j]] === aiColor) adjAi = true;
        }
        if (adjOp) priority += 12;
        if (adjAi) priority += 5;
        if (!adjOp && !adjAi) priority -= 8;
      }
    }

    scored.push({ move, priority });
  }

  scored.sort((a, b) => b.priority - a.priority);

  const result = [];
  const limit = Math.min(maxCount, scored.length);
  for (let i = 0; i < limit; i++) {
    result.push(scored[i].move);
  }
  return result;
}

/**
 * 困难难度：迭代加深 Minimax，时间限制 800ms
 * 基础深度 2，有余裕可提升至 3
 */
function computeHard(simGame, config, aiColor) {
  const moves = getLegalMoves(simGame, aiColor);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const boardSize = simGame.boardSize;
  let candidates = moves;

  // 大棋盘限制候选数
  if (boardSize >= 17 && candidates.length > 25) {
    candidates = presortMoves(simGame, candidates, aiColor, 25);
  } else if (boardSize >= 13 && candidates.length > 30) {
    candidates = presortMoves(simGame, candidates, aiColor, 30);
  } else {
    candidates = presortMoves(simGame, candidates, aiColor, candidates.length);
  }

  // 初始化搜索控制
  searchStartTime = performance.now();
  searchTimeLimit = 800; // 困难模式 800ms 时间预算
  searchAborted = false;
  nodesSearchedGlobal = 0;

  // 清空 TT（每次顶层搜索时清空以避免过期数据）
  initTT();

  let bestMove = candidates[0];
  let bestScore = -Infinity;

  // 迭代加深：从深度 1 开始，最大深度 3
  const maxIterDepth = boardSize <= 11 ? 3 : 2;

  for (let iterDepth = 1; iterDepth <= maxIterDepth; iterDepth++) {
    if (searchAborted) break;

    let iterBestMove = candidates[0];
    let iterBestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (searchAborted) break;

      const result = simGame.makeMove(candidates[i].row, candidates[i].col, aiColor);
      if (!result) continue;
      nodesSearchedGlobal++;

      if (result.gameOver && result.winner === aiColor) {
        simGame.undoMove(result.undoLog);
        return candidates[i]; // 立即胜利
      }

      const score = minimax(simGame, config, aiColor, iterDepth - 1, false, iterBestScore, Infinity);
      simGame.undoMove(result.undoLog);

      if (!searchAborted && score > iterBestScore) {
        iterBestScore = score;
        iterBestMove = candidates[i];
      }
    }

    // 只有完整搜索该深度后才更新最佳走法
    if (!searchAborted) {
      bestMove = iterBestMove;
      bestScore = iterBestScore;

      // 将当前最佳走法移到候选列表最前面（PV-move 优先）
      const pvIdx = candidates.indexOf(iterBestMove);
      if (pvIdx > 0) {
        candidates.splice(pvIdx, 1);
        candidates.unshift(iterBestMove);
      }
    }
  }

  return bestMove;
}

/**
 * 炼狱难度：迭代加深 Minimax，时间限制 2000ms
 * 根据棋盘大小动态调整最大搜索深度
 */
function computeHell(simGame, config, aiColor) {
  const moves = getLegalMoves(simGame, aiColor);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const boardSize = simGame.boardSize;

  // 动态最大搜索深度和候选数
  let maxIterDepth, maxCandidates;
  if (boardSize <= 9) {
    maxIterDepth = 6; // 小棋盘可以搜索很深
    maxCandidates = moves.length;
  } else if (boardSize <= 11) {
    maxIterDepth = 5;
    maxCandidates = moves.length;
  } else if (boardSize <= 15) {
    maxIterDepth = 4;
    maxCandidates = Math.min(20, moves.length);
  } else {
    maxIterDepth = 3;
    maxCandidates = Math.min(15, moves.length);
  }

  // Move Ordering
  let candidates = presortMoves(simGame, moves, aiColor, maxCandidates);

  // 初始化搜索控制
  searchStartTime = performance.now();
  searchTimeLimit = 2000; // 炼狱模式 2000ms 时间预算
  searchAborted = false;
  nodesSearchedGlobal = 0;

  // 清空 TT
  initTT();

  let bestMove = candidates[0];
  let bestScore = -Infinity;

  // 迭代加深
  for (let iterDepth = 1; iterDepth <= maxIterDepth; iterDepth++) {
    if (searchAborted) break;

    // 检查时间是否充裕（如果已用时超过 60%，不再开始新的一层）
    const elapsed = performance.now() - searchStartTime;
    if (iterDepth > 2 && elapsed > searchTimeLimit * 0.6) break;

    let iterBestMove = candidates[0];
    let iterBestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (searchAborted) break;

      const result = simGame.makeMove(candidates[i].row, candidates[i].col, aiColor);
      if (!result) continue;
      nodesSearchedGlobal++;

      if (result.gameOver && result.winner === aiColor) {
        simGame.undoMove(result.undoLog);
        return candidates[i]; // 立即胜利
      }

      const score = minimax(simGame, config, aiColor, iterDepth - 1, false, iterBestScore, Infinity);
      simGame.undoMove(result.undoLog);

      if (!searchAborted && score > iterBestScore) {
        iterBestScore = score;
        iterBestMove = candidates[i];
      }
    }

    // 只有完整搜索该深度后才更新最佳走法
    if (!searchAborted) {
      bestMove = iterBestMove;
      bestScore = iterBestScore;

      // PV-move 优先
      const pvIdx = candidates.indexOf(iterBestMove);
      if (pvIdx > 0) {
        candidates.splice(pvIdx, 1);
        candidates.unshift(iterBestMove);
      }
    }
  }

  return bestMove;
}

// === Worker 消息处理 ===

self.onmessage = function (e) {
  const data = e.data;

  if (data.type === 'compute') {
    const startTime = performance.now();
    const { gameState, config, aiColor, difficulty } = data;

    // 创建模拟游戏实例
    const simGame = createSimGame(config);
    simGame.loadState(gameState);

    // 根据难度选择策略
    let move = null;

    switch (difficulty) {
      case 'easy':
        move = computeEasy(simGame, config, aiColor);
        break;
      case 'medium':
        move = computeMedium(simGame, config, aiColor);
        break;
      case 'hard':
        move = computeHard(simGame, config, aiColor);
        break;
      case 'hell':
        move = computeHell(simGame, config, aiColor);
        break;
      default:
        move = computeMedium(simGame, config, aiColor);
    }

    const timeMs = performance.now() - startTime;

    self.postMessage({
      type: 'result',
      move: move,
      stats: {
        difficulty,
        timeMs: Math.round(timeMs),
        boardSize: config.boardSize,
        nodesSearched: nodesSearchedGlobal
      }
    });
  }
};
