'use strict';
/* MHXX スキルシミュレーター マイナススキル（見切り-1〜-3 など）検索回帰テスト
 * 実行: node tests/negative-skills.test.js
 *
 * requiredSkills にマイナススキル名（points < 0）を渡すと、
 * 「そのマイナススキルが発動する」= その系統の合計がしきい値以下、という条件になる。
 *   見切り-1 (達人 -10) → 達人 <= -10
 *   見切り-2 (達人 -15) → 達人 <= -15
 *   見切り-3 (達人 -20) → 達人 <= -20
 * あわせて「負のポイントを持つ防具・護石が候補圧縮/枝刈りで落ちないこと」も検証する。
 */
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; failures.push({ name: name, e: e }); console.log('FAIL  ' + name + ' :: ' + e.message); }
}

const engine = require(path.join(__dirname, '..', 'js', 'core', 'search-engine.js'));

/* 達人（見切り+ / 見切り-）と攻撃のスキル定義 */
const SKILLS = [
  { name: '見切り+1', system: '達人', points: 10, type: 3 },
  { name: '見切り+2', system: '達人', points: 15, type: 3 },
  { name: '見切り-1', system: '達人', points: -10, type: 3 },
  { name: '見切り-2', system: '達人', points: -15, type: 3 },
  { name: '見切り-3', system: '達人', points: -20, type: 3 },
  { name: '攻撃', system: '攻撃', points: 10, type: 3 }
];

/* 5部位ぶんの防具を作る。partSkills は [{ 系統: pt }, ...]（頭/胴/腕/腰/脚） */
function makeData(opts) {
  opts = opts || {};
  const parts = ['頭', '胴', '腕', '腰', '脚'];
  const armors = opts.armors || parts.map(function (label, part) {
    return {
      name: 'テスト' + label,
      part: part,
      gender: 3,
      type: 3,
      slots: 0,
      skills: (opts.partSkills && opts.partSkills[part]) || {},
      defense: 50 - part
    };
  });
  return {
    skills: opts.skills || SKILLS,
    armors: armors,
    decorations: opts.decos || [],
    charms: opts.charms || []
  };
}

function armor(part, skills, defense, name, slots) {
  return {
    name: name || ('テスト' + part),
    part: part,
    gender: 3,
    type: 3,
    slots: slots || 0,
    skills: skills || {},
    defense: defense != null ? defense : 50 - part
  };
}

const BASE_OPTIONS = {
  equipType: 1,
  gender: 1,
  weaponSlots: 0,
  requiredSkills: [],
  maxResults: 10,
  timeLimitMs: 0,
  seed: false,
  extraSuggestions: false
};

function search(data, extra) {
  engine.setData(data);
  return engine.searchSync(Object.assign({}, BASE_OPTIONS, extra || {}));
}

function activatedNames(result) {
  return (result.activatedSkills || []).map(function (s) { return s.name; });
}

/* ------------------------------------------------------------------ */
/* 1. 見切り-1: 達人 <= -10 の解が見つかり、見切り-1 が発動する        */
/* ------------------------------------------------------------------ */
test("requiredSkills ['見切り-1'] で 達人 <= -10 の解が見つかり 見切り-1 が発動する", function () {
  /* 合計がちょうど -10（見切り-1 のしきい値）になる構成 */
  const data = makeData({
    partSkills: [{ '達人': -3 }, { '達人': -3 }, { '達人': -2 }, { '達人': -1 }, { '達人': -1 }]
  });
  const res = search(data, { requiredSkills: ['見切り-1'] });

  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  const result = res.results[0];
  assert.strictEqual(result.totals['達人'], -10, '達人の合計が -10（実際: ' + result.totals['達人'] + '）');
  assert.ok(activatedNames(result).indexOf('見切り-1') >= 0,
    '発動スキルに見切り-1 が入ること（実際: ' + activatedNames(result).join(',') + '）');

  /* skillMatrix も負要求を反映する */
  const row = (result.skillMatrix || []).filter(function (r) { return r.system === '達人'; })[0];
  assert.ok(row, 'skillMatrix に 達人 の行があること');
  assert.strictEqual(row.requiredPt, -10, 'requiredPt は負のしきい値（実際: ' + row.requiredPt + '）');
  assert.strictEqual(row.totalPt, -10, 'totalPt が -10');
  assert.strictEqual(row.activated, true, 'activated が true');

  /* 検索結果のメタ情報 */
  assert.deepStrictEqual(res.negativeRequiredSystems, ['達人'], 'negativeRequiredSystems に 達人');
  assert.deepStrictEqual(res.negativeRequiredPoints, { '達人': -10 }, 'negativeRequiredPoints が -10');
  assert.strictEqual(res.requiredPoints[0], 0, '負要求は reqArr（正要求）に入らない');
});

