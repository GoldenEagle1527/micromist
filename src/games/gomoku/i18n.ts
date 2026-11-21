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
  rules: string;
  rulesClassic: string;
  rulesSeries: string;
  capturesToWin: string;
  seriesHint: string;
  pickRemove: (selected: number) => string;
  pickFlip: string;
  capturesHud: (black: number, white: number, goal: number) => string;
  roomRulesClassic: string;
  roomRulesSeries: (goal: number) => string;
};

export const gomokuZh: GomokuDict = {
  setupTitle: "对局设置",
  setupHint: "十五路棋盘，黑棋先行。经典模式连五即胜；连战则连五后提子翻子，先达到提子次数者胜。自由五子棋，没有禁手。",
  mode: "对局方式",
  vsAi: "人机对战",
  hotseat: "同屏双人",
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
  thinking: "电脑思考中…",
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
  rules: "胜负规则",
  rulesClassic: "经典（连五即胜）",
  rulesSeries: "连战（提子决胜）",
  capturesToWin: "提子次数",
  seriesHint: "连成五子后先提走自己的五子，再把对方一子翻成己方，计一次提子。",
  pickRemove: (selected) => `选择要提走的 5 子（已选 ${selected}/5）`,
  pickFlip: "选择对方一子，翻成自己的颜色",
  capturesHud: (black, white, goal) => `提子 黑 ${black} · 白 ${white} / ${goal}`,
  roomRulesClassic: "经典规则，连五即胜。",
  roomRulesSeries: (goal) => `连战 · 先提 ${goal} 次者胜。`,
};

export const gomokuEn: GomokuDict = {
  setupTitle: "Match setup",
  setupHint:
    "A 15×15 board. Black goes first. Classic mode wins on five in a row; Series mode captures after each five, and the capture target wins. Freestyle, no forbidden moves.",
  mode: "Mode",
  vsAi: "vs Computer",
  hotseat: "Pass and play",
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
  thinking: "Computer thinking…",
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
  rules: "Win condition",
  rulesClassic: "Classic (five in a row)",
  rulesSeries: "Series (captures)",
  capturesToWin: "Captures to win",
  seriesHint: "After five in a row, lift five of your stones, then flip one enemy stone. That is one capture.",
  pickRemove: (selected) => `Pick 5 stones to lift (${selected}/5)`,
  pickFlip: "Pick one enemy stone to flip to your color",
  capturesHud: (black, white, goal) => `Captures Black ${black} · White ${white} / ${goal}`,
  roomRulesClassic: "Classic rules: five in a row wins.",
  roomRulesSeries: (goal) => `Series · first to ${goal} captures wins.`,
};
