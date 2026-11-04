/* ==========================================================================
   UI: STEP 3 スキル一覧（カテゴリタブ + インクリメンタルサーチ）
   - MHXX.skillIndex / MHXX.categories を元に描画
   - 系統名（達人・痛撃など）でもヒットする
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var grid = null;
  var tabs = null;
  var input = null;
  var empty = null;
  var count = null;

  function selectedNames() {
    var map = {};
    (MHXX.store.get().skills || []).forEach(function (skill) { map[skill.name] = true; });
    return map;
  }

  function filterSkills(state) {
    var all = (MHXX.skillIndex && MHXX.skillIndex.all) || [];
    var keyword = (state.keyword || '').trim().toLowerCase();
    var category = state.category || 'recommended';
    /* 検索中（キーワードあり）は選択中カテゴリに縛らず全スキルから探す。
       カテゴリタブは「絞り込みをしていないときの一覧」の切り替えとして扱う。 */
    var searching = !!keyword;

    return all.filter(function (skill) {
      if (state.type === 'blade' && skill.weapon === 'gunner') return false;
      if (state.type === 'gunner' && skill.weapon === 'blade') return false;

      if (!searching && category !== 'all') {
        if (category === 'recommended') {
          if (!skill.recommended) return false;
        } else if (skill.category !== category) {
          return false;
        }
      }

      if (!keyword) return true;
      var name = (skill.name || '').toLowerCase();
      var group = (skill.group || '').toLowerCase();
      return name.indexOf(keyword) !== -1 || group.indexOf(keyword) !== -1;
    });
  }

  function chipHTML(skill, isSelected) {
    return '<div class="skill-chip' + (isSelected ? ' selected' : '') + '"' +
      ' data-name="' + kit.esc(skill.name) + '"' +
      ' data-group="' + kit.esc(skill.group) + '"' +
      ' data-threshold="' + (skill.threshold || 10) + '"' +
      ' title="' + kit.esc(skill.group + ' / ' + (skill.threshold || 10) + 'pt') + '"' +
      ' role="button" tabindex="0" aria-pressed="' + (isSelected ? 'true' : 'false') + '">' +
      kit.icon(isSelected ? 'check' : 'plus', 'chip-icon') +
      '<span>' + kit.esc(skill.name) + '</span></div>';
  }

  function renderTabs(state) {
    if (!tabs) return;
    var categories = MHXX.categories || [];
    tabs.innerHTML = categories.map(function (category) {
      var active = (state.category || 'recommended') === category.id;
      return '<span data-category="' + kit.esc(category.id) + '"' +
        (active ? ' class="active"' : '') + ' role="tab" tabindex="0">' +
        kit.esc(category.label) + '</span>';
    }).join('');
  }

  function renderGrid() {
    if (!grid) return;
    var state = MHXX.store.get();
    var selected = selectedNames();
    var list = filterSkills(state);

    grid.innerHTML = list.map(function (skill) {
      return chipHTML(skill, !!selected[skill.name]);
    }).join('');

    if (empty) empty.hidden = list.length !== 0;
    if (count) count.textContent = list.length + '件';
  }

  function render() {
    var state = MHXX.store.get();
    renderTabs(state);
    renderGrid();
  }

  function syncSelection() {
    if (!grid) return;
    var selected = selectedNames();
    kit.qa('.skill-chip', grid).forEach(function (chip) {
      var isSelected = !!selected[chip.getAttribute('data-name')];
      chip.classList.toggle('selected', isSelected);
      chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      var use = chip.querySelector('use');
      if (use) use.setAttribute('href', isSelected ? '#icon-check' : '#icon-plus');
    });
  }

  function init() {
    grid = document.getElementById('skillGrid');
    tabs = document.getElementById('categoryTabs');
    input = document.getElementById('skillSearch');
    empty = document.getElementById('skillEmpty');
    count = document.getElementById('skillCount');
    if (!grid) return;

    if (tabs) {
      kit.delegate(tabs, 'click', 'span[data-category]', function (event, target) {
        event.preventDefault();
        MHXX.store.patch({ category: target.getAttribute('data-category') });
      });
      tabs.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var target = event.target.closest('span[data-category]');
        if (!target) return;
        event.preventDefault();
        MHXX.store.patch({ category: target.getAttribute('data-category') });
      });
    }

    if (input) {
      input.addEventListener('input', kit.debounce(function () {
        MHXX.store.patch({ keyword: input.value.trim() });
      }, 90));
      input.addEventListener('search', function () {
        MHXX.store.patch({ keyword: input.value.trim() });
      });
    }

    MHXX.bus.on('state', function (state) {
      renderTabs(state);
      renderGrid();
    });
    MHXX.bus.on('skills:sync', syncSelection);

    render();
  }

  MHXX.ui.skillSearch = { init: init, render: render, syncSelection: syncSelection };
})(window);
