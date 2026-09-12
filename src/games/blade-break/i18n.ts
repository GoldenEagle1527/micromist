export type BladeDict = {
    setupTitle: string;
    setupHint: (fights: number) => string;
    ruleAp: string;
    rulePoise: string;
    ruleRun: (fights: number) => string;
    ruleFusion: string;
    start: string;
    backSetup: string;
    playAgain: string;
    abandon: string;
    confirmCancel: string;
    progress: (cur: number, total: number) => string;
    poise: string;
    block: string;
    turn: string;
    cost: string;
    ap: string;
    costSpend: (n: number) => string;
    playCard: string;
    endTurn: string;
    handHint: string;
    pressPlay: string;
    tapAgain: string;
    enemyAria: string;
    playerAria: string;
    broken: string;
    brokenBanner: string;
    staggerFlash: string;
    fightWon: string;
    fightLost: string;
    intentKicker: string;
    intentWindupSub: (n: number) => string;
    intentNone: string;
    intentAttack: (n: number) => string;
    intentHeavy: (n: number) => string;
    intentDefend: (n: number) => string;
    intentWindup: (n: number) => string;
    intentStrike: (n: number) => string;
    intentThorns: (n: number) => string;
    intentArmor: (n: number) => string;
    intentHex: (n: number) => string;
    intentHeal: (n: number) => string;
    intentDiscard: (n: number) => string;
    intentShatterBlock: (n: number) => string;
    statusThorns: (n: number) => string;
    statusArmor: (n: number) => string;
    statusPoison: (n: number) => string;
    rewardTitle: string;
    rewardHint: string;
    rewardCard: string;
    rewardPassive: string;
    restTitle: string;
    restHint: string;
    restHeal: (n: number) => string;
    restRemove: string;
    restRemoveHint: string;
    restFuse: string;
    restFuseHint: string;
    restSkip: string;
    restHealed: string;
    restRemoved: string;
    fuseRecipesTitle: string;
    fusePicked: (n: number) => string;
    fuseSuccess: (name: string) => string;
    fuseFail: {
      wrong_phase: string;
      not_found: string;
      same_card: string;
      no_recipe: string;
    };
    attacksThisTurn: (n: number) => string;
    runWonTitle: string;
    runWonBody: (fights: number) => string;
    runLostTitle: string;
    runLostBody: string;
    playFail: {
      no_ap: string;
      not_in_hand: string;
      precondition: string;
      wrong_phase: string;
      unknown_card: string;
    };
    cards: Record<
      string,
      { name: string; desc: string }
    >;
    passives: Record<string, { name: string; desc: string }>;
    enemies: Record<string, string>;
    enemyBlurb: Record<string, string>;
    /** Run rule of the blade */
    rules: Record<string, { name: string; desc: string }>;
    ruleBanner: (name: string) => string;
    variants: Record<string, string>;
    eliteTag: string;
    nemesisTag: string;
    rarity: Record<string, string>;
    pathTitle: string;
    pathHint: string;
    pathOptions: Record<string, { title: string; desc: string }>;
    eventTitle: Record<string, string>;
    eventBody: Record<string, string>;
    eventChoices: Record<string, string[]>;
    eventToasts: Record<string, string>;
    restVariants: Record<string, string>;
    restForgeNoHeal: string;
    restMedicHint: string;
    breakChain: (n: number) => string;
    breakChainDraw: string;
    breakChainAp: string;
    breakEchoFlash: string;
    flurryLawFlash: string;
    highlightsTitle: string;
    highlightMaxHit: (n: number) => string;
    highlightBreaks: (n: number) => string;
    highlightMinHp: (n: number) => string;
    highlightPoisonKills: (n: number) => string;
    highlightMaxAttacks: (n: number) => string;
    secretRevealed: (name: string) => string;
    secretClue: string;
    secretRecipesTitle: string;
    rewardHintBlood: string;
};

