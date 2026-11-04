'use strict';
/* MHXX スキルシミュレーター スロットモデル / 護石スロット / charmLimits 回帰テスト
 * 実行: node tests/engine-slots.test.js
 *
 * MHXX には MHW のようなスロット Lv の概念が無く、「スロ3」は
 * 「3 穴」= 【3】珠 1 個 / 【2】珠 1 個 + 【1】珠 1 個 / 【1】珠 3 個 の
 * いずれも装着できる 1 つの容量 3 プールとして扱う必要がある。
 */
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; failures.push({ name, e }); console.log('FAIL  ' + name + ' :: ' + e.message); }
}

const engine = require(path.join(__dirname, '..', 'js', 'core', 'search-engine.js'));

function makeData(opt) {
  opt = opt || {};
  const parts = ['頭', '胴', '腕', '腰', '脚'];
  const armors = parts.map(function (label, i) {
    const spec = (opt.armors && opt.armors[i]) || {};
    return {
      name: spec.name || ('テスト' + label),
      part: i,
      gender: 3,
      type: 3,
      slots: spec.slots || 0,
      skills: spec.skills || {},
      defense: spec.defense != null ? spec.defense : 50 - i
    };
  });
  return {
    skills: [
      { name: '攻撃', system: '攻撃', points: 10, type: 3 },
      { name: '達人', system: '達人', points: 10, type: 3 }
    ],
    armors: armors,
    decorations: opt.decos || [],
    charms: opt.charms || []
  };
}

function search(data, options) {
  engine.setData(data);
  const opt = Object.assign({
    equipType: 1,
    requiredSkills: ['攻撃'],
    charmMode: 'none',
    maxResults: 20,
    timeLimitMs: 0,
    seed: false,
    extraSuggestions: false
  }, options || {});
  return engine.searchSync(opt);
}

function decoCount(part) {
  return (part && part.decos ? part.decos.length : 0);
}
function decoHoles(part) {
  return (part && part.decos ? part.decos.reduce(function (s, d) { return s + (d.size || 1); }, 0) : 0);
}

