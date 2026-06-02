/*
 * لوحة تشخيص على الشاشة (مفيدة على الجوال حيث لا تتوفّر وحدة تحكّم المتصفّح).
 * تلتقط رسائل console والأخطاء غير الملتقَطة، وتعرض قائمة فحوص صحّية حيّة،
 * وسجلّ معالجة الصوت/التعرّف. تُحمَّل مبكراً (في <head>) لتلتقط كل شيء منذ البداية.
 */
(function (global) {
  "use strict";

  const MAX = 600;
  const lines = [];
  const checks = {}; // key -> { label, status, detail }
  const order = []; // ترتيب ظهور الفحوص
  let logEl = null;
  let healthEl = null;
  let autoscrollEl = null;
  let ready = false;

  function ts() {
    const d = new Date();
    return (
      d.toTimeString().slice(0, 8) +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  }

  function safe(o) {
    if (typeof o === "string") return o;
    try {
      return JSON.stringify(o);
    } catch (e) {
      return String(o);
    }
  }

  function push(level, args) {
    const text = Array.prototype.map.call(args, safe).join(" ");
    const line = { t: ts(), level: level, text: text };
    lines.push(line);
    if (lines.length > MAX) lines.shift();
    if (ready) appendLine(line);
  }

  function appendLine(line) {
    if (!logEl) return;
    const div = document.createElement("div");
    div.className = "debug__line debug__line--" + line.level;
    div.textContent = "[" + line.t + "] " + line.text;
    logEl.appendChild(div);
    while (logEl.childNodes.length > MAX) logEl.removeChild(logEl.firstChild);
    if (autoscrollEl && autoscrollEl.checked) logEl.scrollTop = logEl.scrollHeight;
  }

  // ——— اعتراض console والأخطاء ———
  const native = {};
  ["log", "info", "warn", "error", "debug"].forEach(function (m) {
    native[m] =
      global.console && global.console[m]
        ? global.console[m].bind(global.console)
        : function () {};
    global.console[m] = function () {
      native[m].apply(null, arguments);
      push(m === "debug" || m === "info" ? "log" : m, arguments);
    };
  });
  global.addEventListener("error", function (e) {
    push("error", [
      "خطأ غير ملتقَط:",
      (e.message || "") +
        (e.filename ? " @ " + e.filename + ":" + e.lineno : ""),
    ]);
  });
  global.addEventListener("unhandledrejection", function (e) {
    push("error", [
      "رفض وعد غير معالَج:",
      safe((e.reason && (e.reason.message || e.reason)) || e.reason),
    ]);
  });

  // ——— الفحوص الصحّية ———
  function health(key, label, status, detail) {
    if (!checks[key]) order.push(key);
    checks[key] = { label: label, status: status, detail: detail || "" };
    renderHealth();
  }

  function renderHealth() {
    if (!healthEl) return;
    healthEl.innerHTML = "";
    order.forEach(function (k) {
      const c = checks[k];
      const row = document.createElement("div");
      row.className = "hc hc--" + c.status;
      const dot = document.createElement("span");
      dot.className = "hc__dot";
      const lab = document.createElement("span");
      lab.className = "hc__label";
      lab.textContent = c.label;
      const det = document.createElement("span");
      det.className = "hc__detail";
      det.textContent = c.detail;
      row.appendChild(dot);
      row.appendChild(lab);
      row.appendChild(det);
      healthEl.appendChild(row);
    });
  }

  function healthSummary() {
    return order
      .map(function (k) {
        const c = checks[k];
        return (
          "- " +
          c.label +
          ": " +
          c.status.toUpperCase() +
          (c.detail ? " (" + c.detail + ")" : "")
        );
      })
      .join("\n");
  }

  function runStaticChecks() {
    health(
      "secure",
      "سياق آمن (https)",
      global.isSecureContext ? "ok" : "fail",
      global.isSecureContext ? "" : "يتطلّب https/localhost"
    );
    health(
      "coi",
      "عزل عبر الأصول (خيوط)",
      global.crossOriginIsolated ? "ok" : "warn",
      global.crossOriginIsolated ? "مفعّل" : "غير مفعّل (قد تُعاد الصفحة مرّة)"
    );
    const sw = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    health(
      "sw",
      "عامل الخدمة (COI)",
      sw ? "ok" : "warn",
      sw ? "يتحكّم بالصفحة" : "لا يتحكّم بعد"
    );
    health(
      "gpu",
      "WebGPU",
      navigator.gpu ? "ok" : "warn",
      navigator.gpu ? "متوفّر" : "غير متوفّر (سيُستخدم WASM)"
    );
    health("worker", "Web Worker", typeof Worker !== "undefined" ? "ok" : "fail", "");
    const gum = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    health("mic", "الميكروفون (getUserMedia)", gum ? "ok" : "fail", "");
    health(
      "audio",
      "AudioContext",
      global.AudioContext || global.webkitAudioContext ? "ok" : "fail",
      ""
    );
    const scripts = !!(
      global.QuranData &&
      global.Normalize &&
      global.Aligner &&
      global.SpeechEngine
    );
    health(
      "scripts",
      "سكربتات محمّلة",
      scripts ? "ok" : "fail",
      scripts ? "QuranData·Normalize·Aligner·SpeechEngine" : "بعضها لم يُحمّل"
    );
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions
        .query({ name: "microphone" })
        .then(function (st) {
          const map = { granted: "ok", denied: "fail", prompt: "info" };
          const set = function () {
            health("perm", "إذن الميكروفون", map[st.state] || "info", st.state);
          };
          set();
          st.onchange = set;
        })
        .catch(function () {});
    }
  }

  // ——— الربط بعناصر DOM ———
  function bind() {
    logEl = document.getElementById("debugLog");
    healthEl = document.getElementById("debugHealth");
    autoscrollEl = document.getElementById("debugAutoscroll");
    const copy = document.getElementById("debugCopy");
    const clear = document.getElementById("debugClear");

    if (copy)
      copy.addEventListener("click", function () {
        const text = lines
          .map(function (l) {
            return "[" + l.t + "] " + l.level.toUpperCase() + " " + l.text;
          })
          .join("\n");
        const out =
          "=== فحوص صحّية ===\n" + healthSummary() + "\n\n=== السجل ===\n" + text;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(out).then(
            function () {
              flash(copy, "نُسِخ ✓");
            },
            function () {
              fallbackCopy(out, copy);
            }
          );
        } else {
          fallbackCopy(out, copy);
        }
      });

    if (clear)
      clear.addEventListener("click", function () {
        lines.length = 0;
        if (logEl) logEl.innerHTML = "";
      });

    ready = true;
    if (logEl) {
      logEl.innerHTML = "";
      lines.forEach(appendLine);
    }
    renderHealth();
    runStaticChecks();
  }

  function flash(btn, t) {
    const o = btn.textContent;
    btn.textContent = t;
    setTimeout(function () {
      btn.textContent = o;
    }, 1200);
  }

  function fallbackCopy(text, btn) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      flash(btn, "نُسِخ ✓");
    } catch (e) {
      flash(btn, "تعذّر النسخ");
    }
    document.body.removeChild(ta);
  }

  global.Debug = {
    log: function () {
      push("log", arguments);
    },
    warn: function () {
      push("warn", arguments);
    },
    error: function () {
      push("error", arguments);
    },
    health: health,
    refresh: runStaticChecks,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})(window);
