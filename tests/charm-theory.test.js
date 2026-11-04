/* MHXX スキルシミュレーター 理論値お守り生成 (charm-theory.js) 回帰テスト
 * 実行: node tests/charm-theory.test.js
 *
 * 理論値お守りは「未所持でもよい合法な護石」を表す。
 * 生成した全件が data.isValidCharmSkill を満たすこと、スロ数・第1/第2スキル上限・
 * 組の順序（第1枠/第2枠で上限が異なる系統）・登録用 payload を固定する。
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');

global.window = global;
global.MHXX = global.MHXX || {};
const mem = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};

require(path.join(ROOT, 'js', 'data', 'sim-data.js'));
const theory = require(path.join(ROOT, 'js', 'core', 'charm-theory.js'));
const D = global.MHXX.data;

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; failures.push({ name: name, e: e }); console.log('FAIL  ' + name + ' :: ' + e.message); }
}

function charmKey(c) { return c.slots + '|' + (c.kindId == null ? '' : c.kindId) + '|' + JSON.stringify(c.skills); }

/* ------------------------------------------------------------------ */
test('buildCharms: 生成した全件が isValidCharmSkill を満たす', function () {
  const list = theory.buildCharms(['攻撃', '達人', '聴覚保護'], D);
  assert.ok(list.length > 0, '生成されること');
  for (const charm of list) {
    assert.ok(theory.isValid(charm, D), '違法: ' + charm.label + ' (' + JSON.stringify(charm.skills) + ')');
    assert.ok(Object.keys(charm.skills || {}).length <= 2, 'スキルは最大2系統');
    assert.ok(charm.slots >= 0 && charm.slots <= 3, 'スロ数は0〜3');
  }
});

test('buildCharms: スロ数0〜3をすべて含み、重複がない', function () {
  const list = theory.buildCharms(['攻撃', '達人'], D);
  const slots = {};
  const seen = {};
  for (const charm of list) {
    slots[charm.slots] = true;
    const key = charmKey(charm);
    assert.ok(!seen[key], '重複: ' + key);
    seen[key] = true;
  }
  [0, 1, 2, 3].forEach(function (s) { assert.ok(slots[s], 'スロ' + s + ' が含まれること'); });
});

test('buildCharms: 第2スキル枠専用の系統（攻撃）は第1枠のパートナー付きで最大10ptになる', function () {
  const list = theory.buildCharms(['攻撃'], D);
  const maxAttack = Math.max.apply(null, list.map(function (c) { return Number(c.skills['攻撃']) || 0; }));
  assert.strictEqual(maxAttack, 10, '攻撃は第2枠で10pt（実際: ' + maxAttack + '）');
  const single = list.filter(function (c) {
    return Object.keys(c.skills).length === 1 && Number(c.skills['攻撃']) > 0;
  });
  assert.ok(single.length > 0, '低rarityでは第1枠の攻撃+4も存在する');
  assert.ok(single.every(function (c) { return c.skills['攻撃'] <= 4; }), '第1枠の攻撃は最大4pt');
  const secondOnly = list.filter(function (c) {
    return Number(c.skills['攻撃']) === 10 && Object.keys(c.skills).length === 2;
  });
  assert.ok(secondOnly.length > 0, '攻撃+10 は第1枠パートナーとの2系統で生成される');
});

test('maxPointsForKind: 第1スキル枠/第2スキル枠の表と maxFirstSkill/maxSecondSkill で cap される', function () {
  const hero = D.charmKinds.filter(function (k) { return k.id === 8; })[0]; /* 英雄の護石 rarity100 */
  const queen = D.charmKinds.filter(function (k) { return k.id === 5; })[0]; /* 女王の護石 rarity99 */
  assert.ok(hero && queen, '護石の種類があること');
  /* 攻撃は rarity100 では第2スキル枠のみ（第1枠は 0pt） */
  assert.strictEqual(theory.maxPointsForKind(hero, 3, '攻撃', false, D), 0);
  assert.strictEqual(theory.maxPointsForKind(hero, 3, '攻撃', true, D), 10);
  /* 気絶は rarity99 の第2スキル枠で 13pt */
  assert.strictEqual(theory.maxPointsForKind(queen, 3, '気絶', false, D), 0);
  assert.strictEqual(theory.maxPointsForKind(queen, 3, '気絶', true, D), 13);
  /* maxSlots を超えるスロ数は 0pt */
  assert.strictEqual(theory.maxPointsForKind(queen, 4, '攻撃', true, D), 0);
});