/* ------------------------------------------------------------------ */
/* 2. しきい値: 見切り-2 / 見切り-3                                    */
/* ------------------------------------------------------------------ */
test("見切り-2 は 達人 <= -15、見切り-3 は 達人 <= -20 を要求する", function () {
  const data15 = makeData({
    partSkills: [{ '達人': -4 }, { '達人': -4 }, { '達人': -3 }, { '達人': -2 }, { '達人': -2 }]
  });
  const res2 = search(data15, { requiredSkills: ['見切り-2'] });
  assert.ok(res2.results.length > 0, '見切り-2 の解が見つかること（実際: ' + res2.results.length + '）');
  assert.ok(res2.results[0].totals['達人'] <= -15, '達人 <= -15（実際: ' + res2.results[0].totals['達人'] + '）');
  assert.ok(activatedNames(res2.results[0]).indexOf('見切り-2') >= 0,
    '見切り-2 が発動（実際: ' + activatedNames(res2.results[0]).join(',') + '）');

  const data20 = makeData({
    partSkills: [{ '達人': -5 }, { '達人': -5 }, { '達人': -4 }, { '達人': -3 }, { '達人': -3 }]
  });
  const res3 = search(data20, { requiredSkills: ['見切り-3'] });
  assert.ok(res3.results.length > 0, '見切り-3 の解が見つかること（実際: ' + res3.results.length + '）');
  assert.ok(res3.results[0].totals['達人'] <= -20, '達人 <= -20（実際: ' + res3.results[0].totals['達人'] + '）');
  assert.ok(activatedNames(res3.results[0]).indexOf('見切り-3') >= 0,
    '見切り-3 が発動（実際: ' + activatedNames(res3.results[0]).join(',') + '）');
});

/* ------------------------------------------------------------------ */
/* 3. 解なし: しきい値に届かない場合は 0 件                            */
/* ------------------------------------------------------------------ */
test('しきい値に届かない条件は 0 件（見切り-3 に対して -10 しか作れない）', function () {
  const data = makeData({
    partSkills: [{ '達人': -3 }, { '達人': -3 }, { '達人': -2 }, { '達人': -1 }, { '達人': -1 }]
  });
  const res = search(data, { requiredSkills: ['見切り-3'] });
  assert.strictEqual(res.results.length, 0, '解なし（実際: ' + res.results.length + '件）');
});

test('マイナススキルを持たないデータでは 0 件', function () {
  const data = makeData({
    partSkills: [{ '攻撃': 5 }, { '攻撃': 5 }, {}, {}, {}]
  });
  const res = search(data, { requiredSkills: ['見切り-1'] });
  assert.strictEqual(res.results.length, 0, '解なし（実際: ' + res.results.length + '件）');
});

/* ------------------------------------------------------------------ */
/* 4. 正要求と負要求の同時指定                                         */
/* ------------------------------------------------------------------ */
test('正要求（攻撃）と負要求（見切り-1）を同時に満たす解が見つかる', function () {
  const data = makeData({
    partSkills: [
      { '攻撃': 2, '達人': -2 }, { '攻撃': 2, '達人': -2 }, { '攻撃': 2, '達人': -2 },
      { '攻撃': 2, '達人': -2 }, { '攻撃': 2, '達人': -2 }
    ]
  });
  const res = search(data, { requiredSkills: ['攻撃', '見切り-1'] });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  const result = res.results[0];
  assert.ok(result.totals['攻撃'] >= 10, '攻撃 >= 10（実際: ' + result.totals['攻撃'] + '）');
  assert.ok(result.totals['達人'] <= -10, '達人 <= -10（実際: ' + result.totals['達人'] + '）');
  assert.ok(activatedNames(result).indexOf('見切り-1') >= 0, '見切り-1 が発動');
});

