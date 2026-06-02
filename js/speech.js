/*
 * طبقة التعرّف على الصوت (راجع وثيقة المشروع: القسم 4-أ + المرحلة 2).
 *
 * تشغيل نموذج Whisper محلياً في المتصفّح عبر Transformers.js (داخل Web Worker).
 * هذه الطبقة غلاف يعزل بقيّة التطبيق عن تفاصيل المحرّك: يلتقط الصوت من
 * الميكروفون، ويقسّمه إلى مقاطع باستخدام كشف بسيط للنشاط الصوتي (VAD)، ويحوّله
 * إلى 16 كيلوهرتز أحادي القناة، ثم يرسله إلى العامل للتعرّف عليه، ويُخرج الكلمات
 * المتعرَّف عليها واحدةً تلو الأخرى إلى طبقة المحاذاة عبر onWord.
 *
 * الواجهة (start/stop/onWord/onState/onError) متطابقة مع النسخة السابقة، لذا
 * طبقتا المحاذاة والعرض لا تتغيّران.
 */
(function (global) {
  "use strict";

  const TARGET_RATE = 16000; // ما يتوقّعه Whisper.

  function SpeechEngine(options) {
    options = options || {};
    this.onWord = options.onWord || function () {};
    this.onState = options.onState || function () {};
    this.onError = options.onError || function () {};
    this.onStatus = options.onStatus || function () {}; // loading|ready|listening|recognizing
    this.onModelProgress = options.onModelProgress || function () {};
    this.onLevel = options.onLevel || function () {}; // (rms, speaking) لكل إطار صوتي
    this.onBackend = options.onBackend || function () {}; // ({device, threaded, threads})
    this.onProc = options.onProc || function () {}; // (tag, message) أحداث المعالجة للتشخيص

    // عتبات كشف النشاط الصوتي (VAD) — قابلة للضبط. خُفِّضت لتقليل زمن الاستجابة.
    this.speechThreshold = options.speechThreshold || 0.012; // طاقة RMS لاعتبار الإطار كلاماً.
    this.silenceMs = options.silenceMs || 450; // مدّة الصمت التي تُنهي المقطع.
    this.minSpeechMs = options.minSpeechMs || 250; // أقل كلام لاعتماد المقطع.
    this.maxSegmentMs = options.maxSegmentMs || 8000; // حدّ أقصى لطول المقطع.

    this.listening = false;
    this.modelReady = false;

    this.worker = null;
    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;

    this._segment = []; // مصفوفات Float32 بمعدّل العيّنات الأصلي.
    this._segmentSamples = 0;
    this._inSpeech = false;
    this._silenceRun = 0;
    this._speechRun = 0;
    this._jobId = 0;
    this._pending = 0; // عدد مقاطع التعرّف الجارية.
    this._sendTimes = {}; // id -> طابع زمني للإرسال (لقياس زمن التعرّف).
  }

  // مدعوم متى توفّر العامل والميكروفون وسياق الصوت (وسياق آمن https/localhost).
  SpeechEngine.isSupported = function () {
    return !!(
      global.Worker &&
      global.navigator &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      (global.AudioContext || global.webkitAudioContext)
    );
  };

  SpeechEngine.prototype._ensureWorker = function () {
    if (this.worker) return;
    const self = this;
    this.worker = new Worker("js/whisper-worker.js", { type: "module" });
    this.worker.onmessage = function (e) {
      const m = e.data || {};
      if (m.type === "progress") {
        self.onModelProgress(m.data);
      } else if (m.type === "ready") {
        self.modelReady = true;
        self.onBackend({
          device: m.device,
          threaded: m.threaded,
          threads: m.threads,
        });
        self.onStatus(self.listening ? "listening" : "ready");
      } else if (m.type === "result") {
        self._pending = Math.max(0, self._pending - 1);
        const sent = self._sendTimes[m.id];
        const lat = sent ? Math.round(performance.now() - sent) : -1;
        delete self._sendTimes[m.id];
        const text = (m.text || "").trim();
        self.onProc(
          "asr",
          "تعرّف #" + m.id + (lat >= 0 ? " (" + lat + "مﺙ)" : "") + ": «" + text + "»"
        );
        const tokens = text.split(/\s+/).filter(Boolean);
        for (let i = 0; i < tokens.length; i++) self.onWord(tokens[i], true);
        if (self._pending === 0 && self.listening) self.onStatus("listening");
      } else if (m.type === "error") {
        self.onError(m.error || "worker-error");
      }
    };
    this.worker.onerror = function (e) {
      self.onError((e && e.message) || "worker-error");
    };
  };

  // ضبط عتبة كشف النشاط الصوتي لحظياً.
  SpeechEngine.prototype.setSpeechThreshold = function (t) {
    this.speechThreshold = t;
  };

  // بدء تحميل النموذج مسبقاً دون فتح الميكروفون.
  SpeechEngine.prototype.loadModel = function () {
    this._ensureWorker();
    if (!this.modelReady) {
      this.onStatus("loading");
      this.worker.postMessage({ type: "load" });
    }
  };

  SpeechEngine.prototype.start = async function () {
    if (this.listening) return;
    if (!SpeechEngine.isSupported()) {
      this.onError("unsupported");
      return;
    }
    this._ensureWorker();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.onError("not-allowed");
      return;
    }

    const Ctx = global.AudioContext || global.webkitAudioContext;
    this.audioCtx = new Ctx();
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);

    const self = this;
    const frameMs = (4096 / this.audioCtx.sampleRate) * 1000;
    this.onProc(
      "mic",
      "الميكروفون مفتوح — معدّل العيّنات " +
        this.audioCtx.sampleRate +
        "هرتز، إطار ≈ " +
        Math.round(frameMs) +
        "مﺙ"
    );
    this.processor.onaudioprocess = function (ev) {
      self._handleFrame(ev.inputBuffer.getChannelData(0), frameMs);
    };

    // نوجّه المعالج عبر مكسب صفري إلى المخرج حتى يعمل دون سماع صدى.
    this.silentGain = this.audioCtx.createGain();
    this.silentGain.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioCtx.destination);

    this.listening = true;
    this._resetSegment();

    if (!this.modelReady) {
      this.onStatus("loading");
      this.worker.postMessage({ type: "load" });
    } else {
      this.onStatus("listening");
    }
    this.onState(true);
  };

  SpeechEngine.prototype._handleFrame = function (input, frameMs) {
    // طاقة RMS للإطار لتحديد وجود كلام.
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const speaking = rms >= this.speechThreshold;

    // أبلغ طبقة العرض بمستوى الصوت وحالة الكشف لتحديث المقياس لحظياً.
    this.onLevel(rms, speaking);

    if (speaking) {
      this._inSpeech = true;
      this._silenceRun = 0;
      this._speechRun += frameMs;
    } else {
      this._silenceRun += frameMs;
    }

    // اجمع العيّنات ما دمنا في مقطع كلام (يشمل لحظات الصمت القصيرة بداخله).
    if (this._inSpeech) {
      this._segment.push(new Float32Array(input));
      this._segmentSamples += input.length;
    }

    const segMs = (this._segmentSamples / this.audioCtx.sampleRate) * 1000;
    const endedBySilence =
      this._silenceRun >= this.silenceMs && this._speechRun >= this.minSpeechMs;
    const endedByLength = segMs >= this.maxSegmentMs;

    if (this._inSpeech && (endedBySilence || endedByLength)) {
      this._flush();
    }
  };

  SpeechEngine.prototype._flush = function () {
    const samples = this._segmentSamples;
    const enough = this._speechRun >= this.minSpeechMs;
    const segment = this._segment;
    this._resetSegment();

    if (!enough || samples === 0) return;

    const merged = new Float32Array(samples);
    let off = 0;
    for (let i = 0; i < segment.length; i++) {
      merged.set(segment[i], off);
      off += segment[i].length;
    }

    const down = downsample(merged, this.audioCtx.sampleRate, TARGET_RATE);
    const segMs = Math.round((samples / this.audioCtx.sampleRate) * 1000);
    const id = ++this._jobId;
    this._pending++;
    this._sendTimes[id] = performance.now();
    this.onStatus("recognizing");
    this.onProc(
      "seg",
      "مقطع #" + id + ": " + segMs + "مﺙ، " + down.length + " عيّنة @16ك → إرسال"
    );
    this.worker.postMessage(
      { type: "transcribe", id: id, audio: down },
      [down.buffer] // نقل الملكية لتفادي النسخ.
    );
  };

  SpeechEngine.prototype._resetSegment = function () {
    this._segment = [];
    this._segmentSamples = 0;
    this._inSpeech = false;
    this._silenceRun = 0;
    this._speechRun = 0;
  };

  SpeechEngine.prototype.stop = function () {
    // أرسل ما تبقّى من كلام قبل الإيقاف.
    if (this._inSpeech) this._flush();

    this.listening = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch (e) {}
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (e) {}
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch (e) {}
    }
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (e) {}
    }
    this.audioCtx = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.stream = null;
    this._resetSegment();

    this.onProc("mic", "أُغلق الميكروفون.");
    this.onState(false);
  };

  /** إعادة أخذ العيّنات بخطّية بسيطة من معدّل إلى آخر. */
  function downsample(buffer, inRate, outRate) {
    if (outRate === inRate) return buffer;
    const ratio = inRate / outRate;
    const newLen = Math.max(1, Math.round(buffer.length / ratio));
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, buffer.length - 1);
      const frac = idx - i0;
      result[i] = buffer[i0] * (1 - frac) + buffer[i1] * frac;
    }
    return result;
  }

  global.SpeechEngine = SpeechEngine;
})(typeof window !== "undefined" ? window : this);