test('buildCharms: 第1/第2スキル枠の上限差を両順序でカバーする（気絶の第2枠13pt）', function () {
  const list = theory.buildCharms(['気絶', '攻撃'], D);
  const maxKizetsu = Math.max.apply(null, list.map(function (c) { return Number(c.skills['気絶']) || 0; }));
  const maxAttack = Math.max.apply(null, list.map(function (c) { return Number(c.skills['攻撃']) || 0; }));
  assert.strictEqual(maxKizetsu, 13, '気絶は第2枠で13ptまで取れること（実際: ' + maxKizetsu + '）');
  assert.strictEqual(maxAttack, 10, '攻撃は10ptまで取れること（実際: ' + maxAttack + '）');
});

test('isValid: 位置別の上限・maxSlots・スキル数を判定する', function () {
  /* 兵士の護石(kind1, rarity97) の第1スキル枠は攻撃の上限4 */
  assert.strictEqual(theory.isValid({ kindId: 1, slots: 0, skills: { '攻撃': 10 } }, D), false);
  assert.strictEqual(theory.isValid({ kindId: 1, slots: 0, skills: { '攻撃': 4 } }, D), true);
  /* 英雄の護石(kind8, rarity100) の攻撃は第2スキル枠のみ。単独では第1枠扱いで違法 */
  assert.strictEqual(theory.isValid({ kindId: 8, slots: 3, skills: { '攻撃': 10 } }, D), false);
  assert.strictEqual(theory.isValid({ kindId: 8, slots: 3, skills: { '聴覚保護': 1, '攻撃': 10 } }, D), true);
  /* スキル3系統は違法 */
  assert.strictEqual(theory.isValid({ kindId: 8, slots: 3, skills: { '聴覚保護': 1, '攻撃': 10, '痛撃': 5 } }, D), false);
  /* kind の maxSlots を超えるスロ数は違法 */
  assert.strictEqual(theory.isValid({ kindId: 1, slots: 3, skills: {} }, D), false);
});

test('toCharmPayload: 生成したお守りを合法な登録 payload へ変換できる', function () {
  const list = theory.buildCharms(['攻撃', '達人'], D);
  const charm = list.filter(function (c) { return c.slots === 3 && c.skills['攻撃'] === 10; })[0];
  assert.ok(charm, '対象のお守りがあること');
  const payload = theory.toCharmPayload(charm);
  assert.strictEqual(payload.kind, charm.kindId, 'kind を保持する');
  assert.strictEqual(payload.slots, charm.slots, 'スロ数を保持する');
  assert.ok(Array.isArray(payload.skills) && payload.skills.length > 0, 'skills 配列になる');
  for (let i = 0; i < payload.skills.length; i++) {
    const skill = payload.skills[i];
    /* 第1スキル枠 → 第2スキル枠の順に、位置(1/2)を渡して検証する */
    assert.ok(D.isValidCharmSkill(payload.kind, i === 0 ? 1 : 2, skill.name, skill.pt),
      'payload のスキルが合法: ' + skill.name + '+' + skill.pt);
  }
});

test('buildCharms: 護石で振れない系統はお守りに載せない（刀匠）', function () {
  const list = theory.buildCharms(['刀匠', '攻撃'], D);
  assert.ok(list.length > 0, '攻撃ぶんは生成されること');
  assert.ok(!list.some(function (c) { return Number(c.skills['刀匠']) > 0; }), '刀匠は護石に載らない');
});

test('charmsWithSystem: 指定系統を持つお守りだけを抽出する', function () {
  const list = theory.buildCharms(['攻撃', '達人'], D);
  const filtered = theory.charmsWithSystem(list, '達人');
  assert.ok(filtered.length > 0, '抽出できること');
  assert.ok(filtered.every(function (c) { return Number(c.skills['達人']) > 0; }), '達人を持つものだけ');
});

console.log('');
console.log('--- ' + (pass + fail) + ' tests: ' + pass + ' passed, ' + fail + ' failed ---');
if (fail) {
  failures.forEach(function (f) { console.log('\n' + f.name + '\n' + ((f.e && f.e.stack) || f.e)); });
  process.exit(1);
}