test('同じ系統に正要求と負要求が同居する場合は解なし', function () {
  const data = makeData({
    partSkills: [{ '達人': -3 }, { '達人': -3 }, { '達人': -2 }, { '達人': -1 }, { '達人': -1 }]
  });
  const res = search(data, { requiredSkills: ['見切り+1', '見切り-1'] });
  assert.strictEqual(res.results.length, 0, '達人 >= 10 と <= -10 は同時に満たせない（実際: ' + res.results.length + '件）');
});

/* ------------------------------------------------------------------ */
/* 5. 候補圧縮: 負の達人が大きい防具が落ちない                          */
/* ------------------------------------------------------------------ */
test('候補圧縮で「負の達人が大きい防具」が落ちない', function () {
  /* 同じ部位に「達人 -10 / 防御10」と「達人 +2 / 防御60」。
     正要求のパレート判定のままだと後者に支配されて前者が消える。 */
  const armors = [
    armor(0, { '達人': -10 }, 10, 'マイナス頭'),
    armor(0, { '達人': 2 }, 60, 'プラス頭'),
    armor(1, {}, 50), armor(2, {}, 50), armor(3, {}, 50), armor(4, {}, 50)
  ];
  const res = search(makeData({ armors: armors }), { requiredSkills: ['見切り-1'] });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  assert.strictEqual(res.results[0].equipments.head.name, 'マイナス頭',
    '負のポイントを持つ防具が候補に残ること（実際: ' + res.results[0].equipments.head.name + '）');
  assert.ok(res.results[0].totals['達人'] <= -10, '達人 <= -10');
});

/* ------------------------------------------------------------------ */
/* 6. 護石枝刈り: 負のポイントを持つお守りが落ちない                    */
/* ------------------------------------------------------------------ */
test('護石の枝刈りで「負のポイントを持つお守り」が落ちない', function () {
  const charms = [
    { name: 'マイナス護石', slots: 0, skills: { '達人': -10 } },
    { name: 'プラス護石', slots: 0, skills: { '達人': 3 } }
  ];
  const data = makeData({ charms: charms, partSkills: [{}, {}, {}, {}, {}] });
  const res = search(data, { requiredSkills: ['見切り-1'], charmMode: 'all', charms: charms });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  assert.strictEqual(res.results[0].equipments.charm.name, 'マイナス護石',
    '負のポイントを持つ護石が候補に残ること（実際: ' + res.results[0].equipments.charm.name + '）');
});

/* ------------------------------------------------------------------ */
/* 7. prepare / Worker 経由でも負要求が扱える                          */
/* ------------------------------------------------------------------ */
test('prepare が負要求の系統としきい値を返す', function () {
  engine.setData(makeData({
    partSkills: [{ '達人': -3 }, { '達人': -3 }, { '達人': -2 }, { '達人': -1 }, { '達人': -1 }]
  }));
  const info = engine.prepare(Object.assign({}, BASE_OPTIONS, { requiredSkills: ['見切り-1'] }));
  assert.deepStrictEqual(info.negativeRequiredSystems, ['達人'], 'negativeRequiredSystems');
  assert.deepStrictEqual(info.negativeRequiredPoints, { '達人': -10 }, 'negativeRequiredPoints');
});

test('Worker 経由でもマイナススキル検索ができる', function () {
  const data = makeData({
    partSkills: [{ '達人': -3 }, { '達人': -3 }, { '達人': -2 }, { '達人': -1 }, { '達人': -1 }]
  });
  engine.setData(data);
  const src = engine.buildWorkerSource();
  assert.ok(src && typeof src === 'string', 'Worker ソースが生成される');

  const out = {};
  const fakeSelf = { postMessage: function (m) { if (m && m.type !== 'progress') out[m.type] = m; } };
  new Function('self', src)(fakeSelf);
  fakeSelf.onmessage({ data: { type: 'init', data: data } });
  assert.ok(out.ready, 'init 応答（' + (out.error ? out.error.message : '') + '）');

  fakeSelf.onmessage({
    data: {
      type: 'search',
      options: Object.assign({}, BASE_OPTIONS, { requiredSkills: ['見切り-1'] })
    }
  });
  assert.ok(out.result && out.result.result, 'search 応答');
  const res = out.result.result;
  assert.ok(res.results.length > 0, 'Worker でも解が見つかる');
  assert.ok(res.results[0].totals['達人'] <= -10, 'Worker でも 達人 <= -10');
  assert.ok((res.results[0].activatedSkills || []).some(function (s) { return s.name === '見切り-1'; }),
    'Worker でも 見切り-1 が発動');
});

