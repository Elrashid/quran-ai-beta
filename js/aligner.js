/*
 * طبقة المحاذاة والتصحيح — المنطق الأساسي (راجع وثيقة المشروع: القسمان 5 و6).
 *
 * هذه الطبقة مستقلّة تماماً عن محرّك الصوت ولا تتغيّر عند تبديله. تأخذ نصاً
 * مرجعياً (كلمات السورة) وتستقبل الكلمات المسموعة واحدةً تلو الأخرى، فتحرّك
 * «المرساة» (الكلمة المتوقَّعة التالية) وتُصنّف كل كلمة: صحيحة / حالية / خطأ.
 *
 * خوارزمية المحاذاة لكل كلمة مسموعة:
 *   - طبّع الكلمة.
 *   - ابحث في النافذة [المرساة − BACK ، المرساة + FWD].
 *   - احسب درجة التشابه مع كل كلمة في النافذة (مع ترجيح القرب من المرساة).
 *   - إذا كان أفضل تشابه ≥ العتبة: علّم الكلمة المطابِقة «صحيحة» وانقل المرساة بعدها.
 *   - وإلا: علّم الكلمة المتوقَّعة «خطأ» (أحمر) مؤقتاً وأبقِ المرساة لإتاحة إعادة النطق.
 */
(function (global) {
  "use strict";

  const Normalize = global.Normalize;

  // نافذة البحث حول المرساة: أربع كلمات للخلف وستّ للأمام (لدعم الرجوع والقفز).
  const WINDOW_BACK = 4;
  const WINDOW_FWD = 6;
  // معامل ترجيح القرب: كل خطوة بُعد عن المرساة تخصم هذا القدر من الدرجة.
  const PROXIMITY_PENALTY = 0.03;

  /** مسافة ليفنشتاين بين سلسلتين. */
  function levenshtein(a, b) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (la === 0) return lb;
    if (lb === 0) return la;

    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1, // حذف
          curr[j - 1] + 1, // إضافة
          prev[j - 1] + cost // استبدال
        );
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[lb];
  }

  /** درجة تشابه في المدى [0,1] اعتماداً على مسافة ليفنشتاين. */
  function similarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - dist / maxLen;
  }

  const STATUS = {
    PENDING: "pending",
    CORRECT: "correct",
    CURRENT: "current",
    ERROR: "error",
  };

  function Aligner(verses, options) {
    options = options || {};
    this.threshold = typeof options.threshold === "number" ? options.threshold : 0.62;

    // تسطيح الآيات إلى قائمة كلمات مع الاحتفاظ بموضع كل كلمة (الآية/الكلمة).
    this.words = [];
    for (let v = 0; v < verses.length; v++) {
      for (let w = 0; w < verses[v].length; w++) {
        const raw = verses[v][w];
        this.words.push({
          raw: raw,
          norm: Normalize.normalizeWord(raw),
          verseIndex: v,
          wordIndex: w,
          globalIndex: this.words.length,
        });
      }
    }

    this.reset();
  }

  Aligner.STATUS = STATUS;

  Aligner.prototype.reset = function () {
    this.anchor = 0; // فهرس الكلمة المتوقَّعة التالية.
    this.statuses = this.words.map(function () {
      return STATUS.PENDING;
    });
    this.lastError = -1; // موضع الخطأ المؤقت الأخير (أحمر) إن وُجد.
  };

  Aligner.prototype.setThreshold = function (t) {
    this.threshold = t;
  };

  Aligner.prototype.isComplete = function () {
    return this.anchor >= this.words.length;
  };

  Aligner.prototype.progress = function () {
    const total = this.words.length;
    if (total === 0) return 0;
    let correct = 0;
    for (let i = 0; i < this.statuses.length; i++) {
      if (this.statuses[i] === STATUS.CORRECT) correct++;
    }
    return correct / total;
  };

  /**
   * معالجة كلمة مسموعة واحدة.
   * @param {string} heard الكلمة كما وردت من محرّك الصوت (غير مطبّعة).
   * @returns {{matched:boolean, matchedIndex:number, score:number, expectedIndex:number}}
   */
  Aligner.prototype.pushWord = function (heard) {
    const norm = Normalize.normalizeWord(heard);
    const expectedIndex = this.anchor;
    const result = {
      matched: false,
      matchedIndex: -1,
      score: 0,
      expectedIndex: expectedIndex,
    };

    if (!norm || this.isComplete()) return result;

    const start = Math.max(0, this.anchor - WINDOW_BACK);
    const end = Math.min(this.words.length - 1, this.anchor + WINDOW_FWD);

    let bestIndex = -1;
    let bestRawScore = -Infinity; // درجة بعد الترجيح (للاختيار).
    let bestSim = 0; // درجة التشابه الخام (للإرجاع).

    for (let i = start; i <= end; i++) {
      // لا نعيد مطابقة كلمة سبق تثبيتها كصحيحة.
      if (this.statuses[i] === STATUS.CORRECT) continue;
      const sim = similarity(norm, this.words[i].norm);
      const weighted = sim - PROXIMITY_PENALTY * Math.abs(i - this.anchor);
      if (weighted > bestRawScore) {
        bestRawScore = weighted;
        bestIndex = i;
        bestSim = sim;
      }
    }

    if (bestIndex !== -1 && bestSim >= this.threshold) {
      // مطابقة مقبولة: ثبّت الكلمة كصحيحة وانقل المرساة إلى ما بعدها.
      this.statuses[bestIndex] = STATUS.CORRECT;
      // امسح أي خطأ مؤقت سابق ما دام ضمن المسار الذي تجاوزناه.
      if (this.lastError !== -1 && this.statuses[this.lastError] === STATUS.ERROR) {
        this.statuses[this.lastError] = STATUS.PENDING;
        this.lastError = -1;
      }
      this.anchor = bestIndex + 1;
      result.matched = true;
      result.matchedIndex = bestIndex;
      result.score = bestSim;
    } else {
      // لا مطابقة: علّم الكلمة المتوقَّعة خطأً مؤقتاً وأبقِ المرساة.
      if (expectedIndex < this.words.length && this.statuses[expectedIndex] !== STATUS.CORRECT) {
        this.statuses[expectedIndex] = STATUS.ERROR;
        this.lastError = expectedIndex;
      }
      result.score = bestSim;
    }

    return result;
  };

  /** لقطة بحالة كل كلمة + تمييز الموضع الحالي (الذهبي) عند المرساة. */
  Aligner.prototype.snapshot = function () {
    const statuses = this.statuses.slice();
    if (this.anchor < statuses.length && statuses[this.anchor] === STATUS.PENDING) {
      statuses[this.anchor] = STATUS.CURRENT;
    }
    return {
      words: this.words,
      statuses: statuses,
      anchor: this.anchor,
      progress: this.progress(),
      complete: this.isComplete(),
    };
  };

  // كشف الدوال للاختبار ولإعادة الاستخدام.
  Aligner.levenshtein = levenshtein;
  Aligner.similarity = similarity;

  global.Aligner = Aligner;

  // دعم بيئة Node لأغراض الاختبار.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Aligner: Aligner, levenshtein: levenshtein, similarity: similarity };
  }
})(typeof window !== "undefined" ? window : this);