export const bladeEn: BladeDict = {
    setupTitle: "Blade Break",
    setupHint: (fights) =>
      `A short ${fights}-fight solo roguelike: 3 AP and draw 5 each turn. Read telegraphs, shatter poise, interrupt the strike. Plunder unique loot from each foe.`,
    ruleAp: "3 AP per turn. Play cards, then End Turn to resolve the enemy intent.",
    rulePoise: "Poise to 0 cancels the current intent, skips their action, and they take double damage until that skipped resolve ends.",
    ruleRun: (fights) =>
      `${fights} fights with two rests. After each win pick 1 of 3 rewards — beaten foes bias the spoils. Rest sites let you heal, remove a card, or forge/fuse two cards.`,
    ruleFusion: "At rest you may Forge: pick two cards that match a recipe to merge them into one stronger card (once per rest).",
    start: "Start run",
    backSetup: "← Setup",
    playAgain: "Play again",
    abandon: "Abandon run",
    confirmCancel: "Cancel",
    progress: (cur, total) => `Fight ${cur}/${total}`,
    poise: "Poise",
    block: "Block",
    turn: "Turn",
    cost: "AP",
    ap: "AP",
    costSpend: (n) => `Costs ${n} AP`,
    playCard: "Play",
    endTurn: "End Turn",
    handHint: "Tap a card to select or deselect it. Only Play uses it. Blue pips are AP; the number on a card is its AP cost.",
    pressPlay: "Press Play to use it",
    tapAgain: "Tap again or press Play",
    enemyAria: "Enemy",
    playerAria: "Player",
    broken: "Broken",
    brokenBanner: "Broken! Intent cancelled — action skipped this turn",
    staggerFlash: "Enemy staggered!",
    fightWon: "Victory — pick a reward",
    fightLost: "Defeated…",
    intentKicker: "Next intent",
    intentWindupSub: (n) => (n <= 0 ? "Fires when this turn resolves" : `Fires in ${n} turn(s)`),
    intentNone: "No intent",
    intentAttack: (n) => `Attack ${n}`,
    intentHeavy: (n) => `Heavy ${n}`,
    intentDefend: (n) => `Defend ${n}`,
    intentWindup: (n) => `Windup → ${n}`,
    intentStrike: (n) => `Striking ${n}!`,
    intentThorns: (n) => `Thorns +${n}`,
    intentArmor: (n) => `Armor +${n}`,
    intentHex: (n) => `Hex poison ${n}`,
    intentHeal: (n) => `Heal ${n}`,
    intentDiscard: (n) => `Discard ${n}`,
    intentShatterBlock: (n) => `Shatter block → ${n}`,
    statusThorns: (n) => `Thorns ${n}`,
    statusArmor: (n) => `Armor ${n}`,
    statusPoison: (n) => `Poison ${n}`,
    rewardTitle: "Spoils",
    rewardHint: "Pick one: a card or a passive.",
    rewardCard: "Card",
    rewardPassive: "Passive",
    restTitle: "Rest site",
    restHint: "Heal, remove a card, or forge two cards into one.",
    restHeal: (n) => `Heal +${n} HP`,
    restRemove: "Remove a card",
    restRemoveHint: "Tap a card to remove (keep at least 5).",
    restFuse: "Forge / Fuse",
    restFuseHint: "Pick two cards. If they match a recipe, both are replaced by the fused card.",
    restSkip: "Skip rest",
    restHealed: "Wounds ease",
    restRemoved: "Card removed",
    fuseRecipesTitle: "Known forge recipes",
    fusePicked: (n) => `Selected ${n}/2`,
    fuseSuccess: (name) => `Forged ${name}!`,
    fuseFail: {
      wrong_phase: "Not at a rest site",
      not_found: "Card missing from deck",
      same_card: "Pick two different cards",
      no_recipe: "No forge recipe for that pair",
    },
    attacksThisTurn: (n) => `Attacks this turn: ${n}`,
    runWonTitle: "Array broken!",
    runWonBody: (fights) =>
      `All ${fights} duels cleared. Progress is saved on this device.`,
    runLostTitle: "Blade snapped",
    runLostBody: "The array held. Tune your deck and try again.",
    playFail: {
      no_ap: "Not enough AP",
      not_in_hand: "Not in hand",
      precondition: "Requirements not met",
      wrong_phase: "Cannot play now",
      unknown_card: "Unknown card",
    },
    cards: {
      strike: { name: "Strike", desc: "Deal 6 damage" },
      heavy: { name: "Heavy Strike", desc: "Deal 11 damage" },
      guard: { name: "Guard", desc: "Gain 5 block" },
      iron: { name: "Iron Guard", desc: "Gain 9 block" },
      insight: { name: "Insight", desc: "Draw 2 cards" },
      chip: { name: "Poise Chip", desc: "Deal 5 poise damage" },
      bash: { name: "Bash", desc: "Deal 4 damage and 3 poise" },
      execute: { name: "Blade Break", desc: "If Broken or enemy HP ≤40%: deal 18 ( +6 if Broken)" },
      brace: { name: "Brace", desc: "Gain 4 block and draw 1" },
      venom: { name: "Venom", desc: "Apply 3 poison to the enemy" },
      purge: { name: "Purge", desc: "Discard 1 random card, then draw 2" },
      lockpick: { name: "Lockpick", desc: "Draw 3 cards" },
      shatter: { name: "Shatter", desc: "Remove all enemy armor, then deal 4 damage" },
      riposte: { name: "Riposte", desc: "Gain 6 block; if Broken, also deal 8 damage" },
      cleanse: { name: "Cleanse", desc: "Remove your poison and gain 5 block" },
      venomStrike: { name: "Venom Strike", desc: "Deal 5 damage and apply 2 poison" },
      crush: { name: "Crush", desc: "Deal 5 damage and 6 poise" },
      fortress: { name: "Fortress", desc: "Gain 7 block and draw 1" },
      cycle: { name: "Cycle", desc: "Discard 1 random, then draw 3" },
      flurry: { name: "Flurry", desc: "If ≥2 attacks played this turn: deal 10" },
      guardBreak: {
        name: "Guard Break",
        desc: "Need ≥8 block. Deal 12 and spend all block; deal 14 if enemy is armored",
      },
      overbreak: { name: "Overbreak", desc: "Deal 10 damage and 8 poise; +8 damage if Broken" },
      toxinWave: { name: "Toxin Wave", desc: "Apply 4 poison and draw 1" },
      ironPulse: { name: "Iron Pulse", desc: "Gain 6 block and deal 4 poise" },
    },
    passives: {
      vitality: { name: "Vitality", desc: "+8 max HP and heal 8 now" },
      ironSkin: { name: "Iron Skin", desc: "Start each fight with 4 block" },
      shatterEdge: { name: "Shatter Edge", desc: "+1 poise whenever you deal HP or poise damage" },
      secondWind: { name: "Second Wind", desc: "Heal 6 after each fight win" },
      keenEye: { name: "Keen Eye", desc: "Draw +1 on the first turn of each fight" },
      toxin: { name: "Toxin", desc: "HP damage you deal also applies 1 poison" },
      ironLiver: { name: "Iron Liver", desc: "Poison tick damage is halved" },
      bulwark: { name: "Bulwark", desc: "Keep 50% of unspent block into the next turn" },
    },
    enemies: {
      scout: "Scout",
      rascal: "Rascal",
      acolyte: "Acolyte",
      brute: "Windup Brute",
      thorn: "Thorn Warden",
      warden: "Block Warden",
      duelist: "Duelist",
      knight: "Armored Knight",
      hexer: "Hexer",
      juggernaut: "Juggernaut",
    },
    enemyBlurb: {
      scout: "Basic kit: attack, defend, light windup.",
      rascal: "Forces discards — messes with your hand.",
      acolyte: "Light hex poison — a softer hexer.",
      brute: "Multi-turn windup into a lethal hit — break them!",
      thorn: "Applies thorns; hitting them hurts you.",
      warden: "Shatters your block then hits hard. Don't turtle.",
      duelist: "Quick consecutive stabs.",
      knight: "Stacks armor to blunt your strikes.",
      hexer: "Poisons you and heals itself — don't stall.",
      juggernaut: "Thick HP and poise; windups hit harder.",
    },

    rules: {
      breakSurge: { name: "Break Surge", desc: "Enemies have −2 poise (min 6) but hit 20% harder." },
      ironCurtain: { name: "Iron Curtain", desc: "Every foe starts with +4 armor." },
      bloodFeud: { name: "Blood Feud", desc: "Healing is halved; reward picks offer +1 option." },
      flurryLaw: { name: "Flurry Law", desc: "Your 3rd attack each turn deals +5 damage." },
      breakEcho: { name: "Break Echo", desc: "First poise break each fight grants +1 AP." },
      adverse: { name: "Adverse Tide", desc: "Unbroken foes regain +3 poise before acting; Broken takes ×3 damage." },
    },
    ruleBanner: (name) => `Rule of the Blade: ${name}`,
    variants: {
      normal: "Normal",
      frenzy: "Frenzy",
      armored: "Armored",
      twist: "Twisted",
      revenge: "Revenge",
    },
    eliteTag: "Elite",
    nemesisTag: "Nemesis",
    rarity: {
      common: "Common",
      rare: "Rare",
      epic: "Epic",
    },
    pathTitle: "Fork in the path",
    pathHint: "Choose your next step. Fights still total about seven.",
    pathOptions: {
      safeFight: { title: "Safe duel", desc: "A standard fight — steadier odds." },
      riskyElite: { title: "Risky elite", desc: "Harder foe; spoils bias rare+." },
      rest: { title: "Rest site", desc: "Heal, remove, or forge." },
      event: { title: "Strange event", desc: "A short encounter with tradeoffs." },
    },
    eventTitle: {
      woundedDuelist: "Wounded Duelist",
      mysteriousSmith: "Mysterious Smith",
      brokenAltar: "Broken Altar",
      gambler: "Roadside Gambler",
      travelingMerchant: "Traveling Merchant",
      forgottenShrine: "Forgotten Shrine",
    },
    eventBody: {
      woundedDuelist: "A bleeding fighter greets you with a half-raised blade.",
      mysteriousSmith: "Sparks fly. The smith eyes your steel — and your secrets.",
      brokenAltar: "Cracked stone hums with leftover power.",
      gambler: "Coin flips in the half-light. Fortune or folly?",
      travelingMerchant: "A cart of odds and ends. Everything has a price in blood.",
      forgottenShrine: "Dusty incense. Something still listens.",
    },
    eventChoices: {
      woundedDuelist: [
        "Help (−6 HP, gain Bash)",
        "Walk past",
        "Finish them (+4 HP, next fight +2 hit)",
      ],
      mysteriousSmith: [
        "Pay 5 HP for a rare card",
        "Ask about secret forging (reveal recipe)",
        "Leave",
      ],
      brokenAltar: [
        "Offer a random card (+4 start block next fight)",
        "Bleed 8 HP (+4 first poise next fight)",
        "Leave",
      ],
      gambler: [
        "Coin flip (+10 heal or −8 HP)",
        "High stakes (40%: gain Flurry, else −5 HP)",
        "Leave",
      ],
      travelingMerchant: [
        "Buy Iron Guard (−7 HP)",
        "Sell a random card (+8 heal)",
        "Leave",
      ],
      forgottenShrine: [
        "Pray (+12 heal, +2 start block next fight)",
        "Offer a Strike → Insight",
        "Leave",
      ],
    },
    eventToasts: {
      event_help: "You bind their wound and take Bash.",
      event_ignore: "You move on.",
      event_finish: "Cold mercy. Strength for the next fight.",
      event_smith_trade: "The smith hammers a rare card for you.",
      event_smith_clue: "A whispered recipe — secret forge unlocked.",
      event_leave: "You leave the place behind.",
      event_altar_offer: "The altar takes a card and steadies you.",
      event_altar_blood: "Blood on stone. Poise cracks easier next fight.",
      event_gamble_win: "Fortune smiles.",
      event_gamble_lose: "The coin laughs.",
      event_gamble_card: "You walk away with Flurry.",
      event_buy: "Iron Guard joins your pack.",
      event_sell: "Coinless trade — lighter deck, warmer blood.",
      event_pray: "Quiet grace fills you.",
      event_offer: "Strike becomes Insight.",
      event_offer_fail: "No Strike to offer — a small blessing instead.",
    },
    restVariants: {
      standard: "Rest site",
      forge: "Forge camp",
      medic: "Medic tent",
    },
    restForgeNoHeal: "Forge camp: healing is closed — remove or fuse.",
    restMedicHint: "Medic tent: stronger heal (cleansing focus).",
    breakChain: (n) => `Break chain ×${n}`,
    breakChainDraw: "Break chain: draw 1",
    breakChainAp: "Break chain: +2 AP",
    breakEchoFlash: "Break Echo: +1 AP",
    flurryLawFlash: "Flurry Law: +5 damage",
    highlightsTitle: "Run highlights",
    highlightMaxHit: (n) => `Biggest hit: ${n}`,
    highlightBreaks: (n) => `Poise breaks: ${n}`,
    highlightMinHp: (n) => `Lowest HP: ${n}`,
    highlightPoisonKills: (n) => `Poison kills: ${n}`,
    highlightMaxAttacks: (n) => `Most attacks in a turn: ${n}`,
    secretRevealed: (name) => `Secret forge: ${name}!`,
    secretClue: "Secret recipe revealed this run.",
    secretRecipesTitle: "Secret recipe (this run)",
    rewardHintBlood: "Blood Feud: pick 1 of 4.",
};

