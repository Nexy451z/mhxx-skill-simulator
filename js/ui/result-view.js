/* ==========================================================================
   UI: 右ペイン下段 - 検索結果ヘッダー / ページャー / スキルポイント内訳マトリクス
   --------------------------------------------------------------------------
   - result.parts / result.equipments のどちらの形でも部位情報を解決する
   - 胴系統倍加（torsoUp）・ネセト一式・代替防具候補・マイナススキルを可視化
   - 0 件時はお守りモード切替 / スキル解除などのリカバリ UI を表示する
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var PART_ORDER = ['weapon', 'head', 'body', 'arm', 'waist', 'leg', 'charm'];
  var PART_META = {
    weapon: { label: '武器', icon: 'sword' },
    head:   { label: '頭',   icon: 'head' },
    body:   { label: '胴',   icon: 'body' },
    arm:    { label: '腕',   icon: 'arm' },
    waist:  { label: '腰',   icon: 'waist' },
    leg:    { label: '脚',   icon: 'leg' },
    charm:  { label: '護石', icon: 'charm' }
  };

  /* result.parts / result.equipments を吸収するための部位エイリアス */
  var PART_ALIASES = {
    weapon: ['weapon', 'weaponPart', '武器'],
    head:   ['head', 'headPart', '頭'],
    body:   ['body', 'chest', 'bodyPart', '胴'],
    arm:    ['arm', 'arms', 'armPart', '腕'],
    waist:  ['waist', 'waistPart', '腰'],
    leg:    ['leg', 'legs', 'legPart', '脚'],
    charm:  ['charm', 'omamori', '護石', 'お守り']
  };
  /* 部位が数値インデックスで返るエンジン向け（0=頭 〜 4=脚 / 5=護石 / 6=武器） */
  var PART_INDEX_KEYS = ['head', 'body', 'arm', 'waist', 'leg', 'charm', 'weapon'];
  var PART_SOURCE_KEYS = ['parts', 'equipments', 'equipment', 'equip', 'set', 'armor'];

  var RES_KEYS = ['fire', 'water', 'thunder', 'ice', 'dragon'];
  var RES_LABELS = { fire: '火', water: '水', thunder: '雷', ice: '氷', dragon: '龍' };
  var DECO_COLORS = { 1: '#0052cc', 2: '#2e7d32', 3: '#8e24aa' };

  var NESET_CHARM_MULT = 2;
  var NESET_BONUS_PT = 2;
  var MAX_GROUPS = 16;

  var countNode = null;
  var selectNode = null;
  var prevBtn = null;
  var nextBtn = null;
  var sortSelect = null;
  var badges = null;
  var table = null;
  var tableWrap = null;
  var emptyNode = null;
  var panel = null;

  /* ------------------------------------------------------------------------
     ユーティリティ
     ---------------------------------------------------------------------- */

  function esc(value) {
    if (typeof kit.esc === 'function') return kit.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function icon(name, cls) {
    if (typeof kit.icon === 'function') return kit.icon(name, cls);
    return '';
  }

  function signed(value) {
    if (typeof kit.signed === 'function') return kit.signed(value);
    var num = Number(value) || 0;
    return (num > 0 ? '+' : '') + num;
  }

  function slotDotsHTML(count) {
    if (typeof kit.slotDots === 'function') return kit.slotDots(count);
    return '';
  }

  function toNum(value, fallback) {
    var num = Number(value);
    return isFinite(num) ? num : (typeof fallback === 'number' ? fallback : 0);
  }

  function firstNum(values, fallback) {
    for (var i = 0; i < values.length; i++) {
      var value = values[i];
      if (value === null || value === undefined || value === '') continue;
      var num = Number(value);
      if (!isNaN(num)) return num;
    }
    return typeof fallback === 'number' ? fallback : 0;
  }

  function delegate(root, selector, handler) {
    if (!root) return;
    root.addEventListener('click', function (event) {
      var node = event.target;
      var target = node && node.closest ? node.closest(selector) : null;
      if (!target || !root.contains(target)) return;
      handler(event, target);
    });
  }

  function currentResult() {
    var state = MHXX.store.get();
    var results = state.results || [];
    var index = Math.min(Math.max(0, state.resultIndex || 0), Math.max(0, results.length - 1));
    return { state: state, results: results, index: index, result: results[index] || null };
  }

  /* ------------------------------------------------------------------------
     部位データの解決（parts / equipments 両対応）
     ---------------------------------------------------------------------- */

  function normalizePoints(raw) {
    var out = {};
    if (!raw) return out;

    if (Array.isArray(raw)) {
      raw.forEach(function (entry) {
        if (!entry) return;
        if (Array.isArray(entry)) {
          if (entry[0]) out[entry[0]] = (out[entry[0]] || 0) + toNum(entry[1], 0);
          return;
        }
        if (typeof entry === 'string') {
          var match = entry.match(/^(.+?)([+-]?\d+)$/);
          if (match) out[match[1].trim()] = (out[match[1].trim()] || 0) + toNum(match[2], 0);
          return;
        }
        if (typeof entry === 'object') {
          var group = entry.group || entry.system || entry.name || entry.skill;
          if (!group) return;
          var points = entry.points != null ? entry.points : (entry.pt != null ? entry.pt : entry.value);
          out[group] = (out[group] || 0) + toNum(points, 0);
        }
      });
      return out;
    }

    if (typeof raw === 'object') {
      Object.keys(raw).forEach(function (key) {
        var num = Number(raw[key]);
        if (!isNaN(num)) out[key] = (out[key] || 0) + num;
      });
    }
    return out;
  }

  function normalizeSlots(raw) {
    if (raw === null || raw === undefined) return [];
    if (typeof raw === 'number') {
      var count = Math.max(0, Math.min(3, Math.floor(raw)));
      var arr = [];
      for (var i = 0; i < count; i++) arr.push(1);
      return arr;
    }
    if (typeof raw === 'string') {
      var parsed = Number(raw);
      return isNaN(parsed) ? [] : normalizeSlots(parsed);
    }
    if (Array.isArray(raw)) {
      var totalHoles = 0;
      raw.forEach(function (item) {
        var sz = (item && typeof item === 'object')
          ? (toNum(item.level || item.size || item.slot, 1) || 1)
          : (toNum(item, 0) || 0);
        if (sz > 0) totalHoles += sz;
      });
      return normalizeSlots(totalHoles);
    }
    if (typeof raw === 'object') {
      return normalizeSlots(firstNum([raw.count, raw.length], 0));
    }
    return [];
  }

  function normalizeDecos(raw) {
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : [raw];
    return list.map(function (item) {
      if (typeof item === 'string') {
        var match = item.match(/【(\d)】/);
        return { name: item, level: match ? Number(match[1]) : 1 };
      }
      if (item && typeof item === 'object') {
        return {
          name: item.name || item.decoName || item.title || '装飾品',
          level: firstNum([item.level, item.size, item.slot], 1) || 1
        };
      }
      return null;
    }).filter(Boolean);
  }

  function normalizeAlternatives(raw) {
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.keys(raw).map(function (key) { return raw[key]; }) : [raw]);
    return list.map(function (item) {
      if (!item) return '';
      if (typeof item === 'string') return item;
      if (typeof item === 'number') return String(item);
      return String(item.name || item.equipName || item.title || item.armorName || '');
    }).filter(function (name) { return name && name !== '-'; }).slice(0, 12);
  }

  function arrayToPartMap(list) {
    var map = {};
    (list || []).forEach(function (entry) {
      if (!entry) return;
      var key = entry.key || entry.part || entry.slot || entry.partKey;
      if (typeof key === 'number') key = PART_INDEX_KEYS[key] || null;
      if (!key || !PART_ALIASES[key]) return;
      map[key] = entry;
    });
    return map;
  }

  function partSources(result) {
    var sources = [];
    if (!result) return sources;
    PART_SOURCE_KEYS.forEach(function (name) {
      var source = result[name];
      if (!source) return;
      if (Array.isArray(source)) source = arrayToPartMap(source);
      if (source && typeof source === 'object') sources.push(source);
    });
    return sources;
  }

  function findRawPart(source, key) {
    var aliases = PART_ALIASES[key] || [key];
    for (var i = 0; i < aliases.length; i++) {
      var value = source[aliases[i]];
      if (value !== undefined && value !== null) return value;
    }
    return null;
  }

  function mergePartChunk(part, chunk) {
    if (chunk === null || chunk === undefined) return;
    if (typeof chunk === 'string') {
      if (!part.name) part.name = chunk;
      return;
    }
    if (typeof chunk !== 'object') return;

    var name = chunk.name || chunk.equipName || chunk.armorName || chunk.title || chunk.itemName;
    if (!part.name && name) part.name = String(name);

    var slots = chunk.slots != null ? chunk.slots : (chunk.slotSizes || chunk.slot || chunk.slotCount || chunk.decoSlots);
    if (slots !== undefined && slots !== null) {
      var normalizedSlots = normalizeSlots(slots);
      if (normalizedSlots.length >= part.slots.length) part.slots = normalizedSlots;
    }

    /* 部位ごとの空きスロ数はエンジン / app.js の確定値を優先（スロ数と装着数の再計算ズレを防ぐ） */
    var declaredFree = chunk.freeSlots != null ? chunk.freeSlots : chunk.emptySlots;
    if (declaredFree !== null && declaredFree !== undefined && declaredFree !== '' &&
        isFinite(declaredFree)) {
      part.freeSlots = Math.max(0, Math.round(Number(declaredFree)));
    }

    var points = chunk.points || chunk.skills || chunk.pts || chunk.skillPoints;
    if (points) {
      var normalizedPoints = normalizePoints(points);
      if (Object.keys(normalizedPoints).length) part.points = normalizedPoints;
    }

    var decos = chunk.decos || chunk.decorations || chunk.jewels || chunk.gems || chunk.slotItems;
    if (decos) {
      var normalizedDecos = normalizeDecos(decos);
      if (normalizedDecos.length) part.decos = normalizedDecos;
    }

    part.isTorsoUp = part.isTorsoUp || !!(chunk.isTorsoUp || chunk.torsoUp || chunk.torsoUpPart || chunk.isDou || chunk.dou);
    part.isNeset = part.isNeset || !!(chunk.isNeset || chunk.neset || chunk.nasetsu);
    part.multiplier = Math.max(part.multiplier || 1,
      firstNum([chunk.bonusMultiplier, chunk.multiplier, chunk.charmMultiplier], 1) || 1);

    var alternatives = chunk.alternatives || chunk.alt || chunk.alts || chunk.altNames ||
      chunk.candidates || chunk.sameParts || chunk.sameNameParts;
    if (alternatives) {
      var normalizedAlternatives = normalizeAlternatives(alternatives);
      if (normalizedAlternatives.length) part.alternatives = normalizedAlternatives;
    }

    /* app.js が正規化した部位データは basePoints / decoPoints を持ち、
       points は「倍率（胴系統倍加・ネセト護石）と装飾品を反映した後の確定値」。
       素のポイントを返す生データと区別して、セル描画を切り替える。 */
    if (chunk.basePoints !== undefined || chunk.decoPoints !== undefined) {
      part.pointsAreFinal = true;
    }
  }

  function resolveParts(result) {
    var sources = partSources(result);
    var parts = {};

    PART_ORDER.forEach(function (key) {
      var part = null;
      sources.forEach(function (source) {
        var chunk = findRawPart(source, key);
        if (chunk === null || chunk === undefined) return;
        if (!part) {
          part = {
            key: key, name: '', points: {}, slots: [], decos: [],
            multiplier: 1, isTorsoUp: false, isNeset: false, alternatives: [],
            pointsAreFinal: false
          };
        }
        mergePartChunk(part, chunk);
      });

      if (!part) return;
      if (!part.name) part.name = '-';
      if (/胴系統倍加/.test(part.name)) part.isTorsoUp = true;
      parts[key] = part;
    });

    return parts;
  }

  function detectNeset(result, parts) {
    if (result.isNeset || result.nasetsu || result.naSetsu || result.isNasetsu) return true;
    return PART_ORDER.some(function (key) {
      return parts[key] && parts[key].isNeset;
    });
  }

  function detectDouCount(result, parts) {
    var count = firstNum([result.douMultiplier, result.torsoUpCount, result.torsoUp], 0);
    if (!count && result.torsoUpMultiplier) count = Math.max(0, toNum(result.torsoUpMultiplier, 1) - 1);
    if (!count) {
      count = PART_ORDER.filter(function (key) {
        return key !== 'body' && parts[key] && parts[key].isTorsoUp;
      }).length;
    }
    return Math.max(0, Math.min(4, Math.round(count)));
  }

  function buildMultipliers(parts, isNeset, douCount) {
    var multipliers = {};
    PART_ORDER.forEach(function (key) {
      var part = parts[key];
      var mult = part ? toNum(part.multiplier, 1) : 1;
      if (!(mult > 0)) mult = 1;

      if (key === 'charm' && isNeset) mult = Math.max(mult, NESET_CHARM_MULT);
      if (key === 'body' && !isNeset && mult === 1 && douCount > 0) mult = 1 + douCount;

      multipliers[key] = mult;
    });
    return multipliers;
  }

  /* result.totals / result.skills、result.activated / result.activatedSkills の
     どちらでも合計値・発動スキルを解決する */
  function resultTotals(result) {
    var raw = result.totals || result.totalPoints || result.skillTotals || result.pointTotals;
    if ((!raw || !Object.keys(raw).length) && result.skills &&
        !Array.isArray(result.skills) && typeof result.skills === 'object') {
      raw = result.skills;
    }
    return normalizePoints(raw);
  }

  function resultActivated(result) {
    var raw = result.activated || result.activatedSkills || result.activeSkills;
    var out = [];

    (Array.isArray(raw) ? raw : []).forEach(function (entry) {
      if (!entry) return;
      if (typeof entry === 'string') {
        out.push({ name: entry, group: entry, points: 0, threshold: 0 });
        return;
      }
      if (typeof entry !== 'object') return;
      var name = entry.name || entry.skill || entry.title;
      var group = entry.group || entry.system || entry.groupName || entry.systemName || name;
      if (!name || !group) return;
      out.push({
        name: name,
        group: group,
        points: firstNum([entry.points, entry.totalPt, entry.value, entry.pt], 0),
        threshold: firstNum([entry.threshold, entry.need], 0)
      });
    });

    return out;
  }

  function computeEmptySlots(parts) {
    return PART_ORDER.reduce(function (sum, key) {
      return sum + (parts[key] ? freeSlots(parts[key]) : 0);
    }, 0);
  }

  function columnGroups(totals, activated) {
    totals = totals || {};
    activated = activated || [];
    var groups = [];

    activated.forEach(function (skill) {
      if (skill.group && groups.indexOf(skill.group) === -1) groups.push(skill.group);
    });
    Object.keys(totals).forEach(function (group) {
      if (groups.indexOf(group) === -1 && (totals[group] || 0) !== 0) groups.push(group);
    });

    var rest = groups.slice(activated.length);
    rest.sort(function (a, b) { return Math.abs(totals[b] || 0) - Math.abs(totals[a] || 0); });
    groups = groups.slice(0, activated.length).concat(rest);
    return groups.slice(0, MAX_GROUPS);
  }

  function activatedMap(activated) {
    var map = {};
    (activated || []).forEach(function (skill) { map[skill.group] = skill; });
    return map;
  }

  function freeSlots(part) {
    if (!part) return 0;
    /* エンジン / app.js が算出した空きスロ数があればそれを優先する
       （武器スロ [3,3,3] のように総穴数がドット表示の上限 3 を超える形状でも正確な残数になる） */
    if (part.freeSlots !== null && part.freeSlots !== undefined && part.freeSlots !== '' &&
        isFinite(part.freeSlots)) {
      return Math.max(0, Math.round(Number(part.freeSlots)));
    }
    var slots = part.slots || [];
    var used = 0;
    (part.decos || []).forEach(function (deco) {
      var level = toNum(deco.level, 1);
      if (!(level > 0)) level = 1;
      used += Math.min(3, Math.floor(level));
    });
    return Math.max(0, slots.length - used);
  }

  function decoHTML(part) {
    var decos = (part && part.decos) || [];
    if (!decos.length) return '<span class="muted">-</span>';
    return decos.map(function (deco) {
      var color = DECO_COLORS[deco.level] || '#5e6c84';
      return '<span class="deco-badge" style="color:' + color + '" title="' + esc(deco.name) + '">' +
        icon('jewel', 'icon-sm') + esc(deco.name) + '</span>';
    }).join('');
  }

  /* ------------------------------------------------------------------------
     描画: マトリクス
     ---------------------------------------------------------------------- */

  function cellHTML(key, part, group, view) {
    var own = (part && part.points) ? toNum(part.points[group], 0) : 0;
    var mult = toNum(view.multipliers[key], 1) || 1;
    var finalPoints = !!(part && part.pointsAreFinal);

    /* ---- 正規化済みデータ（app.js 経由） ----
       part.points は「胴系統倍加 ×N / ネセト護石 ×2 と装飾品を反映した後の確定値」。
       ここへ更に ×N を重ねて描くと「+10 ×2」が 20 にも 40 にも見える二重掛け表示に
       なるため、セルには確定値だけを表示し、倍率は装備名列のタグ・注記行・
       ツールチップで説明する（合計行とセルの合計が一致する）。 */
    if (finalPoints) {
      if (!own) {
        return '<td class="cell-empty"' + (part && part.isTorsoUp
          ? ' title="胴系統倍加：胴部位のスキルポイントは胴のセルにまとめて加算されています"'
          : '') + '>-</td>';
      }

      var appliedClasses = own < 0 ? 'cell-minus' : 'cell-plus';
      var appliedTitle = group + ' ' + signed(own) + 'pt';
      if (mult > 1) {
        appliedClasses += ' cell-applied';
        appliedTitle += '（' + (key === 'charm' ? 'ネセト護石倍加' : '胴系統倍加') + ' ×' + mult + ' 適用済み）';
      }
      return '<td class="' + appliedClasses + '" title="' + esc(appliedTitle) + '">' + signed(own) + '</td>';
    }

    /* ---- 生データ（素のポイント）向けの後方互換描画 ---- */
    var torsoPt = 0;

    if (part && part.isTorsoUp && key !== 'body') {
      var bodyPart = view.parts.body;
      torsoPt = bodyPart ? toNum(bodyPart.points[group], 0) : 0;
    }

    if (torsoPt) {
      var torsoHTML = '<span class="torso-val">' + signed(torsoPt) + '</span>' +
        '<small class="torso-tag" title="胴系統倍加により、胴部位の' + esc(group) + 'ポイントがこの部位に加算されます">倍加</small>';
      if (own) torsoHTML = '<span class="torso-own">' + signed(own) + '</span> ' + torsoHTML;
      return '<td class="cell-torso" title="胴系統倍加: 胴の ' + esc(group) + ' ' + signed(torsoPt) + 'pt を加算">' +
        torsoHTML + '</td>';
    }

    if (!own) return '<td class="cell-empty">-</td>';

    var classes = own < 0 ? 'cell-minus' : 'cell-plus';
    var html = signed(own);
    var title = esc(group + ' ' + signed(own) + 'pt');

    if (mult > 1) {
      classes += ' cell-bonus';
      html += '<sup>×' + mult + '</sup>';
      title = esc(group + ' ' + signed(own) + 'pt ×' + mult + ' = ' + signed(own * mult) + 'pt');
    }

    return '<td class="' + classes + '" title="' + title + '">' + html + '</td>';
  }

  function equipCellHTML(key, part, view) {
    var name = (part && part.name) || '-';
    var slots = (part && part.slots) || [];
    var mult = toNum(view.multipliers[key], 1) || 1;

    var html = '<span class="equip-name">' + esc(name) + '</span>';

    if (part && part.isTorsoUp) {
      html += '<span class="part-tag tag-torso" title="胴系統倍加：胴部位のスキルポイントをこの部位にも適用（合計には胴のセルでまとめて反映）">胴系統倍加</span>';
    }

    if (slots.length) {
      var free = freeSlots(part);
      html += '<span class="equip-slots">' + slotDotsHTML(slots.length) +
        (free > 0 ? '<em class="free-slots">空き' + free + '</em>' : '') + '</span>';
    }

    if (mult > 1) {
      var reason = key === 'charm' ? '護石倍加' : (key === 'body' ? '胴系統倍加' : '倍加');
      if (key === 'charm' && view.isNeset) reason = 'ネセト護石倍加';
      var tagTitle = reason + '：この部位のスキルポイントを ×' + mult + ' して合計に反映済み';
      if (part && part.pointsAreFinal) tagTitle += '（セルの数値は反映後の値）';
      html += '<span class="part-tag tag-mult" title="' + esc(tagTitle) + '">' +
        esc(reason) + ' ×' + mult + '</span>';
    }

    if (part && part.alternatives && part.alternatives.length) {
      var names = part.alternatives.join(' / ');
      html += '<button type="button" class="alt-badge" data-alt-part="' + esc(key) +
        '" aria-expanded="false" title="代替候補（' + esc(names) + '）">他' + part.alternatives.length + '件</button>' +
        '<div class="alt-list" hidden>' +
          '<span class="alt-list-label">代替候補</span>' +
          '<ul>' + part.alternatives.map(function (altName) {
            return '<li>' + esc(altName) + '</li>';
          }).join('') + '</ul>' +
        '</div>';
    }

    return html;
  }

  function partRowHTML(key, view) {
    var meta = PART_META[key] || { label: key, icon: 'body' };
    var part = view.parts[key] || null;

    var cells = view.groups.map(function (group) {
      return cellHTML(key, part, group, view);
    }).join('');

    return '<tr data-part="' + esc(key) + '">' +
      '<td class="part-col"><div class="part-cell">' + icon(meta.icon, 'icon-sm') + esc(meta.label) + '</div></td>' +
      '<td class="left">' + equipCellHTML(key, part, view) + '</td>' +
      '<td class="deco-cell">' + decoHTML(part) + '</td>' +
      cells + '</tr>';
  }

  function noteRowHTML(view) {
    if (!view.isNeset && !(view.douCount > 0)) return '';
    var notes = [];
    if (view.isNeset) {
      notes.push('ネセト一式ボーナス：護石のスキルポイント ×' + NESET_CHARM_MULT +
        ' ／ 全スキル +' + NESET_BONUS_PT + 'pt（秘術）を合計に反映');
    }
    if (view.douCount > 0) {
      notes.push('胴系統倍加：胴部位のスキルポイントを ×' + (1 + view.douCount) +
        ' して合計に反映（倍加部位 ' + view.douCount + ' 箇所）');
    }
    return '<tr class="matrix-note-row"><td colspan="' + (view.groups.length + 3) + '">' +
      icon('spark', 'icon-sm spark') +
      '<span class="matrix-note-text">' + notes.map(function (note) { return esc(note); }).join('<br>') + '</span>' +
      '</td></tr>';
  }

  function totalRowHTML(view) {
    var totals = view.totals || {};
    var activated = activatedMap(view.activated);

    var cells = view.groups.map(function (group) {
      var total = toNum(totals[group], 0);
      var skill = activated[group];
      var classes = 'total-cell';
      if (skill) classes += ' is-activated';
      if (total < 0) classes += ' is-minus';

      var content = total ? String(total) : '-';
      if (skill) {
        content += '<br><small class="activated-skill' + (toNum(skill.points, 0) < 0 ? ' is-minus' : '') + '">' +
          '(' + esc(skill.name) + ')</small>';
      }

      /* 部位セルに現れない加算分（装飾品の非必須系統・ネセト秘術ボーナス）を明示する。
         これが無いと「合計 -4 なのに全セル -」となり、内訳と合計が食い違って見える。 */
      var cellSum = 0;
      PART_ORDER.forEach(function (partKey) {
        var part = view.parts[partKey];
        if (part && part.points) cellSum += toNum(part.points[group], 0);
      });
      var unallocated = total - cellSum;
      var secretOnly = view.isNeset && unallocated === NESET_BONUS_PT;
      if (unallocated !== 0 && !secretOnly) {
        var reason = view.isNeset && unallocated > NESET_BONUS_PT
          ? '装飾品などの加算分（ネセト秘術 +' + NESET_BONUS_PT + ' を含む）'
          : '装飾品など、部位別内訳の対象外で合計にのみ反映される分';
        content += '<br><small class="total-diff" title="' + esc(reason) + '">装飾品' +
          signed(unallocated) + '</small>';
      }

      return '<td class="' + classes + '">' + content + '</td>';
    }).join('');

    var notes = [];
    if (view.isNeset) notes.push('ネセト: 護石×' + NESET_CHARM_MULT + ' / 秘術+' + NESET_BONUS_PT);
    if (view.douCount > 0) notes.push('胴倍加×' + (1 + view.douCount));

    var label = '<td colspan="3" class="total-label">合計ポイント / 発動スキル' +
      (notes.length ? '<small class="total-note">' + esc(notes.join(' ・ ')) + '</small>' : '') + '</td>';

    return '<tr class="total-row">' + label + cells + '</tr>';
  }

  function renderMatrix(view) {
    if (!table) return;

    if (tableWrap) tableWrap.hidden = !view;

    if (!view) {
      table.innerHTML = '';
      return;
    }

    var groups = view.groups;
    var head = '<thead><tr>' +
      '<th class="part-col">部位</th>' +
      '<th class="equip-col">装備名</th>' +
      '<th class="deco-col">装飾品</th>' +
      groups.map(function (group) {
        return '<th title="' + esc(group) + '">' + esc(group) + '</th>';
      }).join('') +
      '</tr></thead>';

    var body = '<tbody>' +
      PART_ORDER.map(function (key) { return partRowHTML(key, view); }).join('') +
      noteRowHTML(view) +
      totalRowHTML(view) +
      '</tbody>';

    table.innerHTML = head + body;
  }

  /* ------------------------------------------------------------------------
     描画: バッジ（防御力 / 耐性 / ネセト / 倍加 / マイナス）
     ---------------------------------------------------------------------- */

  function normalizeResist(raw) {
    var out = { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 };
    if (!raw) return out;
    if (Array.isArray(raw)) {
      RES_KEYS.forEach(function (key, index) { out[key] = toNum(raw[index], 0); });
      return out;
    }
    RES_KEYS.forEach(function (key) {
      var value = raw[key];
      if (value === undefined) value = raw[RES_LABELS[key]];
      out[key] = toNum(value, 0);
    });
    return out;
  }

  function negativeSkills(activated) {
    return (activated || []).filter(function (skill) {
      return toNum(skill.points, 0) < 0;
    });
  }

  function renderBadges(view) {
    if (!badges) return;
    if (!view) {
      badges.innerHTML = '';
      return;
    }

    var result = view.result;
    var resist = normalizeResist(result.resist || result.resistances || result.resistance || result.res);
    var resistHTML = RES_KEYS.map(function (key) {
      var value = resist[key];
      return '<span class="resist-item"><em>' + RES_LABELS[key] + '</em>' +
        '<b class="' + (value < 0 ? 'is-minus' : value > 0 ? 'is-plus' : '') + '">' +
        signed(value) + '</b></span>';
    }).join('');

    var extra = '';
    if (view.isNeset) {
      extra += '<span class="badge badge-nasetsu" title="ネセト一式：護石のスキルポイント ×' +
        NESET_CHARM_MULT + '、全スキル +' + NESET_BONUS_PT + 'pt（秘術ボーナス）を合計に反映">' +
        icon('spark', 'icon-sm') + ' ネセト一式（護石×' + NESET_CHARM_MULT + ' / 秘術+' + NESET_BONUS_PT + '）</span>';
    }
    if (view.douCount > 0) {
      extra += '<span class="badge badge-dou" title="胴系統倍加：胴部位のスキルポイントを ×' +
        (1 + view.douCount) + ' して合計に反映">胴系統倍加 ×' + (1 + view.douCount) + '</span>';
    }
    if (view.emptySlots !== null && view.emptySlots !== undefined) {
      extra += '<span class="badge badge-slots">空きスロ ' + view.emptySlots + '</span>';
    }

    var negative = negativeSkills(view.activated);
    if (negative.length) {
      var negativeTitle = negative.map(function (skill) {
        return skill.name + ' ' + signed(skill.points);
      }).join(' / ');
      extra += '<span class="badge badge-minus" title="' + esc(negativeTitle) + '">' +
        icon('close', 'icon-sm') + ' マイナススキル ' + negative.length + '件</span>';
    }

    badges.innerHTML =
      '<span class="def-badge">' + icon('shield', 'icon-sm') +
      ' 防御力: ' + esc(result.defense != null ? result.defense : '-') + '</span>' +
      '<span class="resist-line">耐性: ' + resistHTML + '</span>' +
      extra;
  }

  /* ------------------------------------------------------------------------
     描画: ページャー
     ---------------------------------------------------------------------- */

  function renderPager(state) {
    var results = state.results || [];
    var index = Math.min(Math.max(0, state.resultIndex || 0), Math.max(0, results.length - 1));

    if (countNode) {
      if (!results.length) {
        countNode.textContent = '検索結果 0件';
      } else {
        countNode.textContent = '検索結果 ' + results.length + '件中 #' + (index + 1) + ' を表示';
      }
    }

    if (selectNode) {
      selectNode.innerHTML = results.map(function (result, i) {
        var defense = result && result.defense != null ? ' (防御' + result.defense + ')' : '';
        return '<option value="' + i + '"' + (i === index ? ' selected' : '') + '>#' +
          (i + 1) + defense + '</option>';
      }).join('');
      selectNode.disabled = results.length === 0;
    }

    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= results.length - 1;

    if (sortSelect) sortSelect.value = state.sort || 'defense';

    var headerBadge = document.getElementById('headerResultBadge');
    if (headerBadge) {
      headerBadge.textContent = results.length ? ('検索結果 ' + results.length + '件') : '検索結果 0件';
    }
    var mbbSkill = document.getElementById('mbbSkillCount');
    if (mbbSkill) {
      mbbSkill.textContent = '選択スキル ' + ((state.skills || []).length) + '個';
    }
    var mbbRes = document.getElementById('mbbResultCount');
    if (mbbRes) {
      mbbRes.textContent = results.length ? ('結果 ' + results.length + '件 (防御' + (results[0].defense || '-') + ')') : '結果 0件';
    }
  }

  /* ------------------------------------------------------------------------
     描画: 0件時のリカバリ UI
     ---------------------------------------------------------------------- */

  function renderEmpty(state) {
    if (!emptyNode) return;

    var results = state.results || [];
    if (results.length) {
      emptyNode.hidden = true;
      emptyNode.innerHTML = '';
      return;
    }
    if (state.status === 'searching') {
      emptyNode.hidden = true;
      return;
    }

    var skills = state.skills || [];
    var charmSingle = state.charmMode === 'single';
    var weaponSlots = toNum(state.weaponSlots, 0);

    var actions = [];
    if (charmSingle) {
      actions.push('<button type="button" class="btn btn-primary btn-sm" data-empty-action="charm-all">' +
        icon('charm', 'icon-sm') + ' お守りを「手持ち全検索」に切り替える</button>');
    } else {
      actions.push('<span class="empty-note">' + icon('check', 'icon-sm') +
        ' お守りは「手持ち全検索」モードです</span>');
    }
    if (weaponSlots < 3) {
      actions.push('<button type="button" class="btn btn-sm" data-empty-action="weapon-slots">' +
        icon('sword', 'icon-sm') + ' 武器スロットを1つ増やす</button>');
    } else {
      actions.push('<span class="empty-note">武器スロットは最大（スロ3）です</span>');
    }
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-empty-action="retry">' +
      icon('search', 'icon-sm') + ' 条件を変えずに再検索</button>');

    var skillChips = skills.map(function (skill) {
      return '<button type="button" class="empty-skill-chip" data-empty-action="remove-skill" data-skill="' +
        esc(skill.name) + '" title="' + esc(skill.name) + ' を外して再検索">' +
        icon('close', 'icon-xs') + '<span>' + esc(skill.name) + '</span></button>';
    }).join('');

    var tips = [
      'スキルの数を 2〜3 個に絞るとヒットしやすくなります',
      '必要ポイントの低いスキル（+1 / +2 など）から試してください',
      'お守り（スロット付き）や武器スロットを増やすと候補が広がります'
    ];

    emptyNode.hidden = false;
    emptyNode.innerHTML =
      '<div class="empty-state empty-recovery">' +
        icon('search', 'icon-lg') +
        '<p>条件に合う装備が見つかりませんでした</p>' +
        '<span class="muted">' + (skills.length
          ? '条件を1つ緩めるだけで見つかることがあります'
          : 'STEP 3 でスキルを選択すると検索が始まります') + '</span>' +
        '<div class="empty-actions">' + actions.join('') + '</div>' +
        (skills.length
          ? '<div class="empty-skill-chips"><span class="empty-chips-label">外して再検索:</span>' + skillChips + '</div>'
          : '') +
        '<ul class="empty-tips">' + tips.map(function (tip) {
          return '<li>' + esc(tip) + '</li>';
        }).join('') + '</ul>' +
      '</div>';
  }

  /* ------------------------------------------------------------------------
     イベント
     ---------------------------------------------------------------------- */

  function handleEmptyAction(event, target) {
    event.preventDefault();
    var action = target.getAttribute('data-empty-action');
    var store = MHXX.store;
    if (!store || !action) return;

    var state = store.get();

    if (action === 'charm-all') {
      store.patch({ charmMode: 'all', charmId: null, resultIndex: 0 });
      if (typeof kit.toast === 'function') kit.toast('お守りを「手持ち全検索」モードに切り替えました');
      return;
    }

    if (action === 'remove-skill') {
      var name = target.getAttribute('data-skill');
      store.patch({
        skills: (state.skills || []).filter(function (skill) { return skill.name !== name; }),
        resultIndex: 0
      });
      MHXX.bus.emit('skills:sync');
      return;
    }

    if (action === 'weapon-slots') {
      store.patch({ weaponSlots: Math.min(3, toNum(state.weaponSlots, 0) + 1), resultIndex: 0 });
      if (typeof kit.toast === 'function') kit.toast('武器スロットを増やして再検索します');
      return;
    }

    if (action === 'retry') {
      if (typeof store.refresh === 'function') store.refresh();
      else store.patch({ resultIndex: 0 });
    }
  }

  function handleAltToggle(event, button) {
    event.preventDefault();
    var list = button.nextElementSibling;
    if (!list || !list.classList.contains('alt-list')) return;
    var willOpen = !!list.hidden;
    list.hidden = !willOpen;
    button.classList.toggle('is-open', willOpen);
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  /* ------------------------------------------------------------------------
     エントリポイント
     ---------------------------------------------------------------------- */

  function buildView(result) {
    if (!result) return null;
    var parts = resolveParts(result);
    var totals = resultTotals(result);
    var activated = resultActivated(result);
    var isNeset = detectNeset(result, parts);
    var douCount = detectDouCount(result, parts);
    var emptySlots = result.emptySlots;
    if (emptySlots === undefined || emptySlots === null) emptySlots = result.freeSlots;
    if (emptySlots === undefined || emptySlots === null) emptySlots = computeEmptySlots(parts);

    return {
      result: result,
      parts: parts,
      totals: totals,
      activated: activated,
      isNeset: isNeset,
      douCount: douCount,
      emptySlots: toNum(emptySlots, 0),
      multipliers: buildMultipliers(parts, isNeset, douCount),
      groups: columnGroups(totals, activated)
    };
  }

  function render() {
    var ctx = currentResult();
    var view = buildView(ctx.result);
    renderPager(ctx.state);
    renderBadges(view);
    renderMatrix(view);
    renderEmpty(ctx.state);
    if (panel) panel.classList.toggle('has-result', !!view);
  }

  function init() {
    countNode = document.getElementById('resultCount');
    selectNode = document.getElementById('resultSelect');
    prevBtn = document.getElementById('prevResult');
    nextBtn = document.getElementById('nextResult');
    sortSelect = document.getElementById('sortSelect');
    badges = document.getElementById('resultBadges');
    table = document.getElementById('matrixTable');
    emptyNode = document.getElementById('resultEmpty');
    panel = document.getElementById('resultPanel');
    tableWrap = table && table.parentNode && table.parentNode.classList &&
      table.parentNode.classList.contains('matrix-scroll') ? table.parentNode : null;

    if (selectNode) {
      selectNode.addEventListener('change', function () {
        MHXX.store.patch({ resultIndex: Number(selectNode.value) || 0 });
      });
    }
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        var state = MHXX.store.get();
        MHXX.store.patch({ resultIndex: Math.max(0, (state.resultIndex || 0) - 1) });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        var state = MHXX.store.get();
        var max = Math.max(0, (state.results || []).length - 1);
        MHXX.store.patch({ resultIndex: Math.min(max, (state.resultIndex || 0) + 1) });
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        MHXX.store.patch({ sort: sortSelect.value, resultIndex: 0 });
      });
    }

    delegate(table, '[data-alt-part]', handleAltToggle);
    delegate(emptyNode, '[data-empty-action]', handleEmptyAction);

    MHXX.bus.on('state', render);
    MHXX.bus.on('results', render);
    MHXX.bus.on('search:start', function () {
      if (countNode) countNode.textContent = '検索中...';
      if (emptyNode) emptyNode.hidden = true;
    });
    MHXX.bus.on('search:progress', function (progress) {
      if (emptyNode) emptyNode.hidden = true;
      if (!countNode) return;
      var percent = Number(progress);
      if (!isFinite(percent)) return;
      if (percent <= 1) percent *= 100;
      countNode.textContent = '検索中... ' + Math.min(100, Math.max(0, Math.round(percent))) + '%';
    });
    render();
  }

  MHXX.ui.resultView = { init: init, render: render };
})(window);
