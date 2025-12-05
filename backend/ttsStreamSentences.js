// backend/ttsStreamSentences.js - ENHANCED with smoother transitions
const axios = require("axios");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const VOICE_CONFIGS = {
  'en-US-terrell': { id: 'en-US-terrell', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-michael': { id: 'en-US-michael', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-wayne': { id: 'en-US-wayne', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-ryan': { id: 'en-US-ryan', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-natalie': { id: 'en-US-natalie', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-lily': { id: 'en-US-lily', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-US-claire': { id: 'en-US-claire', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-GB-william': { id: 'en-GB-william', style: 'Conversational', speed: 0, pitch: 0, variation: 1 },
  'en-GB-emma': { id: 'en-GB-emma', style: 'Conversational', speed: 0, pitch: 0, variation: 1 }
};

function sanitizeForTTS(text) {
  if (!text) return "";
  
  text = text.replace(/[""«»„]/g, '"');
  text = text.replace(/['']/g, "'");
  text = text.replace(/…/g, "...");
  text = text.replace(/\*\*/g, '');
  text = text.replace(/`/g, '');
  text = text.replace(/^Gyaanchand:\s*/i, '');
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/[\u0000-\u001F\u007F]/g, "");
  
  return text;
}

// ✅ OPTIMIZED: Consistent chunk sizes for smoother transitions
function splitIntoChunks(text) {
  text = sanitizeForTTS(text);
  if (!text) return [];

  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const s of sentences) {
    const candidate = current ? (current + " " + s) : s;
    
    // Target 100-150 chars for consistent voice quality
    if (candidate.length <= 150) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      
      if (s.length <= 150) {
        current = s;
      } else {
        // Split long sentences at natural breaks
        const parts = s.split(/,\s+|;\s+|\s+and\s+|\s+but\s+/);
        for (const p of parts) {
          if ((current + " " + p).trim().length <= 150) {
            current = current ? current + " " + p : p;
          } else {
            if (current) chunks.push(current);
            current = p;
          }
        }
      }
    }
  }
  
  if (current) chunks.push(current);
  
  console.log(`📝 [TTS-CHUNKING] Split into ${chunks.length} chunks`);
  chunks.forEach((chunk, i) => {
    console.log(`   [${i + 1}/${chunks.length}] ${chunk.length} chars: "${chunk.substring(0, 60)}..."`);
  });
  
  return chunks;
}

async function generateChunkTTS(text, voiceId, signal) {
  const config = VOICE_CONFIGS[voiceId] || VOICE_CONFIGS['en-US-terrell'];
  
  console.log(`🎙️ [MURF-API] Generating audio with voice: ${config.id}`);
  
  const payload = {
    voice_id: config.id,
    style: config.style,
    text: text,
    model: "FALCON",
    format: "MP3",
    sampleRate: 24000,
    channelType: "MONO",
    speed: config.speed,
    pitch: config.pitch,
    variation: config.variation,
    pauseSettings: {
      sentencePause: 400,  // Consistent pauses
      commaPause: 200
    }
  };

  const startTime = Date.now();

  try {
    const resp = await axios.post(
      "https://global.api.murf.ai/v1/speech/stream",
      payload,
      {
        headers: { 
          "api-key": process.env.MURF_API_KEY, 
          "Content-Type": "application/json" 
        },
        responseType: "arraybuffer",
        timeout: 25000,
        signal
      }
    );

    const elapsed = Date.now() - startTime;
    console.log(`✅ [MURF-API] Generated ${(resp.data.byteLength / 1024).toFixed(1)}KB in ${elapsed}ms`);

    return resp.data;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [MURF-ERROR] Failed after ${elapsed}ms: ${error.message}`);
    throw error;
  }
}

async function murfStreamSentences(text, ws, opts = {}) {
  const signal = opts.signal;
  const voiceId = opts.voiceId || 'en-US-terrell';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`🎙️ [TTS-STREAM] Starting synthesis`);
  console.log(`   Voice: ${voiceId}`);
  console.log(`   Text length: ${text.length} chars`);
  console.log(`${'='.repeat(70)}`);

  try {
    if (!text || !text.trim()) {
      console.log("⚠️ [TTS-WARNING] Empty text provided");
      return;
    }

    text = sanitizeForTTS(text);
    const chunks = splitIntoChunks(text);

    if (chunks.length === 0) {
      console.log("⚠️ [TTS-WARNING] No chunks to process after splitting");
      return;
    }

    let sent = 0;
    let interrupted = false;
    const totalStartTime = Date.now();

    // Generate and send each chunk
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) {
        console.log(`⛔ [TTS-INTERRUPT] User interrupted at chunk ${i + 1}/${chunks.length}`);
        interrupted = true;
        break;
      }

      const chunk = chunks[i];
      console.log(`\n📤 [TTS-CHUNK ${i + 1}/${chunks.length}] Processing...`);
      
      try {
        const audioBuffer = await generateChunkTTS(chunk, voiceId, signal);
        
        if (signal?.aborted) {
          console.log(`⛔ [TTS-INTERRUPT] User interrupted after generation ${i + 1}/${chunks.length}`);
          interrupted = true;
          break;
        }

        if (ws.readyState === 1) {
          const sendStartTime = Date.now();
          ws.send(audioBuffer);
          const sendTime = Date.now() - sendStartTime;
          sent++;
          
          console.log(`✅ [WS-SEND] Chunk ${i + 1}/${chunks.length} sent in ${sendTime}ms`);
          console.log(`   Size: ${(audioBuffer.byteLength / 1024).toFixed(1)}KB`);
          
          // Small gap for smoother playback transition
          if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 100));
          }
        } else {
          console.log(`❌ [WS-ERROR] Client disconnected at chunk ${i + 1}/${chunks.length}`);
          break;
        }

      } catch (err) {
        if (axios.isCancel && axios.isCancel(err)) {
          console.log(`⛔ [TTS-INTERRUPT] Murf request canceled at chunk ${i + 1}/${chunks.length}`);
          interrupted = true;
          break;
        }
        
        console.error(`❌ [TTS-ERROR] Chunk ${i + 1}/${chunks.length} failed: ${err.message}`);
        continue;
      }
    }

    const totalElapsed = Date.now() - totalStartTime;

    if (interrupted) {
      console.log(`\n⛔ [TTS-SUMMARY] Stream interrupted`);
      console.log(`   Delivered: ${sent}/${chunks.length} chunks`);
      console.log(`   Total time: ${totalElapsed}ms`);
    } else {
      console.log(`\n✅ [TTS-SUMMARY] Stream complete`);
      console.log(`   Delivered: ${sent}/${chunks.length} chunks`);
      console.log(`   Total time: ${totalElapsed}ms`);
      console.log(`   Average: ${(totalElapsed / sent).toFixed(0)}ms per chunk`);
    }

    console.log(`${'='.repeat(70)}\n`);

    if (ws.readyState === 1 && !interrupted) {
      setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: "tts_end" }));
          console.log("📢 [WS-SEND] TTS end signal sent");
        } catch {}
      }, 150);
    }

  } catch (err) {
    if (err.name === "CanceledError" || err.message === "canceled") {
      console.log("⛔ [TTS-INTERRUPT] TTS stream aborted");
      return;
    }
    
    console.error(`❌ [TTS-CRITICAL] Streaming error: ${err?.message || err}`);
    
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ 
        type: "error", 
        message: "Voice synthesis failed. Please try again." 
      }));
    }
  }
}

module.exports = murfStreamSentences;