export const bladeZh: BladeDict = {
    setupTitle: "破阵之刃",
    setupHint: (fights) =>
      `${fights} 场对决的单机肉鸽：每回合 3 点行动力、抽 5 张牌。看穿敌人意图，击破架势以打断攻击；击败敌人可偏置战利品。`,
    ruleAp: "每回合 3 点行动力（AP）；打出卡牌会扣行动力，点「结束回合」后结算敌人意图。",
    rulePoise: "架势归零会打断当前意图、跳过敌人行动，并使其受到双倍伤害直到本应行动的那次结算结束。",
    ruleRun: (fights) =>
      `共 ${fights} 场战斗、两次休息；胜场后三选一奖励，击败的敌人会偏置战利品；歇脚处可回血、删牌或锻融合两张牌。`,
    ruleFusion: "歇脚处可「锻合」：选两张匹配配方的牌，合成一张更强的牌（每次歇脚仅一次）。",
    start: "开始闯阵",
    backSetup: "← 返回设置",
    playAgain: "再来一局",
    abandon: "放弃本局",
    confirmCancel: "取消",
    progress: (cur, total) => `战况 ${cur}/${total}`,
    poise: "架势",
    block: "格挡",
    turn: "回合",
    cost: "行动力",
    ap: "行动力",
    costSpend: (n) => `耗 ${n} 点行动力`,
    playCard: "打出",
    endTurn: "结束回合",
    handHint: "点选手牌切换选中；只有点「打出」才会出牌。蓝点是行动力，卡上数字是消耗。",
    pressPlay: "点「打出」出牌",
    tapAgain: "再点一次或按打出",
    enemyAria: "敌人",
    playerAria: "玩家",
    broken: "破阵",
    brokenBanner: "破阵！意图已打断，本回合跳过行动",
    staggerFlash: "敌人被破阵震慑！",
    fightWon: "胜！选择奖励",
    fightLost: "阵亡…",
    intentKicker: "下回合意图",
    intentWindupSub: (n) => (n <= 0 ? "本回合结算时发动" : `${n} 回合后发动`),
    intentNone: "无意图",
    intentAttack: (n) => `攻击 ${n}`,
    intentHeavy: (n) => `重击 ${n}`,
    intentDefend: (n) => `防御 ${n}`,
    intentWindup: (n) => `蓄力 → ${n}`,
    intentStrike: (n) => `即将斩击 ${n}！`,
    intentThorns: (n) => `荆棘 +${n}`,
    intentArmor: (n) => `披甲 +${n}`,
    intentHex: (n) => `施咒 毒${n}`,
    intentHeal: (n) => `回复 ${n}`,
    intentDiscard: (n) => `弃牌 ${n}`,
    intentShatterBlock: (n) => `碎挡 → ${n}`,
    statusThorns: (n) => `荆棘 ${n}`,
    statusArmor: (n) => `护甲 ${n}`,
    statusPoison: (n) => `中毒 ${n}`,
    rewardTitle: "战利品",
    rewardHint: "三选一：新卡或被动。",
    rewardCard: "卡牌",
    rewardPassive: "被动",
    restTitle: "歇脚处",
    restHint: "回血、删牌，或把两张牌锻合成一张。",
    restHeal: (n) => `疗伤 +${n} HP`,
    restRemove: "删一张牌",
    restRemoveHint: "点选要剔除的牌（牌库至少保留 5 张）。",
    restFuse: "锻合",
    restFuseHint: "点选两张牌；若匹配配方，两张都会被替换成合成牌。",
    restSkip: "不休息，继续",
    restHealed: "伤势稍缓",
    restRemoved: "已剔除一张牌",
    fuseRecipesTitle: "已知锻合配方",
    fusePicked: (n) => `已选 ${n}/2`,
    fuseSuccess: (name) => `锻合成功：${name}`,
    fuseFail: {
      wrong_phase: "不在歇脚处",
      not_found: "牌库中找不到该牌",
      same_card: "请选两张不同的牌",
      no_recipe: "这两张牌没有锻合配方",
    },
    attacksThisTurn: (n) => `本回合已打出攻击：${n}`,
    runWonTitle: "阵破！",
    runWonBody: (fights) => `${fights} 场对决全部拿下。本局进度保存在本机。`,
    runLostTitle: "刀折阵在",
    runLostBody: "这次没能破阵。调整构筑再试。",
    playFail: {
      no_ap: "行动力不足",
      not_in_hand: "不在手牌中",
      precondition: "不满足出牌条件",
      wrong_phase: "现在不能出牌",
      unknown_card: "未知卡牌",
    },
    cards: {
      strike: { name: "斩击", desc: "造成 6 点伤害" },
      heavy: { name: "重斩", desc: "造成 11 点伤害" },
      guard: { name: "格挡", desc: "获得 5 点格挡" },
      iron: { name: "铁壁", desc: "获得 9 点格挡" },
      insight: { name: "凝神", desc: "抽 2 张牌" },
      chip: { name: "削势", desc: "造成 5 点架势伤害" },
      bash: { name: "撞破", desc: "造成 4 伤害与 3 架势伤害" },
      execute: { name: "破阵斩", desc: "敌人破阵或生命≤40% 时可打出：18 伤害（破阵时 +6）" },
      brace: { name: "稳守", desc: "获得 4 格挡并抽 1 张" },
      venom: { name: "毒液", desc: "给敌人施加 3 层中毒" },
      purge: { name: "清洗", desc: "随机弃 1 张，再抽 2 张" },
      lockpick: { name: "撬锁", desc: "抽 3 张牌" },
      shatter: { name: "碎甲", desc: "移除敌人全部护甲，再造成 4 点伤害" },
      riposte: { name: "反击", desc: "获得 6 格挡；若敌人破阵，额外造成 8 伤害" },
      cleanse: { name: "清毒", desc: "移除自身中毒并获得 5 格挡" },
      venomStrike: { name: "毒斩", desc: "造成 5 伤害并施加 2 层中毒" },
      crush: { name: "碾压", desc: "造成 5 伤害与 6 架势伤害" },
      fortress: { name: "堡垒", desc: "获得 7 格挡并抽 1 张" },
      cycle: { name: "轮转", desc: "随机弃 1 张，再抽 3 张" },
      flurry: { name: "连打", desc: "本回合已打出 ≥2 张攻击牌时：造成 10 伤害" },
      guardBreak: {
        name: "破防斩",
        desc: "需要 ≥8 格挡。造成 12 伤害并耗尽格挡；若敌人有护甲则改为 14 伤害",
      },
      overbreak: { name: "过载破阵", desc: "造成 10 伤害与 8 架势；破阵时伤害 +8" },
      toxinWave: { name: "毒潮", desc: "施加 4 层中毒并抽 1 张" },
      ironPulse: { name: "铁脉", desc: "获得 6 格挡并造成 4 架势伤害" },
    },
    passives: {
      vitality: { name: "活力", desc: "最大生命 +8，并立即回复 8" },
      ironSkin: { name: "铁皮", desc: "每场战斗开始时获得 4 格挡" },
      shatterEdge: { name: "碎刃", desc: "造成生命或架势伤害时额外 1 架势伤害" },
      secondWind: { name: "回气", desc: "每场战斗胜利后回复 6 生命" },
      keenEye: { name: "锐目", desc: "每场战斗第一回合多抽 1 张" },
      toxin: { name: "毒袭", desc: "你造成的生命伤害额外施加 1 层中毒" },
      ironLiver: { name: "铁肝", desc: "中毒结算伤害减半" },
      bulwark: { name: "壁垒", desc: "未消耗的格挡保留 50% 至下回合" },
    },
    enemies: {
      scout: "斥候",
      rascal: "无赖",
      acolyte: "咒学徒",
      brute: "蓄力蛮卒",
      thorn: "荆棘守望",
      warden: "碎挡狱卒",
      duelist: "刀客",
      knight: "披甲骑士",
      hexer: "咒术师",
      juggernaut: "铁拳巨汉",
    },
    enemyBlurb: {
      scout: "试探型：攻击与防御交替，偶尔蓄力。",
      rascal: "强制弃牌，搅乱你的手牌。",
      acolyte: "轻量下毒试探，比咒术师脆一些。",
      brute: "多回合蓄力后砸出致命一击——打断它！",
      thorn: "挂上荆棘，打它会反伤。",
      warden: "先碎你的格挡再重击——别龟缩。",
      duelist: "连刺为主，出手又快又密。",
      knight: "叠护甲减伤，硬碰硬不划算。",
      hexer: "下毒与自疗，拖得越久越难受。",
      juggernaut: "厚血厚架势，蓄力伤害更高。",
    },

    rules: {
      breakSurge: { name: "破阵涌动", desc: "敌人架势 −2（最少 6），但攻击意图伤害 +20%。" },
      ironCurtain: { name: "铁幕", desc: "每场战斗敌人开局 +4 护甲。" },
      bloodFeud: { name: "血仇", desc: "回复效果减半；奖励多 1 个选项。" },
      flurryLaw: { name: "连打律", desc: "本回合第 3 张攻击牌额外 +5 伤害。" },
      breakEcho: { name: "破阵回响", desc: "每场战斗首次破阵获得 +1 行动力。" },
      adverse: { name: "逆势", desc: "未破阵的敌人行动前回复 +3 架势；破阵承伤改为 ×3。" },
    },
    ruleBanner: (name) => `本局刀律：${name}`,
    variants: {
      normal: "普通",
      frenzy: "狂化",
      armored: "披甲",
      twist: "异变",
      revenge: "复仇",
    },
    eliteTag: "精英",
    nemesisTag: "宿敌",
    rarity: {
      common: "普通",
      rare: "稀有",
      epic: "史诗",
    },
    pathTitle: "岔路",
    pathHint: "选择下一步。整局仍大约 7 场战斗。",
    pathOptions: {
      safeFight: { title: "稳妥对决", desc: "常规战斗，风险较低。" },
      riskyElite: { title: "冒险精英", desc: "更强敌人；战利品偏向稀有。" },
      rest: { title: "歇脚处", desc: "疗伤、删牌或锻合。" },
      event: { title: "奇遇", desc: "短事件，得失自选。" },
    },
    eventTitle: {
      woundedDuelist: "受伤的刀客",
      mysteriousSmith: "神秘铁匠",
      brokenAltar: "残破祭坛",
      gambler: "路边赌徒",
      travelingMerchant: "行商",
      forgottenShrine: "遗忘神龛",
    },
    eventBody: {
      woundedDuelist: "流血的刀客半举着刀看向你。",
      mysteriousSmith: "火星四溅。铁匠打量你的刃——以及你的秘密。",
      brokenAltar: "裂石仍嗡嗡作响，残留着力量。",
      gambler: "昏光里硬币翻转。是运还是劫？",
      travelingMerchant: "一车杂货。每件都用血来标价。",
      forgottenShrine: "尘封的香火。仍有什么在倾听。",
    },
    eventChoices: {
      woundedDuelist: [
        "救助（−6 HP，获得撞破）",
        "路过",
        "了结（+4 HP，下场攻击 +2）",
      ],
      mysteriousSmith: [
        "付 5 HP 换稀有牌",
        "打听秘密锻合（揭示配方）",
        "离开",
      ],
      brokenAltar: [
        "献上一张随机牌（下场开局 +4 格挡）",
        "出血 8 HP（下场首次架势 +4）",
        "离开",
      ],
      gambler: [
        "抛硬币（+10 疗伤或 −8 HP）",
        "豪赌（40% 获得连打，否则 −5 HP）",
        "离开",
      ],
      travelingMerchant: [
        "买铁壁（−7 HP）",
        "卖掉一张随机牌（+8 疗伤）",
        "离开",
      ],
      forgottenShrine: [
        "祈祷（+12 疗伤，下场开局 +2 格挡）",
        "献上斩击 → 凝神",
        "离开",
      ],
    },
    eventToasts: {
      event_help: "你替他包扎，带走了撞破。",
      event_ignore: "你继续赶路。",
      event_finish: "冷酷的慈悲。下场更狠。",
      event_smith_trade: "铁匠为你锤出一张稀有牌。",
      event_smith_clue: "一句耳语——本局秘密配方已揭示。",
      event_leave: "你离开了这里。",
      event_altar_offer: "祭坛收走一张牌，稳住了你。",
      event_altar_blood: "血沁入石。下场架势更易碎。",
      event_gamble_win: "运气站在你这边。",
      event_gamble_lose: "硬币在嘲笑。",
      event_gamble_card: "你带走了连打。",
      event_buy: "铁壁入包。",
      event_sell: "以牌换血，轻装前行。",
      event_pray: "静默的恩典流过全身。",
      event_offer: "斩击化为凝神。",
      event_offer_fail: "没有斩击可献——仍得一点小祝福。",
    },
    restVariants: {
      standard: "歇脚处",
      forge: "锻炉营地",
      medic: "医帐",
    },
    restForgeNoHeal: "锻炉营地：无法疗伤——只能删牌或锻合。",
    restMedicHint: "医帐：更强疗伤（清创侧重）。",
    breakChain: (n) => `破阵连锁 ×${n}`,
    breakChainDraw: "破阵连锁：抽 1 张",
    breakChainAp: "破阵连锁：+2 行动力",
    breakEchoFlash: "破阵回响：+1 行动力",
    flurryLawFlash: "连打律：+5 伤害",
    highlightsTitle: "本局高光",
    highlightMaxHit: (n) => `最高伤害：${n}`,
    highlightBreaks: (n) => `破阵次数：${n}`,
    highlightMinHp: (n) => `最低生命：${n}`,
    highlightPoisonKills: (n) => `毒杀：${n}`,
    highlightMaxAttacks: (n) => `单回合最多攻击：${n}`,
    secretRevealed: (name) => `秘密锻合：${name}！`,
    secretClue: "本局秘密配方已揭示。",
    secretRecipesTitle: "本局秘密配方",
    rewardHintBlood: "血仇：四选一。",
};
