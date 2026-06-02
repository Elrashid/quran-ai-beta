/*
 * عامل الويب (Web Worker) لتشغيل نموذج Whisper محلياً عبر Transformers.js v3
 * (راجع وثيقة المشروع: المرحلة 2 — نموذج محلي يعمل دون إنترنت).
 *
 * تحسينات الأداء:
 *  - يُفضّل تشغيل النموذج على WebGPU عند توفّره (أسرع بكثير)، مع تراجع آمن إلى
 *    WASM (الذي يصبح متعدّد الخيوط متى كانت الصفحة معزولة عبر الأصول).
 *  - يستخدم نموذج whisper-tiny الأخفّ والأسرع.
 *  - تسخين مبدئي (warm-up) لتفادي بطء أوّل تعرّف (تصريف مظلّلات WebGPU).
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/whisper-base"; // أدقّ من tiny، وسريع بما يكفي على WebGPU.

// خيارات توليد تمنع حلقات التكرار (هلوسة Whisper) وتحدّ من زمن الاستدلال.
const GEN_OPTS = {
  language: "arabic",
  task: "transcribe",
  no_repeat_ngram_size: 3, // يوقف تكرار المقاطع (مثل «لنقل لنقل…») مبكراً.
  max_new_tokens: 96, // سقف أمان لطول المخرجات (المقاطع قصيرة أصلاً).
};

let transcriber = null;
let loadingPromise = null;
let activeDevice = "wasm";
// سلسلة وعود لمعالجة مقطع صوتي واحد في كل مرة (تجنّب تداخل الاستدلال).
let queue = Promise.resolve();

async function supportsWebGPU() {
  try {
    if (typeof navigator === "undefined" || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) {
    return false;
  }
}

function buildOptions(device) {
  const opts = {
    device: device,
    progress_callback: function (info) {
      self.postMessage({ type: "progress", data: info });
    },
  };
  if (device === "webgpu") {
    // ترميز fp32 (متوافق مع أغلب العتاد) وفكّ ترميز q4 (أسرع وأخفّ).
    opts.dtype = { encoder_model: "fp32", decoder_model_merged: "q4" };
  } else {
    opts.dtype = "q8"; // مكمَّم للسرعة والحجم على WASM.
  }
  return opts;
}

async function create(device) {
  return pipeline("automatic-speech-recognition", MODEL_ID, buildOptions(device));
}

function load() {
  if (transcriber) return Promise.resolve(transcriber);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async function () {
    const wantGPU = await supportsWebGPU();
    try {
      transcriber = await create(wantGPU ? "webgpu" : "wasm");
      activeDevice = wantGPU ? "webgpu" : "wasm";
    } catch (err) {
      if (wantGPU) {
        // تعذّر WebGPU لأي سبب → تراجع إلى WASM.
        transcriber = await create("wasm");
        activeDevice = "wasm";
      } else {
        throw err;
      }
    }

    // تسخين مبدئي بمقطع صامت قصير لتصريف المظلّلات/التهيئة.
    try {
      await transcriber(new Float32Array(16000), GEN_OPTS);
    } catch (e) {
      /* تجاهل أخطاء التسخين */
    }

    self.postMessage({
      type: "ready",
      device: activeDevice,
      threaded: !!self.crossOriginIsolated,
      threads:
        self.crossOriginIsolated && typeof navigator !== "undefined"
          ? navigator.hardwareConcurrency || 1
          : 1,
    });
    return transcriber;
  })().catch(function (err) {
    loadingPromise = null;
    self.postMessage({ type: "error", error: errMsg(err) });
    throw err;
  });

  return loadingPromise;
}

async function run(id, audio) {
  const t = await load();
  // المقاطع قصيرة (≤ ~6ث) فلا حاجة لتقطيع طويل (chunk_length_s) — تمريرة واحدة أسرع.
  const output = await t(audio, GEN_OPTS);
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
