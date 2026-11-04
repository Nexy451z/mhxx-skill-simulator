'use strict';
/* MHXX スキルシミュレーター お守り検索モード（全検索 / 個別固定）回帰テスト
 * 実行: node tests/charm-mode.test.js
 *
 * 症状: STEP2 の #charmSelect で「登録したお守りをすべて対象にする (全検索 - N個)」を
 *       選んでも、検索結果の護石が「なし」のままになる（お守りが使われない）。
 *
 * 原因はどちらも js/app.js 側の状態と検索条件の不整合。
 *   1) お守り一覧が変わっても再検索されず、護石なしの古い結果が残る
 *   2) charmMode='single' のまま固定対象が存在しないと、護石候補ゼロで検索される
 *      （UI の #charmSelect は全検索を表示したままなので「全検索にしたのに
 *        お守りなしで検索される」ように見える）
 *
 * このテストは js/app.js を最小限の DOM / localStorage スタブ上で起動し、
 * 実際に検索エンジンへ渡った options と結果の護石で検証する。
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 最小限のブラウザ環境（app.js / charm-store.js を Node で起動する）   */
/* ------------------------------------------------------------------ */
function createStorage() {
  const data = Object.create(null);
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem: function (key, value) { data[key] = String(value); },
    removeItem: function (key) { delete data[key]; },
    clear: function () { Object.keys(data).forEach(function (k) { delete data[k]; }); }
  };
}

function createDocumentStub() {
  return {
    readyState: 'complete',
    body: { classList: { add: function () {}, remove: function () {} }, appendChild: function () {} },
    addEventListener: function () {},
    removeEventListener: function () {},
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () {
      return {
        style: {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {} },
        appendChild: function () {},
        setAttribute: function () {},
        addEventListener: function () {}
      };
    }
  };
}

global.window = global;
global.document = createDocumentStub();
global.localStorage = createStorage();
global.MHXX = {};

/* スキル・防具は最小構成。攻撃は防具だけでは 7pt しか出せず、
   護石（攻撃+3）を使わないと 10pt に届かないようにする。 */
const TEST_DATA = {
  skills: [
    { name: '攻撃', system: '攻撃', points: 10, type: 3 },
    { name: '達人', system: '達人', points: 10, type: 3 }
  ],
  armors: [
    { name: 'テスト頭', part: 0, gender: 3, type: 3, slots: 0, skills: { '攻撃': 7 }, defense: 50 },
    { name: 'テスト胴', part: 1, gender: 3, type: 3, slots: 0, skills: {}, defense: 49 },
    { name: 'テスト腕', part: 2, gender: 3, type: 3, slots: 0, skills: {}, defense: 48 },
    { name: 'テスト腰', part: 3, gender: 3, type: 3, slots: 0, skills: {}, defense: 47 },
    { name: 'テスト脚', part: 4, gender: 3, type: 3, slots: 0, skills: {}, defense: 46 }
  ],
  decorations: [],
  charms: []
};

require(path.join(ROOT, 'js', 'ui', 'ui-kit.js'));
require(path.join(ROOT, 'js', 'core', 'charm-store.js'));

const engine = require(path.join(ROOT, 'js', 'core', 'search-engine.js'));

/* 実際にエンジンへ渡された options を記録する（テストの肝） */
const searchCalls = [];
const originalSearchAsync = engine.searchAsync;
engine.searchAsync = function (options, onProgress) {
  searchCalls.push({
    charmMode: options.charmMode,
    charmCount: (options.charms || []).length,
    charmNames: (options.charms || []).map(function (charm) { return charm.name; }),
    selectedCharm: options.selectedCharm || null,
    requiredSkills: (options.requiredSkills || []).slice()
  });
  return originalSearchAsync.call(engine, options, onProgress);
};

global.MHXX.data = TEST_DATA;
global.MHXX.fallbackData = { sampleCharms: [], charmTypes: ['天の護石'] };
global.MHXX.searchEngine = engine;

/* js/app.js を読み込むと boot() まで走る */
require(path.join(ROOT, 'js', 'app.js'));

const MHXX = global.MHXX;

/* ------------------------------------------------------------------ */
/* テストランナー（既存 tests/engine-slots.test.js と同じ出力形式）    */
/* ------------------------------------------------------------------ */
let pass = 0;
let fail = 0;
const failures = [];
const tests = [];

