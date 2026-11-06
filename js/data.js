/* CatchCat demo — name banks, rarities, abilities */
window.CatchData = (() => {
  const TITLES = [
    "Sir", "Dame", "Count", "Officer", "Lord", "Lady", "Captain",
    "Professor", "Duke", "Miss", "Baron", "Agent", "Mayor", "Chef"
  ];
  const ADJECTIVES = [
    "Royal", "Defiant", "Velvet", "Clover", "Croissant", "Loafus",
    "Sassy", "Midnight", "Butter", "Crispy", "Noble", "Chaos",
    "Pudding", "Whisker", "Sunny", "Stormy", "Cozy", "Mighty"
  ];
  const FOODS = [
    "Maximus", "Donut", "Stinker", "Biscuit", "Noodle", "Bagel",
    "Mochi", "Tofu", "Waffle", "Pretzel", "Dumpling", "Croissant",
    "Pancake", "Scone", "Ramen", "Latte", "Truffle", "Pickle"
  ];
  const SOLO = [
    "Loafus Maximus", "Dame Defiant Donut", "Count Royal Stinker",
    "Officer Croissant", "Sir Clover", "Hooligan", "Smoosh",
    "Sapphire", "Chaos", "Butterbean Supreme", "General Napster"
  ];

  const RARITIES = [
    { id: "Alley", weight: 45, xp: 40, coins: [4, 8] },
    { id: "Garden", weight: 28, xp: 70, coins: [7, 12] },
    { id: "Moonlit", weight: 15, xp: 110, coins: [10, 16] },
    { id: "Velvet", weight: 9, xp: 160, coins: [14, 22] },
    { id: "Golden", weight: 3, xp: 250, coins: [20, 32] }
  ];

  const TYPES = [
    "Chonky", "Orange", "Void", "Calico", "Tabby", "Tuxedo",
    "Fluffball", "Loaf", "Bean", "Stripes"
  ];

  const KEYWORDS = [
    { name: "Guard", icon: "🛡️", desc: "你的猫在这里不会被敌方诡计或技能打中。" },
    { name: "Copycat", icon: "🐱", desc: "复制上一张打出的能力，原样再来一次。" },
    { name: "Finale", icon: "🎆", desc: "最后一轮：再抽一张牌作为终局一击。" },
    { name: "Snacktime", icon: "🥫", desc: "每回合开始时，零食值 +1。" },
    { name: "Purrfect", icon: "😻", desc: "魅力判定时，额外掷一次并取较高结果。" },
    { name: "Nap", icon: "😴", desc: "跳过一回合，下回合零食与魅力翻倍。" },
    { name: "Zoomies", icon: "💨", desc: "立刻再行动一次，但本回合魅力 -2。" },
    { name: "Loaf", icon: "🍞", desc: "保持不动时，受到的伤害减半。" }
  ];

  // Lat/lng here are only the shape of the sample cluster. The map recenters
  // them on the player's fix; they are not a city to open on.
  const SAMPLE_SIGHTINGS = [
    { name: "Community Whisker", lat: 30.2741, lng: 120.1551, photo: "assets/demo-cat-1.jpg", sample: true },
    { name: "Park Loaf", lat: 30.2788, lng: 120.1482, photo: "assets/demo-cat-2.jpg", sample: true },
    { name: "Alley Bean", lat: 30.2695, lng: 120.1605, photo: "assets/demo-cat-3.jpg", sample: true }
  ];

  const DEMO_PHOTOS = [
    "assets/demo-cat-1.jpg",
    "assets/demo-cat-2.jpg",
    "assets/demo-cat-3.jpg"
  ];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function weightedRarity() {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0);
    let roll = Math.random() * total;
    for (const r of RARITIES) {
      roll -= r.weight;
      if (roll <= 0) return r;
    }
    return RARITIES[0];
  }

  function generateName(used) {
    const set = new Set(used || []);
    for (let i = 0; i < 40; i++) {
      let name;
      if (Math.random() < 0.08) {
        name = pick(SOLO);
      } else if (Math.random() < 0.5) {
        name = `${pick(TITLES)} ${pick(ADJECTIVES)}`;
      } else {
        name = `${pick(TITLES)} ${pick(ADJECTIVES)} ${pick(FOODS)}`;
      }
      if (!set.has(name)) return name;
    }
    return `${pick(TITLES)} ${pick(FOODS)} ${Math.floor(Math.random() * 90 + 10)}`;
  }

  function resolveRarity(rarity) {
    if (rarity && typeof rarity === "object" && rarity.id) return rarity;
    if (typeof rarity === "string") {
      const found = RARITIES.find((r) => r.id === rarity);
      if (found) return found;
    }
    return weightedRarity();
  }

  function makeStickerStyle() {
    const tilt = (Math.random() * 12 - 6).toFixed(1);
    const x = Math.round(18 + Math.random() * 64);
    const y = Math.round(12 + Math.random() * 76);
    const filters = [
      "sepia(0.28) saturate(1.3) hue-rotate(-10deg)",
      "saturate(0.85) hue-rotate(16deg) brightness(1.06)",
      "contrast(1.18) saturate(1.12)",
      "sepia(0.12) contrast(1.1) saturate(1.25) brightness(1.03)",
      "hue-rotate(-18deg) saturate(1.15) contrast(1.05)",
      "contrast(1.22) brightness(0.96) saturate(0.92)"
    ];
    return {
      rotate: `${tilt}deg`,
      objectPosition: `${x}% ${y}%`,
      filter: filters[Math.floor(Math.random() * filters.length)]
    };
  }

  function generateCat({ photo, lat, lng, serial, demo, usedNames, rarity }) {
    const rolled = resolveRarity(rarity);
    const kws = [];
    const pool = [...KEYWORDS];
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      kws.push(pool.splice(idx, 1)[0]);
    }
    const snack = 2 + Math.floor(Math.random() * 8);
    const charm = 2 + Math.floor(Math.random() * 9);
    const coins = rolled.coins[0] + Math.floor(Math.random() * (rolled.coins[1] - rolled.coins[0] + 1));
    return {
      id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: generateName(usedNames),
      serial,
      photo,
      rarity: rolled.id,
      type: pick(TYPES),
      keywords: kws,
      ability: kws[0] ? kws[0].desc : "一只路过的神秘猫咪。",
      snack,
      charm,
      xpGain: rolled.xp,
      coinsGain: coins,
      lat: lat ?? null,
      lng: lng ?? null,
      demo: !!demo,
      stickerStyle: demo ? makeStickerStyle() : null,
      capturedAt: Date.now()
    };
  }

  function formatSerial(n) {
    return `#${String(n).padStart(6, "0")}`;
  }

  function levelFromXp(xp) {
    return Math.max(1, Math.floor(xp / 100) + 1);
  }

  function xpProgress(xp) {
    return (xp % 100) / 100;
  }

  return {
    RARITIES, TYPES, KEYWORDS, SAMPLE_SIGHTINGS, DEMO_PHOTOS,
    generateName, generateCat, weightedRarity, formatSerial,
    levelFromXp, xpProgress, pick
  };
})();
