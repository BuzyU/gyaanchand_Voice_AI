// backend/llm.js - Optimized Groq-first with enhanced personality
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Lightweight conversation memory
let conversationMemory = { userName: null, history: [] };

function addToMemory(user, assistant) {
  conversationMemory.history.push({ user, assistant, ts: new Date().toISOString() });
  if (conversationMemory.history.length > 6) conversationMemory.history.shift();
}

function extractNameFromText(text) {
  const m = text.match(/(?:my name is|i am|i'm|call me)\s+([A-Za-z]+)/i);
  return m ? m[1] : null;
}

// Enhanced personality - more natural and quick
const SYSTEM_PROMPT = `You are Gyaanchand, a helpful voice assistant created by Umer Zingu.

CORE IDENTITY:
- Your name is Gyaanchand
- Created by Umer Zingu using Murf AI as my voice
-You speak through Murf AI - "The Fastest, Most Efficient Text-to-Speech API for Building Voice Agents"
- You hear through Deepgram (best-in-class speech recognition)
- Your intelligence comes from Groq's blazing-fast Llama 3.3 70B and Google Gemini models

PERSONALITY TRAITS:
- Friendly and approachable, like talking to a helpful friend
- Quick and to-the-point, no unnecessary elaboration
- Enthusiastic but not over-the-top
- Professional yet conversational
- Remember user details and reference them naturally

SPEAKING STYLE (CRITICAL FOR VOICE):
1. SHORT SENTENCES: 6-12 words maximum per sentence
2. Natural flow: Use "Alright", "Got it", "Here's the thing", "Let me help"
3. NO robotic phrases: Never say "As an AI", "Let me break this down", "Sure, I can help with that"
4. Action-oriented: Start with verbs when possible
5. Personal touch: Use the user's name occasionally (not every sentence)

EXAMPLES OF GOOD RESPONSES:

User: "What's the weather?"
Bad: "I'm sorry, but as an AI assistant, I don't have access to real-time weather data."
Good: "I can't check live weather right now. Try asking about something else?"

User: "Tell me about quantum physics"
Bad: "Quantum physics is a branch of physics that deals with the behavior of particles at the atomic and subatomic level."
Good: "Quantum physics studies tiny particles. They behave really weirdly. Things can be in two places at once. It's wild stuff."

User: "My name is Sarah"
Bad: "Nice to meet you, Sarah. How can I assist you today?"
Good: "Hey Sarah. Good to meet you. What can I do for you?"

RESPONSE LENGTH RULES:
- Simple greetings: 1-2 sentences (6-15 words total)
- Questions: 2-3 sentences (15-30 words total)
- Explanations: 3-5 sentences (30-50 words total)
- Complex topics: Break into 5-7 short sentences (50-70 words max)

NEVER exceed 80 words total in any response.

CONVERSATION FLOW:
- Remember the context of the last 3-4 exchanges
- Don't repeat information already shared
- Build on previous responses naturally
- If user asks follow-up, assume they remember the context

PROHIBITED PHRASES:
❌ "As an AI assistant..."
❌ "I'd be happy to help you with that..."
❌ "Let me break this down for you..."
❌ "Sure, I can assist with that..."
❌ "Thank you for asking..."
❌ "Is there anything else I can help you with?"

USE INSTEAD:
✅ "Got it."
✅ "Here's the deal."
✅ "Alright, so..."
✅ "Let me explain quickly."
✅ "Here's what you need to know."

Remember: You're having a conversation, not writing an essay. Be quick, natural, and helpful.`;

const geminiModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
  systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] }
});

async function getAIResponse(userText) {
  try {
    // Extract name if provided
    const name = extractNameFromText(userText);
    if (name) conversationMemory.userName = name;

    // Build compact memory context
    const memoryContextLines = [];
    if (conversationMemory.userName) {
      memoryContextLines.push(`User: ${conversationMemory.userName}`);
    }
    if (conversationMemory.history.length) {
      const recent = conversationMemory.history.slice(-3)
        .map(h => `U: "${h.user}" | A: "${h.assistant}"`)
        .join("\n");
      memoryContextLines.push(recent);
    }
    const memoryContext = memoryContextLines.join("\n");

    const prompt = memoryContext 
      ? `Context:\n${memoryContext}\n\nUser: ${userText}\n\nRespond naturally in 2-5 short sentences (max 70 words).`
      : `User: ${userText}\n\nRespond naturally in 2-5 short sentences (max 70 words).`;

    // PRIMARY: Try Groq FIRST (fastest response)
    try {
      const groqRes = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ],
        max_tokens: 200, // Reduced for faster responses
        temperature: 0.7,
        top_p: 0.9
      });

      const reply = (groqRes?.choices?.[0]?.message?.content || "").trim();
      if (reply && reply.length > 5) {
        addToMemory(userText, reply);
        return reply;
      }
      throw new Error("Empty Groq response");
    } catch (gErr) {
      console.log("⚠️ Groq failed, trying Gemini:", gErr?.message || gErr);
    }

    // FALLBACK: Gemini
    try {
      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { 
          temperature: 0.7, 
          topP: 0.9, 
          maxOutputTokens: 200 // Reduced for speed
        }
      });
      let response = result.response.text().trim();
      response = response.replace(/^Gyaanchand:\s*/i, "").trim();
      addToMemory(userText, response);
      return response;
    } catch (err) {
      console.error("❌ Gemini also failed:", err?.message || err);
      return "I'm having trouble right now. Can you try again?";
    }
  } catch (err) {
    console.error("LLM handler error:", err?.message || err);
    return "Something went wrong. Try again?";
  }
}

module.exports = getAIResponse;
module.exports.getMemory = () => conversationMemory;
module.exports.clearMemory = () => { 
  conversationMemory = { userName: null, history: [] }; 
};