function test(name, fn) { tests.push({ name: name, fn: fn }); }

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 5000);
  return new Promise(function (resolve, reject) {
    (function tick() {
      let value = false;
      try { value = predicate(); } catch (err) { return reject(err); }
      if (value) return resolve(value);
      if (Date.now() > deadline) return reject(new Error('timeout: ' + label));
      setTimeout(tick, 20);
    })();
  });
}

/* 検索はデバウンス 140ms + 非同期なので、完了 (status === 'ready') を待つ */
async function settle() {
  await delay(220);
  await waitFor(function () { return MHXX.store.get().status === 'ready'; }, 5000, 'search ready');
  await delay(30);
}

function lastCall() {
  return searchCalls[searchCalls.length - 1] || null;
}

function callCount() {
  return searchCalls.length;
}

function charmNames() {
  return MHXX.charmApi.list().map(function (charm) {
    return (charm.type || charm.name) + ':' + (charm.skills || []).map(function (skill) {
      return (skill.name || skill.group) + '+' + (skill.points != null ? skill.points : skill.pt);
    }).join(',');
  });
}

async function resetCharms() {
  MHXX.charmApi.clear();
  MHXX.bus.emit('charms');
  await settle();
}

const ATTACK_REQUIRED = [{ name: '攻撃', group: '攻撃', threshold: 10 }];

/* ------------------------------------------------------------------ */
/* 1. 起動直後: 全検索 + お守り 0 個                                   */
/* ------------------------------------------------------------------ */
test('起動直後は charmMode=all で検索される', async function () {
  await settle();
  const call = lastCall();
  assert.ok(call, '検索が実行されること');
  assert.strictEqual(call.charmMode, 'all', '起動直後は全検索モード');
  assert.strictEqual(MHXX.store.get().charmMode, 'all');
});

/* ------------------------------------------------------------------ */
/* 2. 本命の回帰: お守り追加後に 'charms' 通知だけで検索し直される     */
/* ------------------------------------------------------------------ */
test("お守り追加 + bus.emit('charms') だけで全検索が再実行される（護石が「なし」のまま残らない）", async function () {
  await resetCharms();
  MHXX.store.patch({ skills: ATTACK_REQUIRED.slice(), resultIndex: 0 });
  await settle();

  assert.strictEqual(MHXX.store.get().results.length, 0, '護石なしでは 攻撃10pt に届かず 0 件');
  const before = callCount();

  MHXX.charmApi.add({
    type: '天の護石', name: '天の護石', kind: 10, slots: 0,
    skills: [{ name: '攻撃', pt: 3 }]
  });
  /* UI からの追加通知と同じ経路。ここで再検索されないと古い結果が残る */
  MHXX.bus.emit('charms');
  await settle();

  assert.ok(callCount() > before, "お守り一覧が変わったら 'charms' 通知だけで再検索されること");
  const call = lastCall();
  assert.strictEqual(call.charmMode, 'all', '全検索モードで検索されること');
  assert.strictEqual(call.charmCount, 1, '登録したお守りが護石候補に入ること（実際: ' + call.charmCount + '）');

  const results = MHXX.store.get().results;
  assert.ok(results.length > 0, '護石を使えば 攻撃10pt の解が見つかること');
  assert.strictEqual(results[0].parts.charm.name, '天の護石', '護石が「なし」ではなく登録お守りになること');
  assert.ok((results[0].totals['攻撃'] || 0) >= 10, '攻撃pt が 10 以上');
});

/* ------------------------------------------------------------------ */
/* 3. 個別固定（有効な id）は single + selectedCharm で検索される      */
/* ------------------------------------------------------------------ */
test('有効なお守りを固定したときは charmMode=single + selectedCharm で検索される', async function () {
  await settle();
  const list = MHXX.charmApi.list();
  assert.ok(list.length >= 1, '前のテストのお守りが残っていること');

  MHXX.store.patch({ charmMode: 'single', charmId: list[0].id, resultIndex: 0 });
  await settle();

  const call = lastCall();
  assert.strictEqual(call.charmMode, 'single', '固定モードで検索されること');
  assert.ok(call.selectedCharm, 'selectedCharm が渡ること');
  assert.strictEqual(call.selectedCharm.skills['攻撃'], 3, '固定したお守りのスキルが渡ること');
  assert.strictEqual(MHXX.store.get().charmMode, 'single');
});