/* ------------------------------------------------------------------ */
/* 8. 正要求の検索が壊れていない（デグレ防止）                         */
/* ------------------------------------------------------------------ */
test('マイナススキルを指定しない通常検索は従来どおり', function () {
  const data = makeData({
    partSkills: [{ '攻撃': 5, '達人': 3 }, { '攻撃': 5 }, {}, {}, {}]
  });
  const res = search(data, { requiredSkills: ['攻撃'] });
  assert.ok(res.results.length > 0, '解が見つかること');
  assert.ok(res.results[0].totals['攻撃'] >= 10, '攻撃 >= 10');
  assert.deepStrictEqual(res.negativeRequiredSystems, [], '負要求は無い');
  assert.deepStrictEqual(res.negativeRequiredPoints, {});
  const row = (res.results[0].skillMatrix || []).filter(function (r) { return r.system === '攻撃'; })[0];
  assert.strictEqual(row.requiredPt, 10, 'positive requiredPt は従来どおり');
  assert.strictEqual(row.activated, true);
});

/* ------------------------------------------------------------------ */
/* 9. 倍率（胴系統倍加 / ネセト）と負ポイントの組み合わせ              */
/* ------------------------------------------------------------------ */
test('胴系統倍加で負ポイントが D 倍されても判定できる（達人 -3 / D=5 → -15）', function () {
  const data = {
    skills: SKILLS.concat([{ name: '胴系統倍加', system: '胴系統倍加', points: 1, type: 3 }]),
    armors: [
      armor(0, { '胴系統倍加': 1 }, 10, '倍加頭'),
      armor(1, { '達人': -3 }, 10, '胴'),
      armor(2, { '胴系統倍加': 1 }, 10, '倍加腕'),
      armor(3, { '胴系統倍加': 1 }, 10, '倍加腰'),
      armor(4, { '胴系統倍加': 1 }, 10, '倍加脚')
    ],
    decorations: [],
    charms: []
  };
  const res = search(data, { requiredSkills: ['見切り-2'], charmMode: 'none' });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  const result = res.results[0];
  assert.strictEqual(result.torsoUpCount, 4, '胴系統倍加 4 部位');
  assert.strictEqual(result.totals['達人'], -15, '胴の -3 が ×5 で -15（実際: ' + result.totals['達人'] + '）');
  assert.ok(activatedNames(result).indexOf('見切り-2') >= 0, '見切り-2 が発動');
});

test('ネセト一式で護石の負ポイントが ×2 されても判定できる（-5 → -10）', function () {
  const neset = ['ネセトカウザ', 'ネセトディルア', 'ネセトタハッド', 'ネセトヒザム', 'ネセトダラー'];
  const charms = [{ name: 'マイナス護石', slots: 0, skills: { '達人': -5 } }];
  const data = {
    skills: SKILLS,
    armors: neset.map(function (name, part) { return armor(part, {}, 50, name); }),
    decorations: [],
    charms: charms
  };
  const res = search(data, { requiredSkills: ['見切り-1'], charmMode: 'all', charms: charms });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  const result = res.results[0];
  assert.strictEqual(result.isNeset, true, 'ネセト一式');
  assert.strictEqual(result.totals['達人'], -10, '護石の -5 が ×2 で -10（実際: ' + result.totals['達人'] + '）');
  assert.ok(activatedNames(result).indexOf('見切り-1') >= 0, '見切り-1 が発動');
});

