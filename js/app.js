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
  };

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
    aligner.pushWord(rawWord);
    render();
  }

  // ——— محرّك الصوت (Whisper محلياً عبر Transformers.js) ———
  let engine = null;

  function setMicLabel(text) {
    els.micBtnLabel.textContent = text;
  }

  if (window.SpeechEngine.isSupported()) {
    engine = new window.SpeechEngine({
      onWord: function (word) {
        handleWord(word);
      },
      onState: function (listening) {
        els.micBtn.classList.toggle("btn--recording", listening);
        if (!listening) {
          setMicLabel("ابدأ الاستماع");
          if (!aligner.isComplete()) setStatus("متوقّف", "idle");
        }
      },
      onStatus: function (state) {
        // loading | ready | listening | recognizing
        if (state === "loading") {
          setStatus("جارٍ تحميل نموذج Whisper…", "listening");
          setMicLabel("جارٍ التحميل…");
        } else if (state === "ready") {
          if (!engine.listening) setStatus("النموذج جاهز", "idle");
        } else if (state === "listening") {
          setMicLabel("إيقاف الاستماع");
          setStatus("يستمع…", "listening");
        } else if (state === "recognizing") {
          setMicLabel("إيقاف الاستماع");
          setStatus("جارٍ التعرّف…", "listening");
        }
      },
      onModelProgress: function (info) {
        // نعرض نسبة تحميل ملفّ النموذج الجاري (info.progress في المدى 0–100).
        if (info && info.status === "progress" && typeof info.progress === "number") {
          const pct = Math.min(100, Math.round(info.progress));
          setStatus("تحميل النموذج… " + toArabicDigits(pct) + "٪", "listening");
        }
      },
      onError: function (err) {
        setStatus("خطأ: " + describeError(err), "error");
        els.micBtn.classList.remove("btn--recording");
        setMicLabel("ابدأ الاستماع");
      },
    });
    els.engineNote.textContent =
      "محرّك الصوت: Whisper (Xenova/whisper-base) يعمل محلياً في متصفّحك عبر Transformers.js. " +
      "يُحمَّل النموذج مرّة واحدة (~عشرات الميغابايت) ثم يُخزَّن للعمل دون إنترنت. يعمل أفضل في Chrome/Edge.";
  } else {
    els.micBtn.disabled = true;
    setMicLabel("الميكروفون غير مدعوم");
    els.engineNote.textContent =
      "متصفّحك لا يدعم تشغيل النموذج المحلي (يحتاج Web Worker وWeb Audio وسياق https/localhost). " +
      "استخدم وضع الاختبار اليدوي بالأسفل، أو جرّب Chrome عبر رابط https.";
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
  setStatus("جاهز", "idle");
})();
