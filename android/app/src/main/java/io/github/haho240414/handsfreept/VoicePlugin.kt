package io.github.haho240414.handsfreept

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.SoundPool
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.Locale

/**
 * 운동 음성: 폰의 TTS 엔진으로 말하되
 * 1) 말하는 동안 음악 소리를 잠깐 줄인다(내비게이션 안내처럼, 오디오 포커스 '잠깐·줄여도 됨').
 *    공개 TTS 플러그인은 포커스를 안 잡아서 음악을 틀어 두면 숫자가 묻혔다.
 * 2) 숫자·자주 하는 말은 미리 파일로 만들어(synthesizeToFile) SoundPool 로 바로 튼다 → 매번 문장을 만드는 지연이 없다.
 *    미리 만드는 일은 말하기와 다른 TTS 인스턴스로(말하기에서 큐를 비워도 만들던 게 안 지워지게).
 * 3) 목소리(폰에 깔린 한국어 목소리)·빠르기를 고른다.
 */
@CapacitorPlugin(name = "HfptVoice")
class VoicePlugin : Plugin() {
    private class Clip(val soundId: Int, val durMs: Long) { var loaded = false }

    private val main = Handler(Looper.getMainLooper())
    private val attrs: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private var tts: TextToSpeech? = null
    private var synth: TextToSpeech? = null
    private var ttsReady = false
    private var synthReady = false
    private var initFailed = false
    private val waiting = mutableListOf<() -> Unit>()

    private var pool: SoundPool? = null
    private val clips = HashMap<String, Clip>()      // 말 → 소리
    private val bySound = HashMap<Int, Clip>()
    private var lastStream = 0

    private var voiceName: String? = null
    private var rate = 1.05f
    private var duck = true

    // 오디오 포커스: 말하는 동안만 잡고, 끝나고 조금 뒤 놓는다(숫자 사이마다 음악이 오르내리지 않게)
    private var focusHeld = false
    private var focusReq: AudioFocusRequest? = null
    private var speaking = 0
    private var clipUntil = 0L
    private val release = Runnable { maybeRelease() }

    // 미리 만들기: 말 id → 끝나면 할 일
    private val synthDone = HashMap<String, (Boolean) -> Unit>()
    private var seq = 0

    override fun load() {
        pool = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(attrs).build().also { p ->
            p.setOnLoadCompleteListener { _, id, status -> bySound[id]?.loaded = status == 0 }
        }
        tts = TextToSpeech(context) { st -> main.post { onInit(st, false) } }
        synth = TextToSpeech(context) { st -> main.post { onInit(st, true) } }
    }

