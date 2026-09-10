export type MistDict = {
    score: string;
    best: string;
    lives: string;
    gameOver: string;
    tryAgain: string;
    hint: string;
};

export const mistEn: MistDict = {
    score: "Score",
    best: "Best",
    lives: "Lives",
    gameOver: "Game over",
    tryAgain: "Click to try again",
    hint: "Arrow keys or A/D to move; drag also works. High score stays in localStorage.",
};

export const mistZh: MistDict = {
    score: "得分",
    best: "最高",
    lives: "命",
    gameOver: "雾散了",
    tryAgain: "点击再来",
    hint: "方向键或 A/D 移动；也可按住指针拖动。最高分写入本机，不会上传。",
};