/* ------------------------------------------------------------------ */
/* 4. 固定対象が存在しない場合は全検索として扱う（護石候補ゼロにしない） */
/* ------------------------------------------------------------------ */
test('charmId が存在しない場合は charmMode=all として検索される', async function () {
  await settle();
  const before = callCount();

  MHXX.store.patch({ charmMode: 'single', charmId: 'ghost-id-does-not-exist', resultIndex: 0 });
  await settle();

  assert.ok(callCount() > before, '再検索されること');
  const call = lastCall();
  assert.strictEqual(call.charmMode, 'all', '存在しないお守りの固定は全検索にフォールバックすること');
  assert.strictEqual(call.selectedCharm, null, 'selectedCharm を渡さないこと');
  assert.strictEqual(call.charmCount, 1, '護石候補（登録お守り）は残ること');

  const results = MHXX.store.get().results;
  assert.ok(results.length > 0, '護石が使われた結果が返ること');
  assert.strictEqual(results[0].parts.charm.name, '天の護石', '護石が「なし」にならないこと');
});

/* ------------------------------------------------------------------ */
/* 5. charmId が空文字の single も全検索へ矯正される                   */
/* ------------------------------------------------------------------ */
test("charmId が空文字の single でも護石候補を落とさず、'charms' 通知で全検索へ戻る", async function () {
  await settle();
  MHXX.store.patch({ charmMode: 'single', charmId: '', resultIndex: 0 });
  await settle();

  let call = lastCall();
  assert.strictEqual(call.charmMode, 'all', 'charmId が無い single は all として検索されること');
  assert.ok(call.charmCount >= 1, '護石候補が残ること（実際: ' + call.charmCount + '）');

  MHXX.bus.emit('charms');
  await settle();

  assert.strictEqual(MHXX.store.get().charmMode, 'all', '状態も全検索へ戻ること');
  assert.strictEqual(MHXX.store.get().charmId, null);
  call = lastCall();
  assert.strictEqual(call.charmMode, 'all');
});

/* ------------------------------------------------------------------ */
/* 6. 固定中のお守りを削除したら全検索へ戻る                            */
/* ------------------------------------------------------------------ */
test('固定中のお守りを削除すると全検索へ戻り、護石候補も更新される', async function () {
  await settle();
  const list = MHXX.charmApi.list();
  assert.ok(list.length >= 1, 'お守りが登録されていること');

  MHXX.store.patch({ charmMode: 'single', charmId: list[0].id, resultIndex: 0 });
  await settle();
  assert.strictEqual(MHXX.store.get().charmMode, 'single');

  MHXX.charmApi.remove(list[0].id);
  await settle();

  const state = MHXX.store.get();
  assert.strictEqual(state.charmMode, 'all', '全検索モードへ戻ること');
  assert.strictEqual(state.charmId, null, 'charmId がクリアされること');
  const call = lastCall();
  assert.strictEqual(call.charmMode, 'all');
  assert.strictEqual(call.charmCount, 0, '削除したお守りが候補に残らないこと');
  assert.strictEqual(charmNames().length, 0);
});

/* ------------------------------------------------------------------ */
/* 7. セーブデータ取込 (importFromSaveSlot) 後も護石候補が最新になる    */
/* ------------------------------------------------------------------ */
test("セーブ取込 (importFromSaveSlot) 後は取り込んだお守りで再検索される", async function () {
  await resetCharms();
  MHXX.store.patch({ skills: ATTACK_REQUIRED.slice(), resultIndex: 0 });
  await settle();
  assert.strictEqual(MHXX.store.get().results.length, 0, '取込前は護石なしで 0 件');

  const summary = MHXX.charmApi.importFromSaveSlot([
    { name: '天の護石', kind: 10, slots: 0, skills: [{ name: '攻撃', pt: 3 }], boxIndex: 0, sourceSlot: 1 }
  ], 'merge');
  assert.strictEqual(summary.added, 1, 'お守りが 1 個取り込まれること');
  MHXX.bus.emit('charms');
  await settle();

  const call = lastCall();
  assert.strictEqual(call.charmMode, 'all', '取込後も全検索モード');
  assert.strictEqual(call.charmCount, 1, '取込んだお守りが護石候補に入ること');
  const results = MHXX.store.get().results;
  assert.ok(results.length > 0, '取込んだお守りで解が見つかること');
  assert.strictEqual(results[0].parts.charm.name, '天の護石', '護石が「なし」にならないこと');
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
