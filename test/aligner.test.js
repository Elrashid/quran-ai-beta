/*
 * اختبارات بسيطة لطبقة المحاذاة والتطبيع (تعمل عبر Node بلا أي تبعيات).
 * التشغيل:  node test/aligner.test.js
 */
"use strict";

// تحميل الوحدات في بيئة Node عبر كائن عام مشترك.
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const sandbox = { module: { exports: {} } };
sandbox.window = sandbox; // الوحدات تعرّف نفسها على window أو this.
vm.createContext(sandbox);

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
}

load("normalize.js");
load("aligner.js");

const Normalize = sandbox.Normalize;
const Aligner = sandbox.Aligner;
const STATUS = Aligner.STATUS;

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log("  ✓ " + name);
  } else {
    failed++;
    console.error("  ✗ " + name);
  }
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-9);
}

console.log("التطبيع (Normalize):");
assert(
  "إزالة التشكيل",
  Normalize.normalizeWord("الرَّحْمَٰنِ") === "الرحمن"
);
assert("توحيد الألف والهمزة", Normalize.normalizeWord("إِيَّاكَ") === "اياك");
assert("توحيد التاء المربوطة", Normalize.normalizeWord("صلاة") === "صلاه");
assert("توحيد الألف المقصورة", Normalize.normalizeWord("علَى") === "علي");
assert(
  "tokenize يقسّم ويطبّع",
  JSON.stringify(Normalize.tokenize("بِسْمِ اللَّهِ")) ===
    JSON.stringify(["بسم", "الله"])
);

console.log("\nالتشابه (similarity):");
assert("تطابق تامّ = 1", approx(Aligner.similarity("بسم", "بسم"), 1));
assert("لا تشابه مع فارغ = 0", Aligner.similarity("بسم", "") === 0);
assert(
  "تشابه جزئي بين 0 و1",
  Aligner.similarity("الرحمن", "الرحيم") > 0 &&
    Aligner.similarity("الرحمن", "الرحيم") < 1
);

const fatihah = [
  ["بِسْمِ", "اللَّهِ", "الرَّحْمَٰنِ", "الرَّحِيمِ"],
  ["الْحَمْدُ", "لِلَّهِ", "رَبِّ", "الْعَالَمِينَ"],
];

console.log("\nالمحاذاة (Aligner):");

(function tilawaSahiha() {
  const a = new Aligner(fatihah);
  ["بسم", "الله", "الرحمن", "الرحيم"].forEach(function (w) {
    a.pushWord(w);
  });
  assert("تلاوة صحيحة تنقل المرساة", a.anchor === 4);
  assert(
    "الكلمات الأربع صحيحة",
    a.statuses.slice(0, 4).every(function (s) {
      return s === STATUS.CORRECT;
    })
  );
  assert("التقدّم 4/8", approx(a.progress(), 4 / 8));
})();

(function khataaThummaTashih() {
  const a = new Aligner(fatihah);
  a.pushWord("بسم");
  a.pushWord("تلفاز"); // كلمة دخيلة لا تشبه أي كلمة في النافذة
  assert("الكلمة الخاطئة تُعلَّم خطأً", a.statuses[1] === STATUS.ERROR);
  assert("المرساة لا تتحرّك عند الخطأ", a.anchor === 1);
  a.pushWord("الله"); // إعادة النطق الصحيح
  assert("إعادة النطق تصحّح الموضع", a.statuses[1] === STATUS.CORRECT);
  assert("يُمسح الخطأ المؤقت بعد التصحيح", a.anchor === 2);
})();

(function qafzLilamam() {
  const a = new Aligner(fatihah);
  // القفز إلى «العالمين» (الموضع 7) مباشرة ضمن نافذة الأمام.
  a.pushWord("بسم"); // 0
  a.pushWord("العالمين"); // قفزة للأمام
  assert("القفز للأمام يطابق ضمن النافذة", a.statuses[7] === STATUS.CORRECT);
  assert("المرساة تقفز بعد المطابقة", a.anchor === 8);
})();

(function reset() {
  const a = new Aligner(fatihah);
  a.pushWord("بسم");
  a.reset();
  assert("إعادة الضبط تصفّر المرساة", a.anchor === 0);
  assert(
    "إعادة الضبط تُرجِع كل الحالات pending",
    a.statuses.every(function (s) {
      return s === STATUS.PENDING;
    })
  );
})();

(function snapshotCurrent() {
  const a = new Aligner(fatihah);
  const snap = a.snapshot();
  assert("الموضع الحالي ذهبي في اللقطة", snap.statuses[0] === STATUS.CURRENT);
})();

(function threshold() {
  const strict = new Aligner(fatihah, { threshold: 0.95 });
  strict.pushWord("بسن"); // قريبة لكن ليست تامّة
  assert("عتبة صارمة ترفض المطابقة الجزئية", strict.anchor === 0);
  const loose = new Aligner(fatihah, { threshold: 0.5 });
  loose.pushWord("بسن");
  assert("عتبة متسامحة تقبل المطابقة الجزئية", loose.anchor === 1);
})();

console.log(
  "\nالنتيجة: " + passed + " ناجح، " + failed + " فاشل."
);
process.exit(failed === 0 ? 0 : 1);
