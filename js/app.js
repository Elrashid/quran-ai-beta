/*
 * طبقة العرض وربط المكوّنات (راجع وثيقة المشروع: القسم 4-ج).
 *
 * تجمع هذه الطبقة بين محرّك الصوت (SpeechEngine) ومحرّك المحاذاة (Aligner)
 * وتعرض النتيجة: تلوين الكلمات، شريط التقدّم، الإشعارات، ووضع الاختبار اليدوي.
 */
(function () {
  "use strict";

  const surah = window.QuranData.surah;
  const STATUS = window.Aligner.STATUS;

  // عناصر الواجهة.
  const els = {
    quran: document.getElementById("quranText"),
    progressBar: document.getElementById("progressBar"),
    progressText: document.getElementById("progressText"),
    statusText: document.getElementById("statusText"),
    micBtn: document.getElementById("micBtn"),
    micBtnLabel: document.getElementById("micBtnLabel"),
    resetBtn: document.getElementById("resetBtn"),
    manualForm: document.getElementById("manualForm"),
    manualInput: document.getElementById("manualInput"),
    thresholdRange: document.getElementById("thresholdRange"),
    thresholdValue: document.getElementById("thresholdValue"),
    engineNote: document.getElementById("engineNote"),
    modelLoad: document.getElementById("modelLoad"),
    modelLoadBar: document.getElementById("modelLoadBar"),
    modelLoadPct: document.getElementById("modelLoadPct"),
    modelLoadDetail: document.getElementById("modelLoadDetail"),
    meterFill: document.getElementById("meterFill"),
    meterThreshold: document.getElementById("meterThreshold"),
    vadState: document.getElementById("vadState"),
    vadRange: document.getElementById("vadRange"),
    vadValue: document.getElementById("vadValue"),
  };

  // أعلى مستوى صوت يُعرَض كنسبة 100% على المقياس (لتحويل RMS إلى عرض مرئي).
  const METER_MAX_RMS = 0.15;

  const aligner = new window.Aligner(surah.verses, {
    threshold: parseFloat(els.thresholdRange.value),
  });

  // مراجع عناصر الكلمات (span) مفهرسة حسب الموضع العام لتحديث سريع.
  const wordEls = [];

  // ——— بناء النص ———
  function buildText() {
    els.quran.innerHTML = "";
    wordEls.length = 0;
    let globalIndex = 0;

    surah.verses.forEach(function (verse, vIndex) {
      const verseEl = document.createElement("span");
      verseEl.className = "verse";

      verse.forEach(function (word) {
        const wordEl = document.createElement("span");
        wordEl.className = "word word--pending";
        wordEl.textContent = word;
        wordEl.dataset.index = String(globalIndex);
        verseEl.appendChild(wordEl);
        verseEl.appendChild(document.createTextNode(" "));
        wordEls[globalIndex] = wordEl;
        globalIndex++;
      });

      // رقم الآية بأرقام عربية-هندية داخل علامة الآية.
      const marker = document.createElement("span");
      marker.className = "verse__number";
      marker.textContent = "۝" + toArabicDigits(vIndex + 1);
      verseEl.appendChild(marker);

      els.quran.appendChild(verseEl);
      els.quran.appendChild(document.createTextNode(" "));
    });
  }

  const STATUS_CLASS = {
    pending: "word--pending",
    correct: "word--correct",
    current: "word--current",
    error: "word--error",
  };

  function render() {
    const snap = aligner.snapshot();
    for (let i = 0; i < snap.statuses.length; i++) {
      const el = wordEls[i];
      const cls = "word " + STATUS_CLASS[snap.statuses[i]];
      if (el.className !== cls) el.className = cls;
    }

    const pct = Math.round(snap.progress * 100);
    els.progressBar.style.width = pct + "%";
    els.progressText.textContent = toArabicDigits(pct) + "٪";

    if (snap.complete) {
      setStatus("اكتملت التلاوة — أحسنت", "done");
      scrollToCurrent();
    } else {
      scrollToCurrent();
    }
  }

  function scrollToCurrent() {
    const snap = aligner.snapshot();
    const el = wordEls[snap.anchor];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }

  function setStatus(text, kind) {
    els.statusText.textContent = text;
    els.statusText.className = "status status--" + (kind || "idle");
  }

  // ——— معالجة كلمة (مصدر مشترك: صوت أو يدوي) ———
  function handleWord(rawWord) {
    if (!rawWord) return;
    const res = aligner.pushWord(rawWord);
    if (window.Debug) {
      if (res.matched) {
        window.Debug.log(
          "كلمة «" +
            rawWord +
            "» ✓ طابقت #" +
            res.matchedIndex +
            " (تشابه " +
            res.score.toFixed(2) +
            ") → المرساة " +
            aligner.anchor
        );
      } else {
        window.Debug.log(
          "كلمة «" +
            rawWord +
            "» ✗ لا مطابقة (أفضل تشابه " +
            res.score.toFixed(2) +
            ") عند #" +
            res.expectedIndex
        );
      }
    }
    render();
  }

  // ——— محرّك الصوت (Whisper محلياً عبر Transformers.js) ———
  let engine = null;
  let lastLevelLog = 0;

  function setMicLabel(text) {
    els.micBtnLabel.textContent = text;
  }

  // ——— تقدّم تحميل النموذج (تجميع عبر ملفّات النموذج المتعدّدة) ———
  const loadFiles = {}; // key -> { loaded, total }

  function updateModelLoad() {
    let loaded = 0;
    let total = 0;
    for (const k in loadFiles) {
      if (loadFiles[k].total > 0) {
        loaded += loadFiles[k].loaded;
        total += loadFiles[k].total;
      }
    }
    if (total === 0) return;
    const pct = Math.min(100, Math.round((loaded / total) * 100));
    els.modelLoad.hidden = false;
    els.modelLoadBar.style.width = pct + "%";
    els.modelLoadPct.textContent = toArabicDigits(pct) + "٪";
    const mb = function (n) {
      return toArabicDigits((n / (1024 * 1024)).toFixed(1));
    };
    els.modelLoadDetail.textContent = mb(loaded) + " / " + mb(total) + " ميغابايت";
  }

  function hideModelLoad() {
    els.modelLoad.hidden = true;
  }

  // ——— مقياس مستوى الصوت ———
  function updateMeter(rms, speaking) {
    const pct = Math.min(100, (rms / METER_MAX_RMS) * 100);
    els.meterFill.style.width = pct + "%";
    els.meterFill.classList.toggle("is-speaking", !!speaking);
    els.vadState.textContent = speaking ? "كلام" : "صمت";
    els.vadState.className = "vad " + (speaking ? "vad--speaking" : "vad--idle");
  }

  function resetMeter() {
    updateMeter(0, false);
  }

  // موضع علامة العتبة على المقياس (يُحدَّث مع منزلق الحساسية).
  function updateThresholdMarker(t) {
    const pct = Math.min(100, (t / METER_MAX_RMS) * 100);
    els.meterThreshold.style.right = pct + "%";
  }

  if (window.SpeechEngine.isSupported()) {
    engine = new window.SpeechEngine({
      speechThreshold: parseFloat(els.vadRange.value),
      onWord: function (word) {
        handleWord(word);
      },
      onState: function (listening) {
        els.micBtn.classList.toggle("btn--recording", listening);
        if (!listening) {
          setMicLabel("ابدأ الاستماع");
          resetMeter();
          if (!aligner.isComplete()) setStatus("متوقّف", "idle");
        }
      },
      onProc: function (tag, msg) {
        if (window.Debug) window.Debug.log("[" + tag + "] " + msg);
      },
      onStatus: function (state) {
        if (window.Debug) window.Debug.log("الحالة: " + state);
        // loading | ready | listening | recognizing
        if (state === "loading") {
          setStatus("جارٍ تحميل نموذج Whisper…", "listening");
          setMicLabel("جارٍ التحميل…");
          els.modelLoad.hidden = false;
        } else if (state === "ready") {
          hideModelLoad();
          if (!engine.listening) setStatus("النموذج جاهز", "idle");
        } else if (state === "listening") {
          hideModelLoad();
          setMicLabel("إيقاف الاستماع");
          setStatus("يستمع…", "listening");
        } else if (state === "recognizing") {
          setMicLabel("إيقاف الاستماع");
          setStatus("جارٍ التعرّف…", "listening");
        }
      },
      onModelProgress: function (info) {
        if (!info || !info.file) return;
        if (info.status === "fallback") {
          if (window.Debug) window.Debug.warn(info.file);
          return;
        }
        if (window.Debug && (info.status === "initiate" || info.status === "done")) {
          window.Debug.log(
            "نموذج: " +
              (info.status === "initiate" ? "بدء تنزيل " : "اكتمل ") +
              info.file
          );
        }
        const key = (info.name || "") + "/" + info.file;
        if (typeof info.total === "number" && info.total > 0) {
          loadFiles[key] = {
            loaded: info.status === "done" ? info.total : info.loaded || 0,
            total: info.total,
          };
          updateModelLoad();
        }
      },
      onLevel: function (rms, speaking) {
        updateMeter(rms, speaking);
        // مؤشّر كشف حيّ في لوحة التشخيص (مُخمَّد إلى ~٤ مرّات/ثانية).
        const now = Date.now();
        if (window.Debug && now - lastLevelLog > 250) {
          lastLevelLog = now;
          window.Debug.health(
            "level",
            "كشف الصوت (حيّ)",
            speaking ? "ok" : "info",
            "RMS " + rms.toFixed(3) + (speaking ? " — كلام" : " — صمت")
          );
        }
      },
      onBackend: function (info) {
        const dev =
          info.device === "webgpu"
            ? "WebGPU (مسرّع بالعتاد)"
            : "WASM" +
              (info.threaded
                ? " متعدّد الخيوط (" + toArabicDigits(info.threads || 1) + ")"
                : " (خيط واحد)");
        const isQuran = info.model === "whisper-base-ar-quran";
        const modelName = isQuran
          ? "نموذج قرآني (tarteel whisper-base)"
          : "Whisper-base عامّ (احتياطي)";
        els.engineNote.textContent =
          "المحرّك: " + modelName + " — يعمل على " + dev + " عبر Transformers.js. " +
          "النموذج مخزَّن في المتصفّح للعمل دون إنترنت.";
        if (window.Debug) {
          window.Debug.health(
            "engine",
            "محرّك التعرّف",
            isQuran ? "ok" : "warn",
            modelName + " · " + dev
          );
          window.Debug.log("المحرّك جاهز: " + modelName + " على " + dev);
        }
      },
      onError: function (err) {
        setStatus("خطأ: " + describeError(err), "error");
        els.micBtn.classList.remove("btn--recording");
        setMicLabel("ابدأ الاستماع");
        hideModelLoad();
        if (window.Debug) {
          window.Debug.error("خطأ المحرّك: " + err);
          window.Debug.health("engine", "محرّك التعرّف", "fail", describeError(err));
        }
      },
    });
    updateThresholdMarker(parseFloat(els.vadRange.value));
    els.engineNote.textContent =
      "محرّك الصوت: نموذج قرآني (tarteel whisper-base) محوّل إلى ONNX ويعمل محلياً عبر Transformers.js " +
      "(WebGPU عند توفّره). يُحمَّل النموذج مرّة واحدة (~١١٠م.ب) ثم يُخزَّن للعمل دون إنترنت. يعمل أفضل في Chrome/Edge.";
    if (window.Debug) window.Debug.log("SpeechEngine مدعوم — جاهز للبدء.");
  } else {
    els.micBtn.disabled = true;
    setMicLabel("الميكروفون غير مدعوم");
    els.engineNote.textContent =
      "متصفّحك لا يدعم تشغيل النموذج المحلي (يحتاج Web Worker وWeb Audio وسياق https/localhost). " +
      "استخدم وضع الاختبار اليدوي بالأسفل، أو جرّب Chrome عبر رابط https.";
    if (window.Debug) {
      window.Debug.error("SpeechEngine غير مدعوم في هذا المتصفّح.");
      window.Debug.health("engine", "محرّك التعرّف", "fail", "غير مدعوم");
    }
  }

  function describeError(err) {
    const map = {
      "not-allowed": "رُفض إذن الميكروفون",
      unsupported: "غير مدعوم في هذا المتصفّح",
      "worker-error": "تعذّر تشغيل عامل النموذج",
    };
    if (typeof err === "string" && /fetch|network|load model|Failed/i.test(err)) {
      return "تعذّر تحميل النموذج (تحقّق من الاتصال عند أول مرّة)";
    }
    return map[err] || err;
  }

  // ——— الأحداث ———
  els.micBtn.addEventListener("click", function () {
    if (!engine) return;
    if (window.Debug)
      window.Debug.log("زر الميكروفون: " + (engine.listening ? "إيقاف" : "بدء"));
    if (engine.listening) engine.stop();
    else engine.start();
  });

  els.resetBtn.addEventListener("click", function () {
    if (engine && engine.listening) engine.stop();
    aligner.reset();
    render();
    setStatus("جاهز", "idle");
  });

  els.manualForm.addEventListener("submit", function (e) {
    e.preventDefault();
    const text = els.manualInput.value;
    const tokens = window.Normalize.tokenize(text);
    tokens.forEach(handleWord);
    els.manualInput.value = "";
    els.manualInput.focus();
  });

  els.thresholdRange.addEventListener("input", function () {
    const t = parseFloat(els.thresholdRange.value);
    aligner.setThreshold(t);
    els.thresholdValue.textContent = t.toFixed(2);
  });

  els.vadRange.addEventListener("input", function () {
    const t = parseFloat(els.vadRange.value);
    if (engine) engine.setSpeechThreshold(t);
    els.vadValue.textContent = t.toFixed(3);
    updateThresholdMarker(t);
  });

  // ——— أدوات ———
  function toArabicDigits(n) {
    const map = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
    return String(n).replace(/\d/g, function (d) {
      return map[Number(d)];
    });
  }

  // ——— التهيئة ———
  buildText();
  render();
  resetMeter();
  updateThresholdMarker(parseFloat(els.vadRange.value));
  els.vadValue.textContent = parseFloat(els.vadRange.value).toFixed(3);
  setStatus("جاهز", "idle");
  if (window.Debug) {
    window.Debug.log("تهيئة التطبيق — " + aligner.words.length + " كلمة في النص.");
    window.Debug.refresh();
  }
})();
