/* 실측대장에서 견적 수량을 뽑아 내는 공통 엔진.
   견적서가 여러 벌이므로 계산 규칙은 여기 한 곳에만 둔다. */
(function (global) {
  "use strict";

  var ROWS_STORAGE = "uiryeong-rows-v1";   // 대장에서 고친 행
  var BASE_STORAGE = "uiryeong-base-v2";   // 대장의 기본 헤베
  var BASE_DEFAULT = { blind: 2, curtain: 0 };

  /* ---- 숫자 ---- */

  // 헤베는 소수 둘째 자리에서 올려 첫째 자리까지 남긴다 (3.53 → 3.6, 표기는 3.60).
  // 부동소수 오차로 3.50이 3.60이 되지 않도록 아주 작은 값을 먼저 덜어낸다.
  function ceilArea(n) { return Math.ceil(n * 10 - 1e-9) / 10; }

  function num(n, d) {
    return n.toFixed(d == null ? 2 : d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function won(n) { return "₩" + Math.round(n).toLocaleString("ko-KR"); }

  function money(n) { return Math.round(n).toLocaleString("ko-KR"); }

  // 견적서에는 한글 금액을 함께 적는 것이 관례다.
  function hangulAmount(n) {
    n = Math.round(n);
    if (!n) return "영";
    var digit = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    var small = ["", "십", "백", "천"];
    var big = ["", "만", "억", "조", "경"];
    var str = String(n), groups = [];
    while (str.length) { groups.push(str.slice(-4)); str = str.slice(0, -4); }
    var out = "";
    for (var g = groups.length - 1; g >= 0; g--) {
      var grp = groups[g], part = "";
      for (var i = 0; i < grp.length; i++) {
        var d = +grp[i], pos = grp.length - 1 - i;
        if (!d) continue;
        part += (d === 1 && pos > 0 ? "" : digit[d]) + small[pos];
      }
      if (part) out += part + big[g];
    }
    return out;
  }

  // 천 단위 쉼표가 섞여 들어와도 숫자로 읽는다.
  function priceValue(text) {
    var v = parseFloat(String(text).replace(/[^0-9.]/g, ""));
    return isFinite(v) ? v : NaN;
  }

  function attr(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---- 대장 읽기 ---- */

  function parseDim(text) {
    var m = /^([0-9]+(?:\.[0-9]+)?)\s*[×xX*]\s*([0-9]+(?:\.[0-9]+)?)$/
      .exec(String(text == null ? "" : text).replace(/\s+/g, " ").trim());
    return m ? { w: parseFloat(m[1]), h: parseFloat(m[2]) } : null;
  }

  // 대장의 품목 기본값 규칙과 같아야 한다 — "커튼박스"는 제품이 아니라 창틀 이야기다.
  function guessProd(text) {
    var t = String(text || "").replace(/커튼박스/g, "");
    if (/롤/.test(t)) return "블라인드";
    if (/커튼/.test(t)) return "커튼";
    return "블라인드";
  }

  function cellText(tr, cls) {
    var td = tr.querySelector("." + cls);
    return td ? td.textContent.trim() : "";
  }

  function readBase() {
    var base = { blind: BASE_DEFAULT.blind, curtain: BASE_DEFAULT.curtain };
    try {
      var raw = JSON.parse(localStorage.getItem(BASE_STORAGE) || "null");
      if (raw) {
        base.blind = parseFloat(raw.blind) > 0 ? parseFloat(raw.blind) : 0;
        base.curtain = parseFloat(raw.curtain) > 0 ? parseFloat(raw.curtain) : 0;
      }
    } catch (e) { /* 기본값을 쓴다 */ }
    return base;
  }

  function readLedger(doc) {
    var cache = {};
    try { cache = JSON.parse(localStorage.getItem(ROWS_STORAGE) || "{}") || {}; }
    catch (e) { cache = {}; }

    var edited = 0;
    var out = [];
    doc.querySelectorAll(".floor").forEach(function (floor) {
      // 행 번호는 대장과 똑같이 구역 id에서 뽑는다.
      var fi = /^s\d+$/.test(floor.id) ? floor.id.slice(1) : floor.id;
      var h2 = floor.querySelector(".floor-head h2");
      var floorName = h2 ? h2.textContent.trim() : floor.id;

      floor.querySelectorAll(".grp").forEach(function (grp, gi) {
        var h3 = grp.querySelector(".grp-head h3");
        var groupName = h3 ? h3.textContent.trim() : "";
        var trs = Array.prototype.slice.call(grp.querySelectorAll("tbody tr"))
          .filter(function (tr) { return tr.querySelector(".dim"); });

        trs.forEach(function (tr, ri) {
          var id = "f" + fi + "-g" + gi + "-r" + ri;
          var saved = cache[id];
          if (saved) edited++;

          var dim = saved && typeof saved.dim === "string" ? saved.dim : cellText(tr, "dim");
          var loc = saved && typeof saved.loc === "string" ? saved.loc : cellText(tr, "loc");
          var rem = saved && typeof saved.rem === "string" ? saved.rem : cellText(tr, "rem");
          var prod = saved && typeof saved.prod === "string" ? saved.prod : guessProd(tr.textContent);

          var d = parseDim(dim);
          if (!d) return;

          out.push({
            floor: floorName, group: groupName, loc: loc, dim: dim, rem: rem,
            prod: prod, raw: ceilArea(d.w * d.h / 10000)
          });
        });
      });
    });

    return { rows: out, edited: edited };
  }

  // 견적서는 대장과 같은 주소에 놓여야 한다 — 대장이 유일한 원본이다.
  function load(cb) {
    fetch("./index.html", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("대장을 불러오지 못했습니다 (" + r.status + ")");
        return r.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var read = readLedger(doc);
        if (!read.rows.length) throw new Error("대장에서 실측 행을 찾지 못했습니다");
        cb(null, read);
      })
      .catch(function (e) { cb(e || new Error("대장을 읽을 수 없습니다")); });
  }

  /* ---- 집계 ---- */

  function usedArea(r, base) {
    return Math.max(r.raw, r.prod === "커튼" ? base.curtain : base.blind);
  }

  function aggregate(rows, mode, base) {
    var keyOf = mode === "prod"
      ? function (r) { return r.prod; }
      : mode === "group"
        ? function (r) { return r.floor + "\u0001" + r.group + "\u0001" + r.prod; }
        : function (r) { return r.floor + "\u0001" + r.prod; };

    var map = {}, order = [];
    rows.forEach(function (r) {
      var k = keyOf(r);
      if (!map[k]) {
        map[k] = { key: k, prod: r.prod, floor: r.floor, group: r.group,
          qty: 0, raw: 0, n: 0, lifted: 0 };
        order.push(k);
      }
      var e = map[k], u = usedArea(r, base);
      e.qty += u; e.raw += r.raw; e.n++;
      if (u > r.raw + 0.0001) e.lifted++;
    });
    // 0.1 단위 값을 더하다 생기는 부동소수 찌꺼기를 털어 낸다.
    order.forEach(function (k) {
      map[k].qty = Math.round(map[k].qty * 100) / 100;
      map[k].raw = Math.round(map[k].raw * 100) / 100;
    });
    return order.map(function (k) { return map[k]; });
  }

  function specOf(e, mode) {
    if (mode === "prod") return "전 구역";
    if (mode === "group") return e.floor + " · " + e.group;
    return e.floor;
  }

  function baseNote(base) {
    return "기본 헤베 — 블라인드 " + (base.blind > 0 ? num(base.blind) + "㎡" : "없음")
      + " · 커튼 " + (base.curtain > 0 ? num(base.curtain) + "㎡" : "없음")
      + ", 실측 헤베가 이보다 작으면 기본 헤베로 계산";
  }

  global.Ledger = {
    BASE_DEFAULT: BASE_DEFAULT,
    ceilArea: ceilArea, num: num, won: won, money: money,
    hangulAmount: hangulAmount, priceValue: priceValue, attr: attr,
    parseDim: parseDim, guessProd: guessProd,
    readBase: readBase, load: load,
    usedArea: usedArea, aggregate: aggregate, specOf: specOf, baseNote: baseNote
  };
})(window);
