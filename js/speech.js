/*
 * طبقة التعرّف على الصوت (راجع وثيقة المشروع: القسم 4-أ).
 *
 * النموذج الأولي يستخدم واجهة التعرّف على الكلام في المتصفّح (Web Speech API).
 * هذه الطبقة غلاف رفيع يعزل بقيّة التطبيق عن تفاصيل المحرّك، بحيث يمكن لاحقاً
 * استبداله بنموذج محلي (whisper.cpp / Vosk) دون المساس بطبقة المحاذاة.
 */
(function (global) {
  "use strict";

  const SpeechRecognition =
    global.SpeechRecognition || global.webkitSpeechRecognition || null;

  function SpeechEngine(options) {
    options = options || {};
    this.lang = options.lang || "ar-SA";
    this.onWord = options.onWord || function () {};
    this.onState = options.onState || function () {};
    this.onError = options.onError || function () {};

    this.recognition = null;
    this.listening = false;
    this._wantListening = false;
    this._processedTokens = 0; // عدد كلمات النتيجة الجارية التي أُرسلت فعلاً.
  }

  SpeechEngine.isSupported = function () {
    return !!SpeechRecognition;
  };

  SpeechEngine.prototype._build = function () {
    const rec = new SpeechRecognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const self = this;

    rec.onresult = function (event) {
      // نمرّ على النتائج بدءاً من resultIndex، ونرسل الكلمات الجديدة فقط.
      let interimWords = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const tokens = transcript.trim().split(/\s+/).filter(Boolean);

        if (result.isFinal) {
          // أرسل ما تبقّى من كلمات هذه النتيجة النهائية ثم صفّر العدّاد.
          for (let t = self._processedTokens; t < tokens.length; t++) {
            self.onWord(tokens[t], true);
          }
          self._processedTokens = 0;
        } else {
          interimWords = tokens;
        }
      }

      // للنتائج المؤقتة: أرسل الكلمات «المستقرّة» الجديدة فقط (كل ما عدا الأخيرة
      // التي قد تتغيّر)، وتتبّع كم أرسلنا لتجنّب التكرار.
      if (interimWords.length > self._processedTokens + 1) {
        for (let t = self._processedTokens; t < interimWords.length - 1; t++) {
          self.onWord(interimWords[t], false);
        }
        self._processedTokens = interimWords.length - 1;
      }
    };

    rec.onerror = function (event) {
      // no-speech و aborted أخطاء عابرة لا تستدعي إيقاف التتبّع.
      if (event.error === "no-speech" || event.error === "aborted") return;
      self.onError(event.error);
    };

    rec.onend = function () {
      self._processedTokens = 0;
      // المحرّك يتوقّف تلقائياً بعد فترة صمت؛ أعد التشغيل إن كنا ما زلنا نريد الاستماع.
      if (self._wantListening) {
        try {
          rec.start();
        } catch (e) {
          self.listening = false;
          self._wantListening = false;
          self.onState(false);
        }
      } else {
        self.listening = false;
        self.onState(false);
      }
    };

    return rec;
  };

  SpeechEngine.prototype.start = function () {
    if (!SpeechRecognition) {
      this.onError("unsupported");
      return;
    }
    if (this.listening) return;
    this.recognition = this._build();
    this._wantListening = true;
    this._processedTokens = 0;
    try {
      this.recognition.start();
      this.listening = true;
      this.onState(true);
    } catch (e) {
      this.onError(e && e.message ? e.message : "start-failed");
    }
  };

  SpeechEngine.prototype.stop = function () {
    this._wantListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        /* تجاهل */
      }
    }
    this.listening = false;
    this.onState(false);
  };

  global.SpeechEngine = SpeechEngine;
})(typeof window !== "undefined" ? window : this);
