// backend/ttsStreamSentences.js - FAST START with sentence streaming + Abort support + sanitization
const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// sanitize text for Murf TTS
function sanitizeForTTS(text) {
  if (!text) return "";
  // replace problematic punctuation/unicode
  text = text.replace(/[“”«»„]/g, '"');
  text = text.replace(/[‘’]/g, "'");
  text = text.replace(/…/g, "...");
  text = text.replace(/\s+/g, " ").trim();
  // strip control chars
  text = text.replace(/[\u0000-\u001F\u007F]/g, "");
  return text;
}

// Split text into speakable chunks (sentences or short phrases)
function splitIntoChunks(text) {
  text = sanitizeForTTS(text)
    .replace(/^Gyaanchand:\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();

  if (!text) return [];

  // Split on sentence boundaries while keeping things under ~180 chars
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);

  const chunks = [];
  let current = "";

  for (const s of sentences) {
    const candidate = current ? (current + " " + s) : s;
    if (candidate.length <= 180) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      if (s.length <= 180) current = s; else {
        // very long sentence — break at commas
        const parts = s.split(/, /);
        for (const p of parts) {
          if ((current + " " + p).trim().length <= 180) {
            current = current ? current + " " + p : p;
          } else {
            if (current) { chunks.push(current); current = p; } else { chunks.push(p); current = ""; }
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function generateChunkTTS(text, voiceConfig, signal) {
  const payload = {
    voice_id: voiceConfig.voice_id,
    text: text,
    model: "FALCON",
    format: "MP3",
    sampleRate: 24000,
    channelType: "MONO",
    speed: voiceConfig.speed,
    pitch: voiceConfig.pitch,
    variation: voiceConfig.variation || 1,
    pauseSettings: {
      sentencePause: voiceConfig.pauseSettings?.sentencePause ?? 380,
      commaPause: voiceConfig.pauseSettings?.commaPause ?? 240
    }
  };

  const resp = await axios.post(
    "https://global.api.murf.ai/v1/speech/stream",
    payload,
    {
      headers: { "api-key": process.env.MURF_API_KEY, "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: 60000,
      signal // support cancellation
    }
  );

  return resp.data;
}

async function murfStreamSentences(text, ws, opts = {}) {
  const signal = opts.signal;
  try {
    if (!text || !text.trim()) return;
    // sanitize and split
    text = sanitizeForTTS(text);

    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) { console.log("⚠️ No chunks to process"); return; }
    console.log(`📝 Split into ${chunks.length} chunks`);
    chunks.forEach((c,i) => console.log(`   ${i+1}. "${c.substring(0,60)}..."`));

    const voiceConfig = {
      voice_id: process.env.MURF_VOICE_ID || "en-US-michael",
      speed: Number(process.env.MURF_SPEED) || 94,
      pitch: Number(process.env.MURF_PITCH) || 0,
      variation: Number(process.env.MURF_VARIATION) || 1,
      pauseSettings: { sentencePause: 380, commaPause: 240 }
    };

    let sent = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (signal && signal.aborted) {
        console.log("⛔ TTS aborted before chunk", i+1);
        break;
      }

      try {
        console.log(`🎙️ [${i+1}/${chunks.length}] Generating: "${chunk.substring(0,40)}..."`);
        const audioBuffer = await generateChunkTTS(chunk, voiceConfig, signal);
        if (signal && signal.aborted) { console.log("⛔ TTS aborted after generation"); break; }
        if (ws.readyState === 1) {
          ws.send(audioBuffer);
          sent++;
          console.log(`✅ [${i+1}/${chunks.length}] Sent ${audioBuffer.byteLength} bytes`);
          // small gap between chunks to let client decode/play
          if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 140));
        } else {
          console.log("⚠️ Client WS closed, stopping TTS");
          break;
        }
      } catch (err) {
        if (axios.isCancel && axios.isCancel(err)) {
          console.log("⛔ Murf request canceled");
          break;
        }
        console.error(`❌ Failed chunk ${i+1}:`, err?.response?.data || err?.message || err);
        // continue to next chunk
      }
    }

    console.log(`✅ Completed: ${sent}/${chunks.length} chunks sent`);
    if (ws.readyState === 1) {
      setTimeout(() => { try { ws.send(JSON.stringify({ type: "tts_end" })); } catch(e){} }, 220);
    }
  } catch (err) {
    if (err.name === "CanceledError" || err.message === "canceled") {
      console.log("⛔ TTS aborted by signal");
      try { ws.send(JSON.stringify({ type: "stop_audio" })); } catch(e){}
      return;
    }
    console.error("❌ Sentence streaming error:", err?.response?.data || err?.message || err);
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: "error", message: "TTS failed" }));
  }
}

module.exports = murfStreamSentences;