    private fun onInit(status: Int, forSynth: Boolean) {
        val e = if (forSynth) synth else tts
        if (status != TextToSpeech.SUCCESS || e == null) { initFailed = true; flushWaiting(); return }
        e.setLanguage(Locale.KOREAN)
        e.setAudioAttributes(attrs)
        applyVoice(e)
        e.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { main.post { finished(id, true) } }
            @Deprecated("호환")
            override fun onError(id: String?) { main.post { finished(id, false) } }
            override fun onError(id: String?, code: Int) { main.post { finished(id, false) } }
            override fun onStop(id: String?, interrupted: Boolean) { main.post { finished(id, false) } }
        })
        if (forSynth) synthReady = true else ttsReady = true
        flushWaiting()
    }

    private fun flushWaiting() {
        if (!(ttsReady && synthReady) && !initFailed) return
        val w = waiting.toList(); waiting.clear(); w.forEach { it() }
    }

    /** 엔진 준비를 기다렸다가(최대 5초) 실행 */
    private fun whenReady(fn: () -> Unit) {
        if ((ttsReady && synthReady) || initFailed) { fn(); return }
        var done = false
        val once = { if (!done) { done = true; fn() } }
        waiting.add(once)
        main.postDelayed({ waiting.remove(once); once() }, 5000)
    }

    private fun finished(id: String?, ok: Boolean) {
        if (id == null) return
        if (id.startsWith("say")) {
            speaking = maxOf(0, speaking - 1)
            scheduleRelease(400)
        } else synthDone.remove(id)?.invoke(ok)
    }

    private fun applyVoice(e: TextToSpeech) {
        e.setSpeechRate(rate)
        val name = voiceName ?: return
        try { e.voices?.firstOrNull { it.name == name }?.let { e.setVoice(it) } } catch (_: Exception) { }
    }

    private fun koreanVoices(): JSArray {
        val out = JSArray()
        val list = try { tts?.voices?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
        list.filter { it.locale.language == "ko" && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
            .sortedWith(compareBy({ it.isNetworkConnectionRequired }, { -it.quality }, { it.name }))
            .forEach { v ->
                out.put(JSObject().put("name", v.name).put("local", !v.isNetworkConnectionRequired)
                    .put("quality", v.quality).put("latency", v.latency))
            }
        return out
    }

    @PluginMethod
    fun status(call: PluginCall) {
        whenReady {
            val o = JSObject()
            o.put("ready", ttsReady && !initFailed)
            o.put("engine", tts?.defaultEngine ?: "")
            o.put("voice", try { tts?.voice?.name } catch (_: Exception) { null })
            o.put("voices", koreanVoices())
            o.put("korean", try { (tts?.isLanguageAvailable(Locale.KOREAN) ?: -2) >= TextToSpeech.LANG_AVAILABLE } catch (_: Exception) { false })
            o.put("clips", clips.values.count { it.loaded })
            call.resolve(o)
        }
    }

    /** { voice: 이름 | '' (엔진 기본), rate: 0.5~2, duck: 음악 줄이기 } */
    @PluginMethod
    fun configure(call: PluginCall) {
        whenReady {
            val v = call.getString("voice", "") ?: ""
            voiceName = v.ifEmpty { null }
            rate = (call.getDouble("rate") ?: rate.toDouble()).toFloat().coerceIn(0.5f, 2f)
            duck = call.getBoolean("duck", true) ?: true
            if (voiceName == null) {
                // 엔진 기본 목소리로 되돌리기
                tts?.let { e -> try { e.defaultVoice?.let { e.setVoice(it) } } catch (_: Exception) { } }
                synth?.let { e -> try { e.defaultVoice?.let { e.setVoice(it) } } catch (_: Exception) { } }
            }
            tts?.let { applyVoice(it) }
            synth?.let { applyVoice(it) }
            call.resolve(JSObject().put("voice", try { tts?.voice?.name } catch (_: Exception) { null }))
        }
    }

    /** { text, flush: 말하던 것을 끊고 바로 } */
    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("text 없음")
        val flush = call.getBoolean("flush", false) ?: false
        whenReady {
            val e = tts
            if (e == null || !ttsReady) return@whenReady call.reject("TTS 준비 안 됨")
            if (flush) stopClip()
            say(e, text, flush)
            call.resolve()
        }
    }

    private fun say(e: TextToSpeech, text: String, flush: Boolean) {
        holdFocus()
        if (flush) speaking = 0
        speaking++
        val r = e.speak(text, if (flush) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, Bundle(), "say${++seq}")
        if (r != TextToSpeech.SUCCESS) { speaking = maxOf(0, speaking - 1); scheduleRelease(0) }
    }

    /**
     * 미리 만들어 둔 말을 바로 튼다. { text, flush, then: 이어서 TTS 로 말할 것 }
     * → { played: false } 면 아직 없음(호출한 쪽이 TTS 로 말한다)
     */
    @PluginMethod
    fun play(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("text 없음")
        val c = clips[key(text)]
        val p = pool
        if (c == null || !c.loaded || p == null) { call.resolve(JSObject().put("played", false)); return }
        if (call.getBoolean("flush", true) == true) { tts?.stop(); speaking = 0; stopClip() }
        holdFocus()
        lastStream = p.play(c.soundId, 1f, 1f, 1, 0, 1f)
        clipUntil = SystemClock.uptimeMillis() + c.durMs
        scheduleRelease(c.durMs + 300)
        val then = call.getString("then")
        if (!then.isNullOrBlank()) main.postDelayed({ tts?.let { say(it, then, false) } }, c.durMs + 60)
        call.resolve(JSObject().put("played", lastStream != 0))
    }

    private fun stopClip() {
        if (lastStream != 0) pool?.stop(lastStream)
        lastStream = 0
        clipUntil = 0
    }

    /**
     * 말 목록을 미리 파일로 만들어 둔다(목소리·빠르기별 캐시 → 다음 실행부터는 바로 불러옴).
     * { texts: [...] } → { ready, made, total, ms }
     */
    @PluginMethod
    fun prepare(call: PluginCall) {
        val texts = try { call.getArray("texts")?.toList<String>() ?: emptyList() } catch (_: Exception) { emptyList() }
        whenReady {
            val e = synth
            if (e == null || !synthReady) return@whenReady call.reject("TTS 준비 안 됨")
            val t0 = SystemClock.uptimeMillis()
            val dir = File(context.cacheDir, "hfpt-voice").apply { mkdirs() }
            val todo = texts.distinct().filter { clips[key(it)]?.loaded != true }
            var made = 0
            var left = todo.size
            val finish = {
                call.resolve(JSObject().put("ready", clips.values.count { it.loaded }).put("made", made)
                    .put("total", texts.size).put("ms", SystemClock.uptimeMillis() - t0))
            }
            if (left == 0) return@whenReady finish()
            // 다 못 만들어도 30초면 끝낸다(만든 것만 쓴다)
            var ended = false
            val end = { if (!ended) { ended = true; main.postDelayed({ finish() }, 300) } }
            main.postDelayed({ end() }, 30000)
            for (text in todo) {
                val k = key(text)
                val f = File(dir, "$k.wav")
                val step = { ok: Boolean ->
                    if (ok && f.length() > 44) load(k, f)
                    left--
                    if (left <= 0) end()
                }
                if (f.length() > 44) { step(true); continue }
                val id = "mk${++seq}"
                synthDone[id] = { ok -> made += if (ok) 1 else 0; step(ok) }
                val r = e.synthesizeToFile(text, Bundle(), f, id)
                if (r != TextToSpeech.SUCCESS) { synthDone.remove(id); step(false) }
            }
        }
    }

    private fun load(k: String, f: File) {
        val p = pool ?: return
        val id = p.load(f.absolutePath, 1)
        val c = Clip(id, wavMs(f))
        clips[k] = c
        bySound[id] = c
    }

    /** WAV 머리말에서 길이(ms): 초당 바이트(28~31번째)로 데이터 크기를 나눈다 */
    private fun wavMs(f: File): Long = try {
        RandomAccessFile(f, "r").use { r ->
            val b = ByteArray(32); r.readFully(b)
            val byteRate = (b[28].toInt() and 0xff) or ((b[29].toInt() and 0xff) shl 8) or
                ((b[30].toInt() and 0xff) shl 16) or ((b[31].toInt() and 0xff) shl 24)
            if (byteRate > 0) (f.length() - 44) * 1000 / byteRate else 800
        }
    } catch (_: Exception) { 800 }

    /** 같은 말이라도 목소리·빠르기가 다르면 다른 파일 */
    private fun key(text: String): String {
        val v = try { synth?.voice?.name ?: "" } catch (_: Exception) { "" }
        val d = MessageDigest.getInstance("SHA-1").digest("$v|$rate|$text".toByteArray())
        return d.joinToString("") { "%02x".format(it) }.take(20)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        tts?.stop()
        speaking = 0
        stopClip()
        scheduleRelease(0)
        call.resolve()
    }

    private fun holdFocus() {
        main.removeCallbacks(release)
        if (!duck || focusHeld) return
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        // minSdk 26 이라 AudioFocusRequest 만 쓴다
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs).setOnAudioFocusChangeListener { }.build()
        focusReq = req
        val r = am.requestAudioFocus(req)
        focusHeld = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun scheduleRelease(ms: Long) {
        main.removeCallbacks(release)
        main.postDelayed(release, maxOf(ms, 0))
    }

    private fun maybeRelease() {
        if (speaking > 0) return
        val wait = clipUntil - SystemClock.uptimeMillis()
        if (wait > 0) { scheduleRelease(wait + 200); return }
        if (!focusHeld) return
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        focusReq?.let { am.abandonAudioFocusRequest(it) }
        focusHeld = false
    }

    override fun handleOnDestroy() {
        main.removeCallbacksAndMessages(null)
        try { tts?.shutdown(); synth?.shutdown(); pool?.release() } catch (_: Exception) { }
        super.handleOnDestroy()
    }
}
