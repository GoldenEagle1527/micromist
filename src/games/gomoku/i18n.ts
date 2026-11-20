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
  online: string;
  createRoom: string;
  roomCodeLabel: (code: string) => string;
  copyLink: string;
  linkCopied: string;
  copyFailed: string;
  claimBlack: string;
  claimWhite: string;
  seatTaken: string;
  seatEmpty: string;
  onlineNow: string;
  offlineNow: string;
  you: string;
  waitingSeats: string;
  waitingBlack: string;
  waitingWhite: string;
  youAreBlack: string;
  youAreWhite: string;
  watching: string;
  roomConnecting: string;
  roomClosed: string;
  opponentLeft: string;
  yourTurn: string;
  opponentTurn: string;
  resign: string;
  rematch: string;
  rematchWaiting: string;
  leaveRoom: string;
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
  online: "联机对战",
  createRoom: "创建房间",
  roomCodeLabel: (code) => `房间 ${code}`,
  copyLink: "复制邀请链接",
  linkCopied: "链接已复制",
  copyFailed: "复制失败，请手动复制地址栏链接",
  claimBlack: "执黑",
  claimWhite: "执白",
  seatTaken: "已有人坐",
  seatEmpty: "空位",
  onlineNow: "在线",
  offlineNow: "离线",
  you: "你",
  waitingSeats: "双方入座后开局，黑棋先手。",
  waitingBlack: "等待黑棋入座…",
  waitingWhite: "等待白棋入座…",
  youAreBlack: "你执黑棋。",
  youAreWhite: "你执白棋。",
  watching: "观战中。",
  roomConnecting: "正在进入房间…",
  roomClosed: "房间已关闭。",
  opponentLeft: "对方暂时离开，可等待重连。",
  yourTurn: "轮到你落子",
  opponentTurn: "等待对方落子",
  resign: "认输",
  rematch: "再来一局",
  rematchWaiting: "已申请再来一局，等待对方同意",
  leaveRoom: "离开房间",
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
  online: "Online",
  createRoom: "Create room",
  roomCodeLabel: (code) => `Room ${code}`,
  copyLink: "Copy invite link",
  linkCopied: "Link copied",
  copyFailed: "Couldn't copy. Paste the address-bar link instead.",
  claimBlack: "Take Black",
  claimWhite: "Take White",
  seatTaken: "Taken",
  seatEmpty: "Open",
  onlineNow: "online",
  offlineNow: "offline",
  you: "You",
  waitingSeats: "The game starts once both seats are taken. Black moves first.",
  waitingBlack: "Waiting for Black to sit…",
  waitingWhite: "Waiting for White to sit…",
  youAreBlack: "You have Black.",
  youAreWhite: "You have White.",
  watching: "Spectating.",
  roomConnecting: "Joining the room…",
  roomClosed: "This room has closed.",
  opponentLeft: "Your opponent left temporarily and may reconnect.",
  yourTurn: "Your move",
  opponentTurn: "Waiting for the other player",
  resign: "Resign",
  rematch: "Rematch",
  rematchWaiting: "Rematch requested — waiting for the other player",
  leaveRoom: "Leave room",
};
