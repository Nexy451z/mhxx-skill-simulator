'use strict';
/* MHXX スキルシミュレーター stopOnFirst（最初の解で探索打ち切り）回帰テスト
 * 実行: node tests/engine-first-only.test.js
 *
 * 理論値お守り逆引き（未所持のお守りを含む逆引き）では
 * 「条件を満たす解が 1 つでも存在するか」だけ分かれば十分なため、
 * js/core/search-engine.js に options.stopOnFirst を追加した。
 *   - true  : 最初の解を results に push した直後に探索を打ち切る
 *   - 未指定/false : 従来どおり全探索（既定挙動は変えない）
 * searchSync / searchAsync / Worker 経由のいずれでも同じように効くことを検証する。
 */
const assert = require('assert');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
const tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

const engine = require(path.join(__dirname, '..', 'js', 'core', 'search-engine.js'));

/* 解が複数見つかる十分な組み合わせを持つデータ。
   攻撃は各部位 0〜2pt + 攻撃珠【1】で補える（護石 3 スロも使える）。 */
function makeData() {
  const parts = ['頭', '胴', '腕', '腰', '脚'];
  const armors = [];
  parts.forEach(function (label, part) {
    for (let v = 0; v < 6; v++) {
      armors.push({
        name: 'テスト' + label + v,
        part: part,
        gender: 3,
        type: 3,
        slots: v % 4,
        skills: { '攻撃': v % 3 },
        defense: 50 + v
      });
    }
  });
  /* ネセト一式（シード評価の対象）。攻撃 2pt×5部位 = 10pt で
     シード評価だけで必須ptを満たす構成が存在する。 */
  ['ネセトカウザ', 'ネセトディルア', 'ネセトタハッド', 'ネセトヒザム', 'ネセトダラー']
    .forEach(function (name, part) {
      armors.push({
        name: name,
        part: part,
        gender: 3,
        type: 3,
        slots: 0,
        skills: { '攻撃': 2 },
        defense: 40 + part
      });
    });
  return {
    skills: [
      { name: '攻撃', system: '攻撃', points: 10, type: 3 },
      { name: '達人', system: '達人', points: 10, type: 3 }
    ],
    armors: armors,
    decorations: [{ name: '攻撃珠【1】', size: 1, skills: { '攻撃': 1 } }],
    charms: [{ name: '天の護石', slots: 3, skills: {} }]
  };
}

/* seed は既定 (true) のまま検証する。シード評価は探索本体より先に走るため、
   stopOnFirst の打ち切りがシード側にも効いていないと複数件返ってしまう。 */
const BASE_OPTIONS = {
  equipType: 1,
  gender: 1,
  weaponSlots: 3,
  requiredSkills: ['攻撃'],
  charmMode: 'single',
  selectedCharm: { name: '天の護石', slots: 3, skills: {} },
  maxResults: 20,
  timeLimitMs: 0,
  seed: true,
  extraSuggestions: false
};

function search(extra) {
  const options = Object.assign({}, BASE_OPTIONS, extra || {});
  engine.setData(makeData());
  return engine.searchSync(options);
}

/* ------------------------------------------------------------------ */
/* 1. stopOnFirst=false（既定）では複数件、true では 1 件              */
/* ------------------------------------------------------------------ */
test('既定 (未指定) では複数結果が返り、stopOnFirst:true では 1 件だけ返る', function () {
  const normal = search({});
  assert.ok(normal.results.length > 1, '前提: 解が複数あること（実際: ' + normal.results.length + '件）');

  const firstOnly = search({ stopOnFirst: true });
  assert.strictEqual(firstOnly.results.length, 1, 'stopOnFirst で 1 件のみ（実際: ' + firstOnly.results.length + '件）');
  assert.strictEqual(firstOnly.stats.accepted, 1, '採用された解も 1 件であること');
});

test('seed:true (既定) / seed:false のどちらでも stopOnFirst はちょうど 1 件', function () {
  /* seed:true ではネセト一式 / 胴系統倍加のシード評価が探索本体より先に走る。
     シード側でも打ち切らないと maxResults 件まで push されてしまう。 */
  [true, false].forEach(function (seed) {
    const res = search({ stopOnFirst: true, seed: seed });
    assert.strictEqual(res.results.length, 1,
      'seed=' + seed + ' で 1 件のみ（実際: ' + res.results.length + '件）');
  });
});

