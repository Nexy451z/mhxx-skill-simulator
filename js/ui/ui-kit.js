/* ==========================================================================
   UI: 共通ユーティリティ（ui-kit）
   - DOM ヘルパー / SVG アイコン生成 / エスケープ / イベントバス
   全 UI モジュールから MHXX.uiKit / MHXX.bus として利用する。
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};

  var kit = {};

  /* ---- 文字列 ---------------------------------------------------------- */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---- SVG アイコン ---------------------------------------------------- */
  function icon(name, cls) {
    return '<svg class="icon ' + (cls || 'icon-sm') + '" aria-hidden="true" focusable="false">' +
      '<use href="#icon-' + esc(name) + '"></use></svg>';
  }

  /* ---- DOM ------------------------------------------------------------- */
  function q(selector, root) { return (root || document).querySelector(selector); }
  function qa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function delegate(root, eventName, selector, handler) {
    if (!root) return;
    root.addEventListener(eventName, function (event) {
      var node = event.target;
      var target = node && node.closest ? node.closest(selector) : null;
      if (!target || !root.contains(target)) return;
      handler(event, target);
    });
  }

  function setHTML(node, html) {
    if (node) node.innerHTML = html;
  }

  /* ---- 汎用 ------------------------------------------------------------ */
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var self = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 0);
    };
  }

  function slotDots(count) {
    var n = Math.max(0, Math.min(3, Number(count) || 0));
    var out = '<span class="slot-dots" aria-hidden="true">';
    for (var i = 0; i < 3; i++) {
      out += '<span' + (i < n ? ' class="filled"' : '') + '></span>';
    }
    return out + '</span>';
  }

  function signed(n) {
    var num = Number(n) || 0;
    return (num > 0 ? '+' : '') + num;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toArray(list) {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    if (typeof list.length === 'number') return Array.prototype.slice.call(list);
    return Object.keys(list).map(function (key) { return list[key]; });
  }

  /* ---- 簡易イベントバス ------------------------------------------------ */
  var listeners = {};
  var bus = {
    on: function (name, fn) {
      (listeners[name] || (listeners[name] = [])).push(fn);
      return fn;
    },
    off: function (name, fn) {
      var arr = listeners[name] || [];
      var index = arr.indexOf(fn);
      if (index !== -1) arr.splice(index, 1);
    },
    emit: function (name, payload) {
      (listeners[name] || []).slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[MHXX] bus handler error: ' + name, err);
        }
      });
    }
  };

  /* ---- トースト（js/ui/toast.js が未読込でも落ちないようにする） -------- */
  function toast(message, type) {
    if (MHXX.ui && MHXX.ui.toast && typeof MHXX.ui.toast.show === 'function') {
      MHXX.ui.toast.show(message, type);
    } else if (global.console) {
      console.log('[MHXX] ' + message);
    }
  }

  kit.esc = esc;
  kit.icon = icon;
  kit.q = q;
  kit.qa = qa;
  kit.delegate = delegate;
  kit.setHTML = setHTML;
  kit.debounce = debounce;
  kit.slotDots = slotDots;
  kit.signed = signed;
  kit.clamp = clamp;
  kit.toArray = toArray;
  kit.toast = toast;

  MHXX.uiKit = kit;
  MHXX.bus = MHXX.bus || bus;
})(window);
