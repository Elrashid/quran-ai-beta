/*
 * عامل الويب (Web Worker) لتشغيل نموذج Whisper محلياً عبر Transformers.js
 * (راجع وثيقة المشروع: المرحلة 2 — نقل المحرّك إلى نموذج محلي للعمل دون إنترنت).
 *
 * يعمل التعرّف داخل خيط مستقلّ حتى لا يتجمّد العرض أثناء تحميل النموذج أو
 * أثناء الاستدلال. النموذج يُحمَّل مرّة واحدة ويُخزَّن في ذاكرة المتصفّح، فيعمل
 * دون إنترنت بعد أول تحميل.
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

// لا نبحث عن نماذج محلية؛ نجلبها من Hugging Face Hub ونخزّنها في المتصفّح.
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/whisper-base"; // متعدّد اللغات، يدعم العربية.

let transcriber = null;
let loadingPromise = null;
// سلسلة وعود لمعالجة مقطع صوتي واحد في كل مرة (تجنّب تداخل الاستدلال).
let queue = Promise.resolve();

function load() {
  if (transcriber) return Promise.resolve(transcriber);
  if (loadingPromise) return loadingPromise;

  loadingPromise = pipeline("automatic-speech-recognition", MODEL_ID, {
    quantized: true,
    progress_callback: function (info) {
      // info: { status, name, file, loaded, total, progress }
      self.postMessage({ type: "progress", data: info });
    },
  })
    .then(function (t) {
      transcriber = t;
      self.postMessage({ type: "ready" });
      return t;
    })
    .catch(function (err) {
      loadingPromise = null;
      self.postMessage({ type: "error", error: errMsg(err) });
      throw err;
    });

  return loadingPromise;
}

async function run(id, audio) {
  const t = await load();
  const output = await t(audio, {
    language: "arabic",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  self.postMessage({ type: "result", id: id, text: (output && output.text) || "" });
}

self.onmessage = function (e) {
  const msg = e.data || {};
  if (msg.type === "load") {
    load().catch(function () {
      /* أُبلِغ عن الخطأ مسبقاً */
    });
  } else if (msg.type === "transcribe") {
    queue = queue
      .then(function () {
        return run(msg.id, msg.audio);
      })
      .catch(function (err) {
        self.postMessage({ type: "error", error: errMsg(err), id: msg.id });
      });
  }
};

function errMsg(err) {
  return String((err && err.message) || err || "unknown");
}