test('胴に正のポイントがあっても負要求の枝刈りで取りこぼさない', function () {
  /* 正要求用の枝刈りは胴を無条件に ×5 で見積もるため、負要求でそのまま使うと
     「胴 達人 +1」が +5 と数えられ、合計 -10 の解を取りこぼしていた。 */
  const charms = [{ name: 'C0', slots: 0, skills: { '達人': -5 } }];
  const data = {
    skills: SKILLS,
    armors: [
      armor(0, { '達人': -6 }, 10, '頭'),
      armor(1, { '達人': 1 }, 10, '胴'),
      armor(2, {}, 10, '腕'),
      armor(3, {}, 10, '腰'),
      armor(4, {}, 10, '脚')
    ],
    decorations: [],
    charms: charms
  };
  const res = search(data, { requiredSkills: ['見切り-1'], charmMode: 'all', charms: charms });
  assert.ok(res.results.length > 0, '解が見つかること（実際: ' + res.results.length + '件）');
  assert.strictEqual(res.results[0].totals['達人'], -10, '達人 合計 -10（実際: ' + res.results[0].totals['達人'] + '）');
  assert.ok(activatedNames(res.results[0]).indexOf('見切り-1') >= 0, '見切り-1 が発動');
});

/* ------------------------------------------------------------------ */
/* 10. 装飾品ソルバ: 負要求系統にマイナスを持つ装飾品があっても解なしにしない */
/* ------------------------------------------------------------------ */
test('装飾品が負要求系統にマイナスを持つ場合でも装飾品ソルバが解なしにしない', function () {
  /* 再現データ:
       頭: 抜刀会心 9 / 胴: 達人 -10 / 他は中立
       装飾品: 抜刀珠（抜刀会心 +1, 達人 -1） size1 / 武器スロ1
     正要求単独・負要求単独は解けるが、両方指定すると装飾品ソルバが
     「達人が -1 で未充足（needArr 0 - cur -1 > 0）」と誤判定して 0 件になっていた。 */
  const skills = [
    { name: '見切り-1', system: '達人', points: -10, type: 3 },
    { name: '抜刀会心+1', system: '抜刀会心', points: 10, type: 3 }
  ];
  const armors = [
    armor(0, { '抜刀会心': 9 }, 50, '頭'),
    armor(1, { '達人': -10 }, 50, '胴'),
    armor(2, {}, 50, '腕'),
    armor(3, {}, 50, '腰'),
    armor(4, {}, 50, '脚')
  ];
  const decos = [{ name: '抜刀珠', size: 1, skills: { '抜刀会心': 1, '達人': -1 } }];
  const data = { skills: skills, armors: armors, decorations: decos, charms: [] };

  /* 前提: それぞれ単独なら解ける */
  const posOnly = search(data, { requiredSkills: ['抜刀会心+1'], weaponSlots: 1 });
  assert.ok(posOnly.results.length > 0,
    '正要求単独では解けること（実際: ' + posOnly.results.length + '件）');
  assert.ok((posOnly.results[0].totals['抜刀会心'] || 0) >= 10, '単独でも 抜刀会心 >= 10');

  const negOnly = search(data, { requiredSkills: ['見切り-1'], weaponSlots: 1 });
  assert.ok(negOnly.results.length > 0,
    '負要求単独では解けること（実際: ' + negOnly.results.length + '件）');
  assert.ok((negOnly.results[0].totals['達人'] || 0) <= -10, '単独でも 達人 <= -10');

  /* 本題: 同時指定でも同じ構成（達人 -11 / 抜刀会心 10）で成立する */
  const res = search(data, { requiredSkills: ['抜刀会心+1', '見切り-1'], weaponSlots: 1 });
  assert.ok(res.results.length > 0,
    '同時指定でも解が見つかること（実際: ' + res.results.length + '件 / decoFail=' +
    (res.stats && res.stats.decoFail) + '）');
  const result = res.results[0];
  assert.ok((result.totals['抜刀会心'] || 0) >= 10, '抜刀会心 >= 10（実際: ' + result.totals['抜刀会心'] + '）');
  assert.ok((result.totals['達人'] || 0) <= -10, '達人 <= -10（実際: ' + result.totals['達人'] + '）');
  /* 装飾品のマイナスも合算した確定値で判定されている */
  assert.strictEqual(result.totals['達人'], -11, '達人 -10 + 装飾品 -1 = -11（実際: ' + result.totals['達人'] + '）');
  assert.ok(activatedNames(result).indexOf('見切り-1') >= 0, '見切り-1 が発動');
});

