// backend/voiceStyle.js - conversationalize + sanitize helper
function conversationalize(text) {
  if (!text || !text.trim()) return "I didn't catch that, please say it again.";

  text = text.trim();
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\.{2,}/g, ".");
  // Normalize punctuation
  text = text.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  if (!text.endsWith(".")) text += ".";

  // Minimal warmers but avoid random intros that break TTS
  const warmeners = [
    "Let me explain this simply. ",
    "Here's a clear explanation. ",
    "Let's break it down. "
  ];

  // Keep it deterministic-ish: use first warmener 30% of time
  if (Math.random() < 0.30) {
    text = warmeners[Math.floor(Math.random() * warmeners.length)] + text;
  }

  // gentle pacing: add extra pause markers (period + two spaces)
  text = text.replace(/\. /g, ".  ");

  return text;
}

// small sanitizer for TTS - can be used separately if needed
function sanitizeForTTS(text) {
  if (!text) return "";
  text = text.replace(/[“”«»]/g, '"');
  text = text.replace(/[‘’]/g, "'");
  text = text.replace(/…/g, "...");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

module.exports = conversationalize;
module.exports.sanitizeForTTS = sanitizeForTTS;
