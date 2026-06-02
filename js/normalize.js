/*
 * طبقة التطبيع (راجع وثيقة المشروع: القسم 6).
 *
 * محرّكات الصوت لا تُخرج تشكيلاً وقد تختلف في رسم بعض الحروف، لذلك نوحّد
 * الكلمة المسموعة والكلمة المرجعية قبل المقارنة. هذا يقلّل الأخطاء الكاذبة
 * الناتجة عن فروق الكتابة لا فروق النطق.
 */
(function (global) {
  "use strict";

  // التشكيل والعلامات الصغيرة (الحركات، التنوين، الشدّة، السكون، علامات
  // المصحف الصغيرة مثل الألف الخنجرية) — نطاق يونيكود 064B–065F و0670 و06D6–06ED.
  const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
  // التطويل (الكشيدة).
  const TATWEEL = /ـ/g;

  /**
   * توحيد محارف عربية متقاربة الرسم إلى صورة واحدة:
   *  أ/إ/آ/ٱ ← ا ، ى ← ي ، ة ← ه ، ؤ ← و ، ئ ← ي ، ء ← (حذف)
   */
  function unifyLetters(text) {
    return text
      .replace(/[أإآٱى]/g, function (ch) {
        // ى (0649) تُوحَّد إلى ي، وبقية صور الألف إلى ا.
        return ch === "ى" ? "ي" : "ا";
      })
      .replace(/ة/g, "ه") // ة ← ه
      .replace(/ؤ/g, "و") // ؤ ← و
      .replace(/ئ/g, "ي") // ئ ← ي
      .replace(/ء/g, ""); // ء ← حذف
  }

  /**
   * تطبيع كلمة واحدة: إزالة التشكيل والتطويل، توحيد الحروف، تقليم المسافات.
   * @param {string} word
   * @returns {string}
   */
  function normalizeWord(word) {
    if (!word) return "";
    let out = String(word).trim();
    out = out.replace(DIACRITICS, "");
    out = out.replace(TATWEEL, "");
    out = unifyLetters(out);
    // إزالة أي رموز غير عربية (أرقام آيات، علامات ترقيم) مع الإبقاء على الحروف.
    out = out.replace(/[^ء-ي\s]/g, "");
    return out.replace(/\s+/g, " ").trim();
  }

  /**
   * تقسيم جملة منطوقة إلى كلمات مطبّعة (مع تجاهل الفراغات الزائدة).
   * @param {string} text
   * @returns {string[]}
   */
  function tokenize(text) {
    if (!text) return [];
    return String(text)
      .split(/\s+/)
      .map(normalizeWord)
      .filter(Boolean);
  }

  global.Normalize = { normalizeWord: normalizeWord, tokenize: tokenize };
})(typeof window !== "undefined" ? window : this);