/* ------------------------------------------------------------------ */
/* 1. 3スロ防具 = 容量3 の 1 プール                                     */
/* ------------------------------------------------------------------ */
test('3スロ防具に【1】珠×3 を装着できる (攻撃+7 + 攻撃珠【1】x3 = 10)', function () {
  const data = makeData({
    armors: [{ slots: 3, skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data);
  assert.ok(res.results && res.results.length > 0, '解が見つかること');
  const head = res.results[0].equipments.head;
  assert.strictEqual(decoCount(head), 3, '頭に3個の装飾品が入ること（実際: ' + decoCount(head) + '）');
  assert.strictEqual(decoHoles(head), 3, '使用穴数が3であること');
  assert.ok(res.results[0].totals['攻撃'] >= 10, '攻撃ptが10以上');
});

test('3スロ防具に【2】珠1個 + 【1】珠1個 を装着できる', function () {
  const data = makeData({
    armors: [{ slots: 3, skills: { '攻撃': 7 } }],
    decos: [
      { name: '攻撃珠【2】', size: 2, skills: { '攻撃': 2 } },
      { name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }
    ]
  });
  const res = search(data);
  assert.ok(res.results && res.results.length > 0, '解が見つかること（【2】+【1】=3pt が必要）');
  const head = res.results[0].equipments.head;
  assert.strictEqual(decoCount(head), 2, '頭に2個の装飾品が入ること（実際: ' + decoCount(head) + '）');
  assert.strictEqual(decoHoles(head), 3, '使用穴数が3であること');
});

test('3スロ防具の容量を超える装着はしない (攻撃+6 に【1】x4 は不可)', function () {
  const data = makeData({
    armors: [{ slots: 3, skills: { '攻撃': 6 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data);
  assert.strictEqual(res.results.length, 0, '容量3で4pt必要なため解なし（実際: ' + res.results.length + '件）');
});

test('武器スロ3も容量3プールとして【1】珠×3 を装着できる', function () {
  const data = makeData({
    armors: [{ skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data, { weaponSlots: 3 });
  assert.ok(res.results && res.results.length > 0, '解が見つかること');
  const weapon = res.results[0].equipments.weapon;
  assert.strictEqual(decoCount(weapon), 3, '武器に3個（実際: ' + decoCount(weapon) + '）');
});

/* ------------------------------------------------------------------ */
/* 2. 護石スロット（DFS 上界枝刈り）                                    */
/* ------------------------------------------------------------------ */
test('護石3スロに【1】珠×3 を入れて発動できる (DFS上界に護石スロを含む)', function () {
  const data = makeData({
    armors: [{ skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data, {
    charmMode: 'single',
    selectedCharm: { name: '天の護石', slots: 3, skills: {} }
  });
  assert.ok(res.results && res.results.length > 0, '護石スロを使う解が見つかること');
  const charm = res.results[0].equipments.charm;
  assert.strictEqual(decoCount(charm), 3, '護石に3個（実際: ' + decoCount(charm) + '）');
});

test('護石3スロに【2】珠1個 + 【1】珠1個 を装着できる', function () {
  const data = makeData({
    armors: [{ skills: { '攻撃': 7 } }],
    decos: [
      { name: '攻撃珠【2】', size: 2, skills: { '攻撃': 2 } },
      { name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }
    ]
  });
  const res = search(data, {
    charmMode: 'single',
    selectedCharm: { name: '天の護石', slots: 3, skills: {} }
  });
  assert.ok(res.results && res.results.length > 0, '解が見つかること');
  const charm = res.results[0].equipments.charm;
  assert.strictEqual(decoCount(charm), 2, '護石に2個（実際: ' + decoCount(charm) + '）');
  assert.strictEqual(decoHoles(charm), 3, '使用穴数が3');
});

test('charmMode=all: 3スロ護石を選んだときだけ成立する構成が見つかる', function () {
  const data = makeData({
    armors: [{ skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data, {
    charmMode: 'all',
    charms: [
      { name: 'スロなし護石', slots: 0, skills: {} },
      { name: '三スロ護石', slots: 3, skills: {} }
    ]
  });
  assert.ok(res.results.length > 0, '解が見つかること');
  const r = res.results[0];
  assert.strictEqual(r.equipments.charm.slots, 3, '護石のスロ数は3（容量3）');
  assert.strictEqual(decoCount(r.equipments.charm), 3, '護石に3個（実際: ' + decoCount(r.equipments.charm) + '）');
  assert.strictEqual(r.equipments.charm.name, '三スロ護石');
});

/* ------------------------------------------------------------------ */
/* 3. 結果の整合性（容量超過が無いこと）                                */
/* ------------------------------------------------------------------ */
test('どの結果も部位の容量を超えて装飾品を詰めていない', function () {
  const data = makeData({
    armors: [
      { slots: 3, skills: { '攻撃': 2 } },
      { slots: 2, skills: { '攻撃': 1 } },
      { slots: 1 },
      { slots: 3 },
      { slots: 0 }
    ],
    decos: [
      { name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } },
      { name: '攻撃珠【2】', size: 2, skills: { '攻撃': 2 } },
      { name: '攻撃珠【3】', size: 3, skills: { '攻撃': 3 } }
    ]
  });
  const res = search(data, { maxResults: 50 });
  assert.ok(res.results.length > 0, '解が見つかること');
  res.results.forEach(function (r) {
    ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'].forEach(function (k) {
      const p = r.equipments[k];
      if (!p) return;
      const cap = (p.slotSizes || []).reduce(function (s, v) { return s + (v || 0); }, 0);
      const holes = (p.decos || []).reduce(function (s, d) { return s + (d.size || 1); }, 0);
      assert.ok(holes <= cap, k + ' 使用穴 ' + holes + ' > 容量 ' + cap);
    });
  });
});

test('1スロ防具には【1】珠を1個しか入れられない（容量1）', function () {
  const data = makeData({
    armors: [{ slots: 1, skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data, { maxResults: 50 });
  assert.strictEqual(res.results.length, 0, '容量1で3pt必要のため解なし');
});

test('胴系統倍加: 胴3スロの装飾品ptが D 倍され、容量も守られる', function () {
  const data = makeData({
    armors: [
      { slots: 0, skills: { '胴系統倍加': 1 } },
      { slots: 3, skills: { '攻撃': 1 } },
      { slots: 0, skills: { '胴系統倍加': 1 } },
      { slots: 0 },
      { slots: 0 }
    ],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  const res = search(data, { maxResults: 20 });
  assert.ok(res.results.length > 0, '解が見つかること');
  const r = res.results[0];
  const body = r.equipments.body;
  assert.strictEqual(decoCount(body), 3, '胴3スロに3個');
  assert.strictEqual(r.torsoUpCount, 2, '倍加部位2');
  assert.ok(r.totals['攻撃'] >= 10, '胴の装飾品ptが3倍され 1+9=10pt');
});

test('ネセト一式: 護石3スロの装飾品ptが2倍になり容量も守られる', function () {
  const data = {
    skills: [{ name: '攻撃', system: '攻撃', points: 8, type: 3 }],
    armors: ['ネセトカウザ', 'ネセトディルア', 'ネセトタハッド', 'ネセトヒザム', 'ネセトダラー']
      .map(function (name, i) {
        return { name: name, part: i, gender: 3, type: 3, slots: 0, skills: {}, defense: 50 - i };
      }),
    decorations: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }],
    charms: []
  };
  const res = search(data, {
    requiredSkills: ['攻撃'],
    charmMode: 'single',
    selectedCharm: { name: '天の護石', slots: 3, skills: {} }
  });
  assert.ok(res.results.length > 0, '解が見つかること');
  const r = res.results[0];
  assert.strictEqual(r.isNeset, true, 'ネセト判定');
  assert.strictEqual(decoCount(r.equipments.charm), 3, '護石3スロに3個');
  assert.ok(r.totals['攻撃'] >= 8, '護石の装飾品ptが2倍（3×2=6）+ ネセト加点2 = 8');
});

test('Worker 用ソース (buildWorkerSource) が自己完結して容量モデルで検索できる', function () {
  const data = makeData({
    armors: [{ slots: 3, skills: { '攻撃': 7 } }],
    decos: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }]
  });
  engine.setData(data);
  const src = engine.buildWorkerSource();
  assert.ok(src && typeof src === 'string', 'Worker ソースが生成される');
  const out = {};
  const fakeSelf = { postMessage: function (m) { if (m && m.type !== 'progress') out[m.type] = m; } };
  new Function('self', src)(fakeSelf);
  fakeSelf.onmessage({ data: { type: 'init', data: data } });
  assert.ok(out.ready, 'init 応答（' + (out.error ? out.error.message : '') + '）');
  fakeSelf.onmessage({ data: { type: 'search', options: {
    equipType: 1, requiredSkills: ['攻撃'], charmMode: 'none',
    maxResults: 10, timeLimitMs: 0, seed: false, extraSuggestions: false
  } } });
  assert.ok(out.result && out.result.result, 'search 応答');
  assert.ok(out.result.result.results.length > 0, 'Worker 経由でも解が見つかる');
  assert.strictEqual(out.result.result.results[0].equipments.head.decos.length, 3, 'Worker でも3個入る');
});

/* ------------------------------------------------------------------ */
/* 4. charmLimits: slot1 = 第1スキル枠 / slot2 = 第2スキル枠（護石のスロ数ではない） */
/* ------------------------------------------------------------------ */
test('charmLimits: 第1スキル枠は slot1、第2スキル枠は slot2 を参照する', function () {
  global.window = global;
  global.MHXX = global.MHXX || {};
  require(path.join(__dirname, '..', 'js', 'data', 'sim-data.js'));
  const D = global.MHXX.data;
  const t = D.charmSkillTables[98];
  assert.ok(t && t.slot1 && t.slot2, 'rarity 98 のスキル上限テーブルが存在');
  assert.strictEqual(D.charmLimits(98, 1), t.slot1, '第1スキル枠 → slot1');
  assert.strictEqual(D.charmLimits(98, 2), t.slot2, '第2スキル枠 → slot2');
  const t100 = D.charmSkillTables[100];
  assert.strictEqual(D.charmLimitsOfKind(10, 1), t100.slot1, '天の護石(kind10=rarity100) 第1枠 → slot1');
  assert.strictEqual(D.charmLimitsOfKind(10, 2), t100.slot2, '天の護石(kind10=rarity100) 第2枠 → slot2');
  assert.strictEqual(D.charmLimitsOfKind(5, 2), D.charmSkillTables[99].slot2, '女王の護石(kind5=rarity99) 第2枠 → slot2');
  assert.strictEqual(D.charmLimitsOfKind(3, 2), t.slot2, '騎士の護石(kind3=rarity98) 第2枠 → slot2');
  /* 攻撃 は rarity98 では第1枠(最大4)と第2枠(最大7)で上限が異なる */
  assert.notDeepStrictEqual(t.slot1['攻撃'], t.slot2['攻撃'], '攻撃の上限が第1枠/第2枠で異なる');
  /* 攻撃・達人は rarity100 の第1スキル枠には存在しない（第2枠専用） */
  assert.strictEqual(t100.slot1['攻撃'], undefined, '攻撃は rarity100 の第1枠に存在しない');
  assert.strictEqual(t100.slot1['達人'], undefined, '達人は rarity100 の第1枠に存在しない');
  assert.ok(t100.slot2['攻撃'] && t100.slot2['達人'], '攻撃・達人は rarity100 の第2枠に存在する');
});

test('ランダム構成100件: 容量違反もポイント不一致も無い（決定的シード）', function () {
  const SYS = ['攻撃', '達人', '匠', '業物'];
  let seed = 123456789;
  function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }

  for (let t = 0; t < 100; t++) {
    const armors = [];
    for (let p2 = 0; p2 < 5; p2++) {
      const skills = {};
      SYS.forEach(function (s) { if (rnd(10) < 3) skills[s] = rnd(5); });
      armors.push({ name: 'A' + p2 + '_' + t, part: p2, gender: 3, type: 3, slots: rnd(4), skills: skills, defense: 10 + rnd(40) });
    }
    const decos = [];
    for (let d = 0; d < 14; d++) {
      const skills = {};
      skills[SYS[rnd(SYS.length)]] = 1 + rnd(3);
      if (rnd(10) < 2) skills[SYS[rnd(SYS.length)]] = -(1 + rnd(2));
      decos.push({ name: 'D' + d + '_' + t, size: 1 + rnd(3), skills: skills });
    }
    engine.setData({
      skills: SYS.map(function (s) { return { name: s, system: s, points: 10, type: 3 }; }),
      armors: armors, decorations: decos, charms: []
    });
    const req = SYS[rnd(SYS.length)];
    const res = engine.searchSync({
      equipType: 1, requiredSkills: [req], charmMode: 'none', weaponSlots: rnd(4),
      maxResults: 5, timeLimitMs: 0, seed: false, extraSuggestions: false
    });
    res.results.forEach(function (r) {
      /* 容量違反なし */
      ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'].forEach(function (k) {
        const part = r.equipments[k];
        if (!part) return;
        const cap = (part.slotSizes || []).reduce(function (a, b) { return a + b; }, 0);
        const holes = (part.decos || []).reduce(function (a, d) { return a + (d.size || 1); }, 0);
        assert.ok(holes <= cap, '#' + t + ' ' + k + ': 穴 ' + holes + ' > 容量 ' + cap);
      });
      /* 独立再計算 */
      const D = 1 + (r.torsoUpCount || 0);
      const totals = {};
      function add(sk, m) { for (const k2 in (sk || {})) totals[k2] = (totals[k2] || 0) + sk[k2] * m; }
      ['head', 'body', 'arm', 'waist', 'legs'].forEach(function (k) {
        add(r.equipments[k].skills, k === 'body' ? D : 1);
      });
      add(r.equipments.charm.skills, r.isNeset ? 2 : 1);
      ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'].forEach(function (k) {
        const part = r.equipments[k];
        if (!part) return;
        const m = k === 'body' ? D : (k === 'charm' && r.isNeset ? 2 : 1);
        (part.decos || []).forEach(function (d) { add(d.systemSkills || d.skills, m); });
      });
      if (r.isNeset) { for (const k3 in totals) if (totals[k3] >= 1) totals[k3] += 2; }
      assert.ok((totals[req] || 0) >= 10, '#' + t + ' ' + req + ' pt 不足');
      assert.strictEqual(totals[req] || 0, r.totals[req] || 0, '#' + t + ' ' + req + ' 合計不一致');
      assert.strictEqual(engine.analyze(r)[req] || 0, r.totals[req] || 0, '#' + t + ' analyze 不一致');
    });
  }
});

/* ------------------------------------------------------------------ */
/* 5. 実データ統合テスト                                                */
/* ------------------------------------------------------------------ */
test('実データ (sim-data.js) で検索でき、結果の合計ptと容量が整合する', function () {
  global.window = global;
  global.MHXX = global.MHXX || {};
  require(path.join(__dirname, '..', 'js', 'data', 'sim-data.js'));
  const data = global.MHXX.data;
  engine.setData(data);

  const t0 = Date.now();
  const res = engine.searchSync({
    equipType: 1,
    gender: 1,
    requiredSkills: ['攻撃', '達人'],
    weaponSlots: 3,
    maxResults: 20,
    timeLimitMs: 0
  });
  const elapsed = Date.now() - t0;
  assert.ok(res.results.length > 0, '実データで解が見つかること');
  assert.ok(elapsed < 15000, '検索が 15 秒以内（実測 ' + elapsed + 'ms）');

  res.results.forEach(function (r, idx) {
    /* 部位ごとの容量チェック */
    ['head', 'body', 'arm', 'waist', 'legs', 'charm', 'weapon'].forEach(function (k) {
      const p = r.equipments[k];
      if (!p) return;
      const cap = (p.slotSizes || []).reduce(function (s, v) { return s + (v || 0); }, 0);
      const holes = (p.decos || []).reduce(function (s, d) { return s + (d.size || 1); }, 0);
      assert.ok(holes <= cap, '#' + idx + ' ' + k + ': 使用穴 ' + holes + ' > 容量 ' + cap);
    });
    /* 必須pt を満たしているか（エンジンの analyze と一致するか） */
    const totals = engine.analyze(r);
    ['攻撃', '達人'].forEach(function (sys) {
      assert.ok(r.totals[sys] >= 10, '#' + idx + ' ' + sys + ' pt=' + r.totals[sys]);
      assert.strictEqual(totals[sys], r.totals[sys], '#' + idx + ' analyze(' + sys + ') 一致');
    });
    /* 空き穴数 = 総穴数 - 使用穴数 */
    const total = (r.equipments.weapon ? (r.equipments.weapon.slotSizes || []).reduce(function (s, v) { return s + v; }, 0) : 0) +
      ['head', 'body', 'arm', 'waist', 'legs', 'charm'].reduce(function (s, k) {
        const p = r.equipments[k];
        return s + (p && p.slotSizes ? p.slotSizes.reduce(function (a, b) { return a + b; }, 0) : 0);
      }, 0);
    assert.strictEqual(r.totalSlots, total, '#' + idx + ' totalSlots');
    assert.strictEqual(r.freeSlots, r.totalSlots - r.usedSlots, '#' + idx + ' freeSlots');
  });
});

console.log('');
console.log('--- ' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed ---');
if (fail) {
  failures.forEach(function (f) { console.log('\n' + f.name + '\n' + (f.e && f.e.stack || f.e)); });
  process.exit(1);
}