/* ------------------------------------------------------------------ */
/* 11. 装飾品プラン選択: 負要求を壊す珠を避けて代替プランを選ぶ         */
/* ------------------------------------------------------------------ */
test('装飾品プランが負要求を壊す場合は負要求を壊さない代替プランを選ぶ', function () {
  /* 再現データ:
       頭: 攻撃 8 / 胴: 達人 -10 / 他は中立
       装飾品: 攻撃2珠（攻撃 +2, 達人 +1） size1 / 攻撃1珠（攻撃 +1） size1
       武器スロ2（容量2のプール 1 個）
     正要求単独・負要求単独は解けるが、両方指定するとソルバが
     攻撃2珠（達人 +1）を選んで検証で落ち、0 件になっていた。
     正解は 攻撃1珠×2 で 攻撃10 / 達人-10。 */
  const skills = [
    { name: '見切り-1', system: '達人', points: -10, type: 3 },
    { name: '攻撃力UP【小】', system: '攻撃', points: 10, type: 3 }
  ];
  const armors = [
    armor(0, { '攻撃': 8 }, 50, '頭'),
    armor(1, { '達人': -10 }, 50, '胴'),
    armor(2, {}, 50, '腕'),
    armor(3, {}, 50, '腰'),
    armor(4, {}, 50, '脚')
  ];
  const decos = [
    { name: '攻撃2珠', size: 1, skills: { '攻撃': 2, '達人': 1 } },
    { name: '攻撃1珠', size: 1, skills: { '攻撃': 1 } }
  ];
  const data = { skills: skills, armors: armors, decorations: decos, charms: [] };

  /* 前提: それぞれ単独なら解ける */
  const posOnly = search(data, { requiredSkills: ['攻撃力UP【小】'], weaponSlots: 2 });
  assert.ok(posOnly.results.length > 0, '正要求単独では解けること（実際: ' + posOnly.results.length + '件）');
  assert.ok((posOnly.results[0].totals['攻撃'] || 0) >= 10, '単独でも 攻撃 >= 10');

  const negOnly = search(data, { requiredSkills: ['見切り-1'], weaponSlots: 2 });
  assert.ok(negOnly.results.length > 0, '負要求単独では解けること（実際: ' + negOnly.results.length + '件）');
  assert.ok((negOnly.results[0].totals['達人'] || 0) <= -10, '単独でも 達人 <= -10');

  /* 本題: 同時指定でも 攻撃1珠×2 のプランで成立する */
  const res = search(data, { requiredSkills: ['攻撃力UP【小】', '見切り-1'], weaponSlots: 2 });
  assert.ok(res.results.length > 0,
    '同時指定でも解が見つかること（実際: ' + res.results.length + '件 / decoFail=' +
    (res.stats && res.stats.decoFail) + ' / verifyFail=' + (res.stats && res.stats.verifyFail) + '）');
  const result = res.results[0];
  assert.ok((result.totals['攻撃'] || 0) >= 10, '攻撃 >= 10（実際: ' + result.totals['攻撃'] + '）');
  assert.ok((result.totals['達人'] || 0) <= -10, '達人 <= -10（実際: ' + result.totals['達人'] + '）');
  /* 負要求を壊す珠（達人 +1）を選んでいない */
  const used = [];
  ['weapon', 'head', 'body', 'arm', 'waist', 'legs', 'charm'].forEach(function (partKey) {
    const part = result.equipments[partKey];
    if (!part || !part.decos) return;
    part.decos.forEach(function (d) { used.push(d && d.name); });
  });
  assert.ok(used.indexOf('攻撃2珠') < 0,
    '達人 +1 を持つ攻撃2珠を選ばないこと（実際: ' + used.join(',') + '）');
});

/* ------------------------------------------------------------------ */
console.log('');
console.log('--- ' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed ---');
if (fail) {
  failures.forEach(function (f) { console.log('\n' + f.name + '\n' + ((f.e && f.e.stack) || f.e)); });
  process.exit(1);
}