test('stopOnFirst:false を明示しても未指定と同じ結果になる（既定挙動を変えない）', function () {
  const omitted = search({});
  const explicitFalse = search({ stopOnFirst: false });
  assert.strictEqual(explicitFalse.results.length, omitted.results.length, '件数が一致すること');
  const keyOf = function (res) {
    return ['head', 'body', 'arm', 'waist', 'leg', 'charm', 'weapon']
      .map(function (part) {
        return res.equipments[part] ? res.equipments[part].name : '-';
      }).join('|');
  };
  assert.deepStrictEqual(
    explicitFalse.results.map(keyOf),
    omitted.results.map(keyOf),
    '結果の並びも一致すること'
  );
});

/* ------------------------------------------------------------------ */
/* 2. stopOnFirst の 1 件が条件（必須pt）を満たす                      */
/* ------------------------------------------------------------------ */
test('stopOnFirst の 1 件は必須スキルの発動ptを満たす', function () {
  const res = search({ stopOnFirst: true });
  assert.strictEqual(res.results.length, 1);

  const result = res.results[0];
  assert.ok((result.totals['攻撃'] || 0) >= 10, '合計 pt が 10 以上（実際: ' + result.totals['攻撃'] + '）');

  /* engine.analyze で内訳を再計算しても一致すること */
  const analyzed = engine.analyze(result);
  assert.ok(analyzed, 'analyze が結果を返すこと');
  assert.ok((analyzed['攻撃'] || 0) >= 10, 'analyze の攻撃ptが 10 以上（実際: ' + analyzed['攻撃'] + '）');
  assert.strictEqual(analyzed['攻撃'], result.totals['攻撃'], 'analyze と totals が一致すること');
});

/* ------------------------------------------------------------------ */
/* 3. 解が無い条件では 0 件（挙動が変わらない）                        */
/* ------------------------------------------------------------------ */
test('解が無い条件では stopOnFirst:true でも 0 件', function () {
  /* 達人を出す装備が 1 つも無いデータ */
  const normal = search({ requiredSkills: ['達人'] });
  assert.strictEqual(normal.results.length, 0, '前提: 通常検索でも解なし');

  const firstOnly = search({ requiredSkills: ['達人'], stopOnFirst: true });
  assert.strictEqual(firstOnly.results.length, 0, 'stopOnFirst でも 0 件');
  assert.strictEqual(firstOnly.stats.accepted, 0);
});

/* ------------------------------------------------------------------ */
/* 4. searchAsync でも options.stopOnFirst がそのまま効く              */
/* ------------------------------------------------------------------ */
test('searchAsync 経由でも stopOnFirst で 1 件だけ返る', function () {
  engine.setData(makeData());
  const options = Object.assign({}, BASE_OPTIONS, { stopOnFirst: true, __noWorker: true });
  return engine.searchAsync(options).then(function (res) {
    assert.strictEqual(res.results.length, 1, '非同期検索でも 1 件（実際: ' + res.results.length + '件）');
    assert.ok((res.results[0].totals['攻撃'] || 0) >= 10, '必須ptを満たすこと');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Worker 経由（buildWorkerSource）でも stopOnFirst が効く          */
/* ------------------------------------------------------------------ */
test('Worker ソース経由でも stopOnFirst で 1 件だけ返る', function () {
  engine.setData(makeData());
  const src = engine.buildWorkerSource();
  assert.ok(src && typeof src === 'string', 'Worker ソースが生成される');

  const out = {};
  const fakeSelf = { postMessage: function (m) { if (m && m.type !== 'progress') out[m.type] = m; } };
  new Function('self', src)(fakeSelf);
  fakeSelf.onmessage({ data: { type: 'init', data: makeData() } });
  assert.ok(out.ready, 'init 応答（' + (out.error ? out.error.message : '') + '）');

  fakeSelf.onmessage({ data: { type: 'search', options: Object.assign({}, BASE_OPTIONS, { stopOnFirst: true }) } });
  assert.ok(out.result && out.result.result, 'search 応答');
  assert.strictEqual(out.result.result.results.length, 1, 'Worker でも 1 件（実際: ' + out.result.result.results.length + '件）');
});

/* ------------------------------------------------------------------ */
/* 実行                                                                */
/* ------------------------------------------------------------------ */
(async function run() {
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log('PASS  ' + t.name);
    } catch (err) {
      fail++;
      failures.push({ name: t.name, e: err });
      console.log('FAIL  ' + t.name + ' :: ' + err.message);
    }
  }

  console.log('');
  console.log('--- ' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed ---');
  if (fail) {
    failures.forEach(function (f) {
      console.log('\n' + f.name + '\n' + ((f.e && f.e.stack) || f.e));
    });
    process.exit(1);
  }
})();
