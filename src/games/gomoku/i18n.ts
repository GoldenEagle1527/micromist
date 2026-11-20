export type GomokuDict = {
  setupTitle: string;
  setupHint: string;
  mode: string;
  vsAi: string;
  hotseat: string;
  difficulty: string;
  easy: string;
  normal: string;
  hard: string;
  yourColor: string;
  playBlack: string;
  playWhite: string;
  start: string;
  backSetup: string;
  undo: string;
  restart: string;
  turnBlack: string;
  turnWhite: string;
  thinking: string;
  blackWins: string;
  whiteWins: string;
  youWin: string;
  youLose: string;
  draw: string;
  confirmRestartTitle: string;
  confirmRestartBody: string;
  confirmSetupTitle: string;
  confirmSetupBody: string;
  confirmCancel: string;
  confirmOk: string;
  boardAria: string;
  emptyAria: (row: number, col: string) => string;
  stoneAria: (color: string, row: number, col: string) => string;
  black: string;
  white: string;
};

export const gomokuZh: GomokuDict = {
  setupTitle: "对局设置",
  setupHint: "十五路棋盘，黑棋先行，横、竖、斜连成五子即胜。本局为自由五子棋，没有禁手。",
  mode: "对局方式",
  vsAi: "对战 AI",
  hotseat: "热座双人",
  difficulty: "难度",
  easy: "简单",
  normal: "普通",
  hard: "困难",
  yourColor: "你执",
  playBlack: "黑棋（先手）",
  playWhite: "白棋（后手）",
  start: "开始",
  backSetup: "返回设置",
  undo: "悔棋",
  restart: "重新开始",
  turnBlack: "轮到黑棋",
  turnWhite: "轮到白棋",
  thinking: "AI 思考中…",
  blackWins: "黑棋胜",
  whiteWins: "白棋胜",
  youWin: "你赢了",
  youLose: "你输了",
  draw: "和棋",
  confirmRestartTitle: "重新开始？",
  confirmRestartBody: "当前对局进度会清除，棋盘将重新空出。",
  confirmSetupTitle: "返回设置？",
  confirmSetupBody: "当前对局进度会清除，并回到设置页。",
  confirmCancel: "取消",
  confirmOk: "确定",
  boardAria: "五子棋棋盘",
  emptyAria: (row, col) => `空点 ${col}${row}`,
  stoneAria: (color, row, col) => `${color} ${col}${row}`,
  black: "黑棋",
  white: "白棋",
};

export const gomokuEn: GomokuDict = {
  setupTitle: "Match setup",
  setupHint:
    "A 15×15 board. Black goes first; five in a row — horizontal, vertical, or diagonal — wins. Freestyle rules, no forbidden moves.",
  mode: "Mode",
  vsAi: "vs AI",
  hotseat: "Hotseat",
  difficulty: "Difficulty",
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
  yourColor: "You play",
  playBlack: "Black (first)",
  playWhite: "White (second)",
  start: "Start",
  backSetup: "Back to setup",
  undo: "Undo",
  restart: "Restart",
  turnBlack: "Black to move",
  turnWhite: "White to move",
  thinking: "AI is thinking…",
  blackWins: "Black wins",
  whiteWins: "White wins",
  youWin: "You win",
  youLose: "You lose",
  draw: "Draw",
  confirmRestartTitle: "Restart the match?",
  confirmRestartBody: "The current game will be cleared and the board reset.",
  confirmSetupTitle: "Return to setup?",
  confirmSetupBody: "The current game will be cleared, and you'll go back to setup.",
  confirmCancel: "Cancel",
  confirmOk: "OK",
  boardAria: "Gomoku board",
  emptyAria: (row, col) => `Empty point ${col}${row}`,
  stoneAria: (color, row, col) => `${color} at ${col}${row}`,
  black: "Black",
  white: "White",
};
