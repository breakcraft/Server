// Calculate mining success rate per attempt for each rock at each Mining level (1..99)
// Reads: content/scripts/skill_mining/configs/mine.dbrow
// Outputs: engine/data/mining_success_rates.csv
// Formula mirrors engine/src/engine/script/handlers/PlayerOps.ts STAT_RANDOM handler.

const fs = require('fs');
const path = require('path');

const INPUT = path.join(process.cwd(), 'content', 'scripts', 'skill_mining', 'configs', 'mine.dbrow');
const OUTPUT_DIR = path.join(process.cwd(), 'engine', 'data');
const OUTPUT = path.join(OUTPUT_DIR, 'mining_success_rates.csv');

function parseBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const m = line.match(/^\[(.+?)\]$/);
    if (m) {
      if (current) blocks.push(current);
      current = { name: m[1], data: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('data=')) {
      const rest = line.slice(5);
      const [key, ...vals] = rest.split(',');
      current.data.push({ key: key.trim(), vals: vals.map(v => v.trim()) });
    }
    // we don't need other keys (table= etc.) for this calc
  }
  if (current) blocks.push(current);
  return blocks;
}

function getField(block, key) {
  // returns first value for key
  const entry = block.data.find(d => d.key === key);
  if (!entry) return null;
  if (entry.vals.length === 1) return entry.vals[0];
  return entry.vals;
}

function toInt(x, def = 0) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
}

function calcValue(level, low, high) {
  // value = floor((low * (99 - level))/98) + floor((high * (level - 1))/98) + 1
  const a = Math.floor((low * (99 - level)) / 98);
  const b = Math.floor((high * (level - 1)) / 98);
  return a + b + 1;
}

function main() {
  const inputText = fs.readFileSync(INPUT, 'utf-8');
  const blocks = parseBlocks(inputText);

  const rows = [];
  for (const b of blocks) {
    // Only consider blocks that define ore_name and rock_successchance
    const oreName = getField(b, 'ore_name');
    const succ = getField(b, 'rock_successchance');
    if (!oreName || !succ) continue;

    const levelReq = toInt(getField(b, 'rock_level'), 1);
    const [lowStr, highStr] = Array.isArray(succ) ? succ : [succ, succ];
    const low = toInt(lowStr);
    const high = toInt(highStr);

    for (let lvl = 1; lvl <= 99; lvl++) {
      const value = calcValue(lvl, low, high);
      // Chance is success if value > random(0..255); so probability ~= clamp(value, 0..256)/256
      const clamped = Math.max(0, Math.min(value, 256));
      const prob = lvl >= levelReq ? clamped / 256 : 0; // cannot attempt below level req
      rows.push({
        block: b.name,
        ore_name: oreName,
        rock_level: levelReq,
        level: lvl,
        low,
        high,
        value,
        probability: prob
      });
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const header = ['block', 'ore_name', 'rock_level', 'level', 'low', 'high', 'value', 'probability'].join(',');
  const csv = [header]
    .concat(
      rows.map(r => [
        r.block,
        r.ore_name,
        r.rock_level,
        r.level,
        r.low,
        r.high,
        r.value,
        r.probability.toFixed(6)
      ].join(','))
    )
    .join('\n');
  fs.writeFileSync(OUTPUT, csv, 'utf-8');
  console.log(`Wrote ${rows.length} rows to ${OUTPUT}`);
}

main();

