// ============================================================
//  WalkWorld 3D — aiContent.js  (PART 5 — Gemini Edition)
//
//  All AI calls now use Google Gemini (gemini-2.0-flash).
//  Gemini supports browser-side CORS, so no proxy needed.
//  API key is injected from GitHub Secrets via config.js.
//
//  Exports:
//  ─────────────────────────────────────────────────────────
//  getChestLoot(depth, coins, prestige, tier)
//  getCabinLore(cabinKey, depth)
//  getOreDesc(oreId, rarity)
//  getDailyShopStock(depth, prestige, ownedIds)
//  getDailyChallenges(depth, prestige)
//  getDepositHint(depth, layerName, recentOreIds, detectorTier)
// ============================================================

import { GEMINI_API_KEY } from './config.js';

const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ── Shared Gemini fetch helper ────────────────────────────────
async function _gemini(systemPrompt, userPrompt, maxTokens = 300) {
  // Bail early if API key isn't configured yet
  if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith('REPLACE_WITH')) {
    throw new Error('Gemini API key not configured');
  }

  const res = await fetch(GEMINI_ENDPOINT(), {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      contents: [{
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
      }],
      generationConfig: {
        temperature     : 0.9,
        maxOutputTokens : maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status);
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return text.replace(/```[\w]*\n?/g, '').trim();
}

// ── sessionStorage helpers ────────────────────────────────────
function _get(key) {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function _set(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function _secsUntilMidnight() {
  const now      = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.floor((midnight - now) / 1000);
}

// ============================================================
//  1. CHEST LOOT
// ============================================================

const CHEST_FALLBACKS = {
  surface: { ore_id: 'coal',    ore_count: 2, bonus_coins: 30,  flavour_text: 'Dusty and forgotten — but still valuable.' },
  shallow: { ore_id: 'copper',  ore_count: 2, bonus_coins: 60,  flavour_text: 'Someone cached this a long time ago.' },
  mid:     { ore_id: 'gold',    ore_count: 2, bonus_coins: 120, flavour_text: 'A faint warmth rises from the coins inside.' },
  deep:    { ore_id: 'ruby',    ore_count: 1, bonus_coins: 200, flavour_text: 'The chest trembles as you pry it open.' },
  void:    { ore_id: 'diamond', ore_count: 1, bonus_coins: 400, flavour_text: 'It pulses like something alive.' },
};

function _chestFallback(depth) {
  if (depth < 15)  return CHEST_FALLBACKS.surface;
  if (depth < 45)  return CHEST_FALLBACKS.shallow;
  if (depth < 100) return CHEST_FALLBACKS.mid;
  if (depth < 200) return CHEST_FALLBACKS.deep;
  return CHEST_FALLBACKS.void;
}

export async function getChestLoot(depth, coins, prestige, tier) {
  const band     = Math.floor(depth / 30) * 30;
  const cacheKey = `ww_chest_${tier}_${band}`;
  const cached   = _get(cacheKey);
  if (cached) return cached;

  const ORES_BY_DEPTH =
    depth < 15  ? 'coal, copper'                    :
    depth < 45  ? 'copper, iron, tin'               :
    depth < 70  ? 'iron, gold, emerald'             :
    depth < 120 ? 'sapphire, ruby'                  :
    depth < 180 ? 'amethyst, diamond'               :
                  'diamond, void_crystal, sunstone';

  const system = 'You are a loot generator for WalkWorld 3D, a 3D multiplayer mining game. Return ONLY valid JSON — no markdown, no extra text.';
  const user   =
    `Player stats: depth=${depth}m, coins=${Math.round(coins)}, prestige=${prestige || 0}. ` +
    `Chest tier: ${tier}. Available ores at this depth: ${ORES_BY_DEPTH}. ` +
    `Return exactly: {"ore_id":"<one of the listed ores>","ore_count":<1-4>,"bonus_coins":<10-500>,"flavour_text":"<one evocative sentence max 12 words>"}`;

  try {
    const raw    = await _gemini(system, user, 180);
    const result = JSON.parse(raw);
    if (!result.ore_id || typeof result.bonus_coins !== 'number') throw new Error('bad shape');
    result.ore_count   = Math.max(1, Math.min(4, result.ore_count ?? 1));
    result.bonus_coins = Math.max(5, Math.min(800, result.bonus_coins));
    _set(cacheKey, result);
    return result;
  } catch {
    const fb = _chestFallback(depth);
    _set(cacheKey, fb);
    return fb;
  }
}

// ============================================================
//  2. CABIN LORE
// ============================================================

const CABIN_LORE_FALLBACKS = [
  'The walls are scratched with tally marks. Whoever lived here counted every ore they found.',
  'A faded map pinned to the wall shows three X marks — all below 100m.',
  'Half-eaten rations and a broken lantern. They left in a hurry.',
  'Tools stacked neatly in the corner. This miner was careful. Methodical.',
  'The floor is worn smooth in a path from door to shaft entrance. Thousands of trips.',
  'Scrawled in the dust: "The veins run deeper than the maps say. Keep going."',
];

let _cabinFallbackIdx = 0;

export async function getCabinLore(cabinKey, depth) {
  const cacheKey = `ww_cabin_${cabinKey}`;
  const cached   = _get(cacheKey);
  if (cached) return cached;

  const layerName =
    depth < 18  ? 'Clay'       :
    depth < 42  ? 'Stone'      :
    depth < 65  ? 'Sandstone'  :
    depth < 110 ? 'Dark Stone' :
    depth < 160 ? 'Obsidian'   :
    depth < 250 ? 'Dense Ore'  : 'The Void';

  const system = 'You are a writer for WalkWorld 3D, a multiplayer mining game. Write immersive in-world text. Be concise.';
  const user   =
    `Write a 2-sentence miner's log for an underground cabin at ${depth}m in the ${layerName} layer. ` +
    `Hint at something interesting nearby (a vein, a creature noise, a mysterious structure). ` +
    `Write in first person, past tense. Max 28 words total. No quotes.`;

  try {
    const lore  = await _gemini(system, user, 120);
    const clean = lore.replace(/^[\"']|[\"']$/g, '').trim();
    _set(cacheKey, clean);
    return clean;
  } catch {
    const fb = CABIN_LORE_FALLBACKS[_cabinFallbackIdx++ % CABIN_LORE_FALLBACKS.length];
    _set(cacheKey, fb);
    return fb;
  }
}

// ============================================================
//  3. ORE DISCOVERY DESCRIPTIONS
// ============================================================

const ORE_DESC_FALLBACKS = {
  coal        : 'Sooty black — burns well.',
  copper      : 'Warm orange veins run through the rock.',
  iron        : 'Heavy and reliable — the workhorse of metals.',
  tin         : 'Dull but useful. Good for mixing.',
  gold        : 'A warm gleam in the dark. Worth more than it looks.',
  emerald     : 'Vivid green light floods the shaft walls.',
  sapphire    : 'Deep blue clarity — cold to the touch.',
  ruby        : 'It glows faintly, like a coal that never cools.',
  amethyst    : 'A regal purple cluster, half-buried in stone.',
  diamond     : 'A flawless crystal catches the light.',
  void_crystal: 'It hums at a frequency you feel in your teeth.',
  sunstone    : 'Warm, impossibly bright — like holding a captured star.',
};

export async function getOreDesc(oreId, rarity) {
  const cacheKey = `ww_oredesc_${oreId}`;
  const cached   = _get(cacheKey);
  if (cached) return cached;

  const system = 'You are a writer for WalkWorld 3D. Write terse, evocative one-liners about ore discoveries.';
  const user   =
    `Write one short discovery line for finding ${oreId.replace(/_/g,' ')} ore (rarity: ${rarity}). ` +
    `Max 10 words. No ore name in the line. No punctuation at end. Evocative, sensory.`;

  try {
    const desc  = await _gemini(system, user, 80);
    const clean = desc.replace(/^[\"'—\-\s]+|[\"'—\-\s]+$/g, '').trim();
    _set(cacheKey, clean);
    return clean;
  } catch {
    const fb = ORE_DESC_FALLBACKS[oreId] ?? 'Something shines in the rock.';
    _set(cacheKey, fb);
    return fb;
  }
}

// ============================================================
//  4. DAILY SHOP STOCK
// ============================================================

function _dailyCacheKey(depth, prestige) {
  const d = new Date();
  const dateStr = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const depthBand = Math.floor(depth / 50) * 50;
  return `ww_daily_${dateStr}_d${depthBand}_p${prestige || 0}`;
}

const DAILY_FALLBACKS = [
  { id:'ore_magnet_5',  name:'Ore Magnet',        emoji:'🧲', desc:'Triple ore roll chance for 5 minutes.',        price:1200, type:'consumable', colorHex:'#cc4444', effect:'ore_magnet',  hoursLeft:24 },
  { id:'depth_boots',   name:'Depth Boots',        emoji:'👢', desc:'+20% move speed underground.',                 price:500,  type:'upgrade',    colorHex:'#4488cc', effect:'depth_boots', hoursLeft:24 },
  { id:'dynamite_3',    name:'Dynamite ×3',        emoji:'💣', desc:'Instant 4-punch dig. Satisfying.',            price:320,  type:'consumable', colorHex:'#dd6622', effect:'dynamite',    hoursLeft:18 },
  { id:'headlamp',      name:'Headlamp',            emoji:'🔦', desc:'Player spotlight — needed below 65m.',        price:200,  type:'upgrade',    colorHex:'#ffdd44', effect:'headlamp',    hoursLeft:24 },
  { id:'void_magnet',   name:'Void Magnet',         emoji:'🌀', desc:'5× rare ore chance for 3 minutes.',          price:5000, type:'consumable', colorHex:'#9900ff', effect:'void_magnet', hoursLeft:12 },
  { id:'mystery_bundle',name:'Mystery Bundle',      emoji:'🎁', desc:'3 items chosen for your current depth.',      price:380,  type:'bundle',     colorHex:'#3366aa', items:['dynamite_3','ore_magnet_5','headlamp'], hoursLeft:6 },
  { id:'moonstone_skin',name:'Moonstone Pick Skin', emoji:'🌙', desc:'Soft blue glow on every dig. Cosmetic only.', price:800,  type:'cosmetic',   colorHex:'#aaccff', hoursLeft:12 },
  { id:'crystal_helm',  name:'Crystal Helm',        emoji:'💠', desc:'Geo crystal crafted into a wearable hat.',   price:1500, type:'cosmetic',   colorHex:'#00dddd', hoursLeft:24 },
];

export async function getDailyShopStock(depth, prestige, ownedIds = []) {
  const cacheKey = _dailyCacheKey(depth, prestige);
  const cached   = _get(cacheKey);
  if (cached) return cached;

  const hoursLeft = Math.ceil(_secsUntilMidnight() / 3600);
  const layerName =
    depth < 18  ? 'Clay'       :
    depth < 42  ? 'Stone'      :
    depth < 65  ? 'Sandstone'  :
    depth < 110 ? 'Dark Stone' :
    depth < 160 ? 'Obsidian'   :
    depth < 250 ? 'Dense Ore'  : 'The Void';

  const system =
    'You are a shop curator for WalkWorld 3D, a multiplayer mining game. ' +
    'Return ONLY valid JSON — no markdown, no extra text.';
  const user =
    `Player stats: depth=${depth}m (${layerName} layer), prestige=${prestige || 0}. ` +
    `Already owns: ${ownedIds.join(', ') || 'nothing'}. ` +
    `Hours until shop resets: ${hoursLeft}h. ` +
    `Generate 6 shop items appropriate for this player. Mix of consumables, upgrades, cosmetics, and 1 mystery bundle. ` +
    `Price consumables at 50-300 coins, upgrades at 200-800 coins, cosmetics at 400-1500 coins for this depth. ` +
    `Return a JSON array of exactly 6 objects, each with: ` +
    `{"id":"unique_snake_case","name":"<short>","emoji":"<1 emoji>","desc":"<max 8 words>","price":<number>,"type":"consumable"|"upgrade"|"cosmetic"|"bundle","colorHex":"<hex>","hoursLeft":<1-24>}. ` +
    `For bundles also add "items":["id1","id2","id3"]. No commentary.`;

  try {
    const raw    = await _gemini(system, user, 600);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 3) throw new Error('bad shape');
    const items = parsed.slice(0, 8).map(item => ({
      id:        String(item.id    || 'item_' + Math.random().toString(36).slice(2)),
      name:      String(item.name  || 'Mystery Item'),
      emoji:     String(item.emoji || '📦'),
      desc:      String(item.desc  || ''),
      price:     Math.max(10, Math.min(9999, Number(item.price) || 200)),
      type:      ['consumable','upgrade','cosmetic','bundle'].includes(item.type) ? item.type : 'consumable',
      colorHex:  String(item.colorHex || '#445566'),
      hoursLeft: Math.max(1, Math.min(24, Number(item.hoursLeft) || hoursLeft)),
      items:     Array.isArray(item.items) ? item.items : undefined,
      effect:    item.effect ? String(item.effect) : undefined,
    }));
    _set(cacheKey, items);
    return items;
  } catch {
    _set(cacheKey, DAILY_FALLBACKS);
    return DAILY_FALLBACKS;
  }
}

// ============================================================
//  5. DAILY CHALLENGES
// ============================================================

const CHALLENGE_FALLBACKS = [
  { id:'ch_coal_rush', emoji:'⛏', title:'Coal Rush', description:'Mine 15 Coal ore today.', type:'mine_count', count:15, ore_id:'coal', reward_coins:120, reward_desc:'+120 coins' },
  { id:'ch_go_deep',   emoji:'⬇', title:'Go Deep',   description:'Reach 40m underground.', type:'reach_depth', depth:40, reward_coins:200, reward_desc:'+200 coins' },
  { id:'ch_earn_500',  emoji:'💰', title:"Day's Pay", description:'Earn 500 coins in one session.', type:'earn_coins', coins:500, reward_coins:100, reward_desc:'+100 coins' },
];

function _dailyChallengeCacheKey(prestige) {
  const d = new Date();
  const ds = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  return `ww_challenges_${ds}_p${prestige || 0}`;
}

export async function getDailyChallenges(depth, prestige) {
  const cacheKey = _dailyChallengeCacheKey(prestige);
  const cached   = _get(cacheKey);
  if (cached) return cached;

  const layerName =
    depth < 18  ? 'Clay'       :
    depth < 42  ? 'Stone'      :
    depth < 65  ? 'Sandstone'  :
    depth < 110 ? 'Dark Stone' :
    depth < 160 ? 'Obsidian'   :
    depth < 250 ? 'Dense Ore'  : 'The Void';

  const availableOres =
    depth < 18  ? 'coal, copper'                        :
    depth < 42  ? 'coal, copper, iron'                  :
    depth < 65  ? 'coal, iron, tin, gold'               :
    depth < 110 ? 'iron, gold, emerald, sapphire'       :
    depth < 160 ? 'gold, sapphire, ruby'                :
    depth < 250 ? 'ruby, amethyst, diamond'             : 'amethyst, diamond, void_crystal';

  const system =
    'You are a daily challenge generator for WalkWorld 3D, a 3D multiplayer mining game. ' +
    'Return ONLY valid JSON — no markdown, no extra text.';

  const user =
    `Player is at ${depth}m in the ${layerName} layer, prestige ${prestige || 0}. ` +
    `Available ores at this depth: ${availableOres}. ` +
    `Generate exactly 3 daily challenges. Make them varied: one easy, one medium, one hard. ` +
    `Use these types: "find_ore" (needs ore_id + count), "reach_depth" (needs depth number), ` +
    `"mine_count" (needs count, any ore), "earn_coins" (needs coins amount). ` +
    `Return a JSON array of 3 objects each with: ` +
    `{"id":"unique_snake_case","emoji":"<1 emoji>","title":"<3-4 words>","description":"<max 8 words>",` +
    `"type":"find_ore"|"reach_depth"|"mine_count"|"earn_coins",` +
    `"ore_id":"<snake_case, only for find_ore/mine_count>",` +
    `"count":<number>,"depth":<number>,"coins":<number>,"reward_coins":<50-800>,"reward_desc":"<+X coins>"}. ` +
    `No commentary.`;

  try {
    const raw    = await _gemini(system, user, 500);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 3) throw new Error('bad shape');

    const VALID_TYPES = ['find_ore', 'reach_depth', 'mine_count', 'earn_coins'];
    const challenges  = parsed.slice(0, 3).map((ch, i) => ({
      id:           String(ch.id || `ch_${i}_${Date.now()}`),
      emoji:        String(ch.emoji || '⛏'),
      title:        String(ch.title || 'Challenge'),
      description:  String(ch.description || ''),
      type:         VALID_TYPES.includes(ch.type) ? ch.type : 'mine_count',
      ore_id:       ch.ore_id  ? String(ch.ore_id)                            : undefined,
      count:        ch.count   ? Math.max(1,   Math.min(200,   Number(ch.count)))   : undefined,
      depth:        ch.depth   ? Math.max(5,   Math.min(300,   Number(ch.depth)))   : undefined,
      coins:        ch.coins   ? Math.max(50,  Math.min(50000, Number(ch.coins)))   : undefined,
      reward_coins: Math.max(50, Math.min(800, Number(ch.reward_coins) || 150)),
      reward_desc:  String(ch.reward_desc || '+150 coins'),
    }));
    _set(cacheKey, challenges);
    return challenges;
  } catch {
    _set(cacheKey, CHALLENGE_FALLBACKS);
    return CHALLENGE_FALLBACKS;
  }
}

// ============================================================
//  6. DEPOSIT INTELLIGENCE
// ============================================================

const DEPOSIT_HINT_FALLBACKS = [
  'Faint metallic resonance to your east.',
  'Something dense lies below — keep digging.',
  'Multiple signatures detected nearby.',
  'The detector hums — ore cluster within 20m.',
  'Signal weak — try a different direction.',
];

let _depositFallbackIdx   = 0;
let _lastDepositHintTime  = 0;
let _lastDepositHintText  = null;

export async function getDepositHint(depth, layerName, recentOreIds = [], detectorTier = 1) {
  const now = Date.now();
  if (_lastDepositHintText && (now - _lastDepositHintTime) < 90_000) {
    return _lastDepositHintText;
  }

  const detailLevel =
    detectorTier >= 3 ? 'Include the ore type and hint at vein size (small/large).' :
    detectorTier >= 2 ? 'Include the ore type but not exact amounts.'               :
                        'Do NOT name the ore type — only hint at distance/direction.';

  const recentCtx = recentOreIds.length
    ? `Player recently found: ${[...new Set(recentOreIds)].join(', ')}.`
    : 'Player has found no ore yet in this session.';

  const system = 'You are the internal voice of an ore detector in WalkWorld 3D. Write atmospheric, terse sensor readouts.';
  const user   =
    `Detector tier: ${detectorTier}. Player depth: ${depth}m (${layerName} layer). ${recentCtx} ` +
    `Write ONE short ore detector readout for what might be nearby. ${detailLevel} ` +
    `Max 10 words. Sensor/technical tone with slight mystery. No punctuation at end.`;

  try {
    const hint  = await _gemini(system, user, 80);
    const clean = hint.replace(/^["""''—\-\s]+|["""''—\-\s]+$/g, '').trim();
    _lastDepositHintTime = now;
    _lastDepositHintText = clean;
    return clean;
  } catch {
    const fb = DEPOSIT_HINT_FALLBACKS[_depositFallbackIdx++ % DEPOSIT_HINT_FALLBACKS.length];
    _lastDepositHintTime = now;
    _lastDepositHintText = fb;
    return fb;
  }
}
