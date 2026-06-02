/*
 * عامل الويب (Web Worker) لتشغيل نموذج Whisper محلياً عبر Transformers.js v3
 * (راجع وثيقة المشروع: المرحلة 2 + المرحلة 4 — نموذج مخصّص للتلاوة).
 *
 * النموذج الأساسي: نسخة مخصّصة للتلاوة القرآنية (tarteel-ai/whisper-base-ar-quran)
 * حُوِّلت إلى ONNX (ترميز fp16 + فكّ ترميز مدمج q4f16) وتُخدَّم محلياً من المستودع
 * فتعمل دون إنترنت. عند تعذّر تحميله على الجهاز نتراجع تلقائياً إلى نموذج
 * Whisper العامّ (Xenova/whisper-base) من الشبكة، حتى لا تنكسر التجربة.
 *
 * تحسينات: WebGPU عند توفّره مع تراجع إلى WASM، وتسخين مبدئي، ومنع التكرار.
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

// نسمح بالنماذج المحلية (من المستودع) والبعيدة (للاحتياطي)، مع التخزين المؤقت.
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// مسار النماذج المحلية: مجلد models/ بجوار الصفحة (نسبةً إلى موقع العامل).
env.localModelPath = new URL("../models/", self.location.href).href;

// النموذج القرآني المحلي + إعداد الدقّة المطابق لأسماء ملفّاته.
const LOCAL_MODEL = "whisper-base-ar-quran";
const LOCAL_DTYPE = { encoder_model: "fp16", decoder_model_merged: "q4f16" };
// النموذج الاحتياطي العامّ (من Hugging Face).
const FALLBACK_MODEL = "Xenova/whisper-base";

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
let activeModel = LOCAL_MODEL;
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

function create(model, device, dtype) {
  return pipeline("automatic-speech-recognition", model, {
    device: device,
    dtype: dtype,
    progress_callback: function (info) {
      self.postMessage({ type: "progress", data: info });
    },
  });
}

// إعداد دقّة النموذج العامّ الاحتياطي حسب الجهاز.
function fallbackDtype(device) {
  return device === "webgpu"
    ? { encoder_model: "fp32", decoder_model_merged: "q4" }
    : "q8";
}

function load() {
  if (transcriber) return Promise.resolve(transcriber);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async function () {
    const wantGPU = await supportsWebGPU();
    let device = wantGPU ? "webgpu" : "wasm";

    // ١) النموذج القرآني المحلي.
    try {
      transcriber = await create(LOCAL_MODEL, device, LOCAL_DTYPE);
      activeModel = LOCAL_MODEL;
      activeDevice = device;
    } catch (errLocal) {
      self.postMessage({
        type: "progress",
        data: { status: "fallback", file: "النموذج القرآني المحلي تعذّر — التحويل إلى النموذج العامّ" },
      });
      // ٢) النموذج العامّ على نفس الجهاز، ثم على WASM كحلّ أخير.
      try {
        transcriber = await create(FALLBACK_MODEL, device, fallbackDtype(device));
        activeModel = FALLBACK_MODEL;
        activeDevice = device;
      } catch (errRemote) {
        if (device === "webgpu") {
          transcriber = await create(FALLBACK_MODEL, "wasm", fallbackDtype("wasm"));
          activeModel = FALLBACK_MODEL;
          activeDevice = "wasm";
        } else {
          throw errRemote;
        }
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
      model: activeModel,
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
