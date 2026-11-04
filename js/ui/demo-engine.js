/* ==========================================================================
   DEMO ENGINE (fallback): js/core/search-engine.js が未読込でも UI を確認できる
   ようにする簡易シミュレーター。実エンジンがある場合は app.js がそちらを優先する。
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});

  var RES_KEYS = ['fire', 'water', 'thunder', 'ice', 'dragon'];
  var RES_LABELS = { fire: '火', water: '水', thunder: '雷', ice: '氷', dragon: '龍' };

  /* 部位ごとの装備プール（フォールバック用のダミーデータ） */
  var POOL = {
    head: [
      { name: 'ギザミXRヘルム',   def: 96, res: [-3, 1, -2, 1, 0], slots: [1], pts: { '斬れ味': 3, '匠': 5 } },
      { name: 'グリードXRヘルム', def: 92, res: [-4, 0, -2, 0, 0], slots: [2], pts: { '匠': 3, '攻撃': 2 } },
      { name: 'クロオビXヘルム',  def: 62, res: [1, 1, 1, 1, 1],   slots: [2], pts: { '攻撃': 2, '達人': 2 } },
      { name: 'ナルガXヘルム',    def: 70, res: [-2, 0, -3, 2, 0], slots: [2], pts: { '回避性能': 4, '納刀': 2 } },
      { name: 'ティガXヘルム',    def: 78, res: [0, -2, 3, -1, 0], slots: [1], pts: { '攻撃': 4, '挑戦者': 2 } },
      { name: 'バルファルクヘルム', def: 84, res: [0, 0, 0, 0, -4], slots: [3], pts: { '龍気': 2, '攻撃': 2 } }
    ],
    body: [
      { name: 'グリードXRメイル', def: 98, res: [-4, 0, -2, 0, 0], slots: [3], pts: { '斬れ味': 4, '匠': 5 } },
      { name: 'ギザミXRメイル',   def: 94, res: [-3, 1, -2, 1, 0], slots: [1], pts: { '斬れ味': 3, '匠': 3 } },
      { name: 'クロオビXメイル',  def: 64, res: [1, 1, 1, 1, 1],   slots: [2], pts: { '攻撃': 2, '達人': 2 } },
      { name: 'ナルガXメイル',    def: 72, res: [-2, 0, -3, 2, 0], slots: [2], pts: { '回避性能': 3, '達人': 3 } },
      { name: 'ティガXメイル',    def: 80, res: [0, -2, 3, -1, 0], slots: [1], pts: { '攻撃': 4, '挑戦者': 3 } },
      { name: 'バルファルクメイル', def: 86, res: [0, 0, 0, 0, -4], slots: [3], pts: { '龍気': 3, '攻撃': 3 } }
    ],
    arm: [
      { name: 'ギザミXRアーム',   def: 92, res: [-3, 1, -2, 1, 0], slots: [1], pts: { '匠': 4, '斬れ味': 3 } },
      { name: 'グリードXRアーム', def: 88, res: [-4, 0, -2, 0, 0], slots: [2], pts: { '匠': 2, '攻撃': 2 } },
      { name: 'クロオビXアーム',  def: 60, res: [1, 1, 1, 1, 1],   slots: [2], pts: { '攻撃': 2, '達人': 2 } },
      { name: 'ナルガXアーム',    def: 68, res: [-2, 0, -3, 2, 0], slots: [2], pts: { '回避性能': 3, '体術': 2 } },
      { name: 'ティガXアーム',    def: 76, res: [0, -2, 3, -1, 0], slots: [1], pts: { '攻撃': 4, '挑戦者': 2 } },
      { name: 'バルファルクアーム', def: 82, res: [0, 0, 0, 0, -4], slots: [2], pts: { '龍気': 2, '攻撃': 2 } }
    ],
    waist: [
      { name: 'グリードXRフォールド', def: 94, res: [-4, 0, -2, 0, 0], slots: [3], pts: { '斬れ味': 5, '匠': 6 } },
      { name: 'ギザミXRフォールド',   def: 90, res: [-3, 1, -2, 1, 0], slots: [1], pts: { '斬れ味': 2, '匠': 2 } },
      { name: 'クロオビXフォールド',  def: 58, res: [1, 1, 1, 1, 1],   slots: [2], pts: { '攻撃': 2, '達人': 2 } },
      { name: 'ナルガXフォールド',    def: 66, res: [-2, 0, -3, 2, 0], slots: [2], pts: { '回避性能': 4, '納刀': 2 } },
      { name: 'ティガXフォールド',    def: 74, res: [0, -2, 3, -1, 0], slots: [1], pts: { '攻撃': 3, '挑戦者': 3 } },
      { name: 'バルファルクフォールド', def: 80, res: [0, 0, 0, 0, -4], slots: [2], pts: { '龍気': 3, '攻撃': 2 } }
    ],
    leg: [
      { name: 'グリードXRグリーヴ', def: 96, res: [-4, 0, -2, 0, 0], slots: [3], pts: { '斬れ味': 4, '匠': 5 } },
      { name: 'ギザミXRグリーヴ',   def: 92, res: [-3, 1, -2, 1, 0], slots: [1], pts: { '斬れ味': 3, '匠': 2 } },
      { name: 'クロオビXグリーヴ',  def: 60, res: [1, 1, 1, 1, 1],   slots: [2], pts: { '攻撃': 2, '達人': 2 } },
      { name: 'ナルガXグリーヴ',    def: 68, res: [-2, 0, -3, 2, 0], slots: [2], pts: { '回避性能': 3, '体術': 2 } },
      { name: 'ティガXグリーヴ',    def: 76, res: [0, -2, 3, -1, 0], slots: [1], pts: { '攻撃': 4, '挑戦者': 2 } },
      { name: 'バルファルクグリーヴ', def: 82, res: [0, 0, 0, 0, -4], slots: [3], pts: { '龍気': 2, '攻撃': 3 } }
    ]
  };

  var JEWEL_NAMES = {
    '達人': '達人珠', '痛撃': '痛撃珠', '匠': '匠珠', '斬れ味': '斬鉄珠',
    '会心強化': '会心珠', '攻撃': '攻撃珠', '聴覚保護': '防音珠', '回避性能': '回避珠',
    '体力': '体力珠', '防御': '防御珠', '挑戦者': '闘士珠', '通常弾強化': '通常弾珠',
    '貫通弾強化': '貫通弾珠', '散弾強化': '散弾珠', '装填数': '装填珠', '装填速度': '速装珠',
    '反動': '抑反珠', '属性攻撃': '属攻珠', '火属性攻撃': '火炎珠', '水属性攻撃': '流水珠',
    '雷属性攻撃': '雷光珠', '氷属性攻撃': '氷結珠', '龍属性攻撃': '破龍珠', '溜め': '短縮珠',
    '抜刀': '抜刀珠', '納刀': '納刀珠', 'ガード性能': '鉄壁珠', '広域': '広域珠',
    '精霊の加護': '加護珠', 'スタミナ': 'スタ珠', 'ランナー': '走者珠', '体術': '体術珠',
    '回復速度': '回復珠', '回復量': '治癒珠', '龍気': '龍気珠', '不屈': '不屈珠',
    '逆上': '逆上珠', '底力': '底力珠', '火事場力': '火事場珠', '本気': '本気珠',
    '連撃': '連撃珠', '剣術': '剣術珠', '乗り': '乗り珠', '風圧': '風圧珠', '耐震': '耐震珠'
  };

  function skillsOf() {
    if (MHXX.skillIndex && MHXX.skillIndex.all && MHXX.skillIndex.all.length) {
      return MHXX.skillIndex.all;
    }
    return (MHXX.fallbackData && MHXX.fallbackData.skills) || [];
  }

  function buildThresholds() {
    var map = {};
    skillsOf().forEach(function (skill) {
      var group = skill.group || skill.name;
      (map[group] || (map[group] = [])).push(skill);
    });
    Object.keys(map).forEach(function (group) {
      map[group].sort(function (a, b) { return a.threshold - b.threshold; });
    });
    return map;
  }

  /* 装飾品名を組み立てる。
     JEWEL_NAMES の値は既に「珠」で終わる（例: 達人珠）ため、そのまま連結すると
     「達人珠珠【3】」になる。末尾が「珠」なら二重付与せず、レベル表記（【N】）のみ
     呼び出し側で連結する。 */
  function jewelName(group) {
    var base = String(JEWEL_NAMES[group] || group || '');
    base = base.replace(/【\d+】$/, '').trim();
    if (!base) return '';
    if (/珠$/.test(base)) return base;
    return base + '珠';
  }

  function clonePoints(points) {
    var out = {};
    Object.keys(points || {}).forEach(function (key) { out[key] = points[key]; });
    return out;
  }

  function addPoints(target, source, scale) {
    Object.keys(source || {}).forEach(function (key) {
      target[key] = (target[key] || 0) + source[key] * (scale || 1);
    });
  }

  function sumRes(a, b) {
    return a.map(function (value, index) { return value + (b[index] || 0); });
  }

  function makePart(key, source, extraSlots) {
    var slots = (source.slots || []).slice();
    if (extraSlots) slots = slots.concat(extraSlots);
    return {
      key: key,
      name: source.name,
      slots: slots,
      decos: [],
      points: clonePoints(source.pts),
      basePoints: clonePoints(source.pts)
    };
  }

  var PART_ORDER = ['weapon', 'head', 'body', 'arm', 'waist', 'leg', 'charm'];

  function partList(parts) {
    return PART_ORDER.map(function (key) { return parts[key]; }).filter(Boolean);
  }

  function totalSlots(parts) {
    return partList(parts).reduce(function (sum, part) { return sum + part.slots.length; }, 0);
  }

  function usedSlots(part) {
    return part.decos.reduce(function (sum, deco) { return sum + deco.level; }, 0);
  }

  function freeSlots(part) {
    return part.slots.length - usedSlots(part);
  }

  function topSkillForGroup(group, points, thresholds) {
    var list = thresholds[group] || [];
    var best = null;
    list.forEach(function (skill) {
      if (points >= skill.threshold) best = skill;
    });
    return best;
  }

  function activatedSkills(totals, thresholds) {
    var out = [];
    Object.keys(totals).forEach(function (group) {
      var skill = topSkillForGroup(group, totals[group], thresholds);
      if (skill) {
        out.push({ name: skill.name, group: group, points: totals[group], threshold: skill.threshold });
      }
    });
    return out;
  }

  function suggestions(totals, selectedGroups, thresholds) {
    var out = [];
    Object.keys(thresholds).forEach(function (group) {
      if (selectedGroups[group]) return;
      var lowest = thresholds[group][0];
      if (!lowest) return;
      var points = totals[group] || 0;
      if (points >= lowest.threshold) {
        out.push({ name: lowest.name, group: group, reason: '残り' + (points - lowest.threshold) + 'pt' });
      }
    });
    return out.slice(0, 6);
  }

  /* 装飾品を空きスロットへ貪欲に割り当てる */
  function assignDecos(parts, totals, needs) {
    var groups = Object.keys(needs).filter(function (group) { return needs[group] > 0; });
    if (!groups.length) return;

    partList(parts).forEach(function (part) {
      while (freeSlots(part) > 0) {
        var target = null;
        for (var i = 0; i < groups.length; i++) {
          if (needs[groups[i]] > 0) { target = groups[i]; break; }
        }
        if (!target) break;

        var remaining = freeSlots(part);
        var level = Math.min(3, remaining, Math.max(1, needs[target]));
        var points = level;
        part.decos.push({
          name: jewelName(target) + '【' + level + '】',
          level: level,
          group: target,
          points: points
        });
        part.points[target] = (part.points[target] || 0) + points;
        totals[target] = (totals[target] || 0) + points;
        needs[target] -= points;
        if (needs[target] <= 0) {
          groups = groups.filter(function (group) { return needs[group] > 0; });
        }
      }
    });
  }

  function makeCharmSource(charm) {
    var pts = {};
    (charm.skills || []).forEach(function (entry) {
      var group = Array.isArray(entry) ? entry[0] : (entry.group || entry.name);
      var points = Array.isArray(entry) ? entry[1] : (entry.points != null ? entry.points : entry.pt);
      if (group) pts[group] = (pts[group] || 0) + (Number(points) || 0);
    });
    var slotCount = Number(charm.slots || charm.slot || 0) || 0;
    var slots = [];
    for (var i = 0; i < slotCount; i++) slots.push(1);
    return {
      name: charmLabel(charm),
      slots: slots,
      pts: pts
    };
  }

  function charmLabel(charm) {
    var parts = (charm.skills || []).map(function (entry) {
      var group = Array.isArray(entry) ? entry[0] : (entry.group || entry.name);
      var points = Array.isArray(entry) ? entry[1] : (entry.points != null ? entry.points : entry.pt);
      return group + (Number(points) > 0 ? '+' : '') + points;
    });
    var slotCount = Number(charm.slots || charm.slot || 0) || 0;
    return (charm.type || charm.name || '護石') + (parts.length ? ' ' + parts.join(' ') : '') +
      (slotCount ? ' スロ' + slotCount : '');
  }

  function pickCharm(state, selectedGroups) {
    var charms = state.charms || [];
    if (state.charmMode === 'single' && state.charmId) {
      var found = charms.filter(function (charm) {
        return String(charm.id) === String(state.charmId);
      })[0];
      if (found) return found;
    }
    if (!charms.length) return null;

    /* 全検索モードでは、選択スキルの系統に多くポイントを持つお守りを優先 */
    var best = charms[0];
    var bestScore = -1;
    charms.forEach(function (charm) {
      var score = 0;
      (charm.skills || []).forEach(function (entry) {
        var group = Array.isArray(entry) ? entry[0] : (entry.group || entry.name);
        var points = Array.isArray(entry) ? entry[1] : (entry.points != null ? entry.points : entry.pt);
        if (selectedGroups && selectedGroups[group]) score += Number(points) || 0;
      });
      if (score > bestScore) { bestScore = score; best = charm; }
    });
    return best;
  }

  function search(state) {
    var thresholds = buildThresholds();
    var selected = (state.skills || []).filter(function (skill) { return skill && skill.group; });
    var selectedGroups = {};
    selected.forEach(function (skill) { selectedGroups[skill.group] = true; });

    var charm = pickCharm(state, selectedGroups);
    var charmSource = charm ? makeCharmSource(charm) : { name: 'なし', slots: [], pts: {} };

    var weaponSlotCount = Math.max(0, Math.min(3, Number(state.weaponSlots) || 0));
    var weapon = {
      name: 'スロット' + weaponSlotCount,
      slots: (function () { var out = []; for (var i = 0; i < weaponSlotCount; i++) out.push(1); return out; })(),
      pts: {}
    };

    var gender = state.gender || 'both';
    var type = state.type || 'blade';

    function filterPool(list) {
      return list.filter(function (item) {
        if (item.gender && item.gender !== 'both' && gender !== 'both' && item.gender !== gender) return false;
        if (item.type && item.type !== 'both' && item.type !== type) return false;
        return true;
      });
    }

    var pools = {
      head: filterPool(POOL.head),
      body: filterPool(POOL.body),
      arm: filterPool(POOL.arm),
      waist: filterPool(POOL.waist),
      leg: filterPool(POOL.leg)
    };

    var candidates = [];
    pools.head.forEach(function (head) {
      pools.body.forEach(function (body) {
        pools.arm.forEach(function (arm) {
          pools.waist.forEach(function (waist) {
            pools.leg.forEach(function (leg) {
              var parts = {
                weapon: makePart('weapon', weapon),
                head: makePart('head', head),
                body: makePart('body', body),
                arm: makePart('arm', arm),
                waist: makePart('waist', waist),
                leg: makePart('leg', leg),
                charm: makePart('charm', charmSource)
              };

              var totals = {};
              partList(parts).forEach(function (part) { addPoints(totals, part.points); });

              var defense = head.def + body.def + arm.def + waist.def + leg.def;
              var resist = [0, 0, 0, 0, 0];
              [head, body, arm, waist, leg].forEach(function (item) { resist = sumRes(resist, item.res); });

              /* 空きスロットへ装飾品を割り当ててから条件判定する */
              var needs = {};
              selected.forEach(function (skill) {
                var have = totals[skill.group] || 0;
                var need = (skill.threshold || 10) - have;
                if (need > 0) needs[skill.group] = need;
              });
              assignDecos(parts, totals, needs);

              var matched = 0;
              selected.forEach(function (skill) {
                if ((totals[skill.group] || 0) >= (skill.threshold || 10)) matched++;
              });

              candidates.push({
                parts: parts,
                totals: totals,
                defense: defense,
                resist: resist,
                matched: matched,
                emptySlots: partList(parts).reduce(function (sum, part) {
                  return sum + freeSlots(part);
                }, 0),
                activated: activatedSkills(totals, thresholds),
                extraSuggestions: suggestions(totals, selectedGroups, thresholds),
                resistSum: resist.reduce(function (sum, value) { return sum + value; }, 0)
              });
            });
          });
        });
      });
    });

    /* 選択スキルの充足数を優先し、次に防御力で並べる */
    candidates.sort(function (a, b) {
      if (b.matched !== a.matched) return b.matched - a.matched;
      return b.defense - a.defense;
    });

    var bestMatched = candidates.length ? candidates[0].matched : 0;
    var needAll = selected.length;
    var pool = bestMatched >= needAll ? candidates.filter(function (item) { return item.matched === needAll; }) : candidates;
    pool = pool.slice(0, 80);

    var sortKey = state.sort || 'defense';
    pool.sort(function (a, b) {
      if (sortKey === 'slots') {
        if (b.emptySlots !== a.emptySlots) return b.emptySlots - a.emptySlots;
        return b.defense - a.defense;
      }
      if (sortKey === 'resist') {
        if (b.resistSum !== a.resistSum) return b.resistSum - a.resistSum;
        return b.defense - a.defense;
      }
      return b.defense - a.defense;
    });

    var results = pool.slice(0, 24).map(function (candidate, index) {
      var resist = {};
      RES_KEYS.forEach(function (key, i) { resist[key] = candidate.resist[i]; });
      return {
        id: 'demo-' + (index + 1),
        rank: index + 1,
        defense: candidate.defense,
        resist: resist,
        resistSum: candidate.resistSum,
        parts: candidate.parts,
        totals: candidate.totals,
        activated: candidate.activated,
        extraSuggestions: candidate.extraSuggestions,
        emptySlots: candidate.emptySlots,
        nasetsu: false,
        douMultiplier: 0
      };
    });

    var extra = results.length ? results[0].extraSuggestions : [];

    return {
      results: results,
      extraSuggestions: extra,
      meta: { engine: 'demo', total: pool.length }
    };
  }

  MHXX.demoEngine = {
    search: search,
    charmLabel: charmLabel,
    RES_KEYS: RES_KEYS,
    RES_LABELS: RES_LABELS
  };
})(window);
