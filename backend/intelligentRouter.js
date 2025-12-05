// backend/intelligentRouter.js - ENHANCED with better responses and logging
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Groq = require("groq-sdk");
const crypto = require("crypto");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ✅ RESPONSE CACHE
const responseCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

// ✅ CONTEXT CACHE
let geminiFlashModel = null;
let geminiProModel = null;

function getCacheKey(text, memoryContext, hasDocument) {
  const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const hash = crypto.createHash('md5')
    .update(normalized + (hasDocument ? 'doc' : 'no-doc'))
    .digest('hex');
  return hash.substring(0, 16);
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`⚡ [CACHE] HIT for key: ${key}`);
    return cached.response;
  }
  if (cached) responseCache.delete(key);
  return null;
}

function setCachedResponse(key, response) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(key);
  }
  responseCache.set(key, { response, timestamp: Date.now() });
  console.log(`💾 [CACHE] Stored response for key: ${key}`);
}

function classifyIntent(text) {
  const lower = text.toLowerCase();
  
  // Email detection
  if (/send\s+(an?\s+)?email|email\s+to|compose\s+email|mail\s+(my|the)?/i.test(text)) {
    return { type: "email", complexity: "complex" };
  }
  
  // Calendar detection
  if (/schedule|calendar|meeting|appointment|event|book\s+(a\s+)?date|set\s+(a\s+)?reminder/i.test(text)) {
    return { type: "calendar", complexity: "complex" };
  }
  
  // Document detection
  if (/analyze|summarize|extract|tell.*about.*document|what.*document|document.*about|pdf|explain.*pdf/i.test(text)) {
    return { type: "document", complexity: "complex" };
  }
  
  // Simple queries
  if (/^(hi|hey|hello|what's up|how are you|good morning|good evening|who are you|what is your name|my name is)/i.test(text)) {
    return { type: "greeting", complexity: "simple" };
  }
  
  if (text.length < 50 && !/explain|compare|analyze|why|how does|detail/i.test(text)) {
    return { type: "general", complexity: "simple" };
  }
  
  // Complex queries - need detailed responses
  if (
    text.length > 100 ||
    /explain.*detail|compare|analyze|what.*difference|step.*step|detailed|comprehensive|thorough/i.test(text) ||
    /tell me about|describe|what is|how does/i.test(text) ||
    /code|program|algorithm|implement/i.test(text)
  ) {
    return { type: "general", complexity: "complex" };
  }
  
  return { type: "general", complexity: "medium" };
}

function getSystemPrompt(intent, hasMemory, hasDocument) {
  const basePrompt = `You are Gyaanchand, a sophisticated voice assistant created by Umer Zingu.

IDENTITY & TECHNOLOGY:
- Your name is Gyaanchand
- Created by Umer Zingu
- Voice: Murf AI - "The Fastest, Most Efficient Text-to-Speech API for Building Voice Agents"
- Hearing: Deepgram - Best-in-class speech recognition
- Intelligence: Google Gemini and Groq's Llama 3.3 70B models

RESPONSE LENGTH RULES (CRITICAL):
- Greetings/simple: 20-40 words (2-3 sentences)
- Medium queries: 60-100 words (4-6 sentences)
- Complex explanations: 120-180 words (8-12 sentences)
- Document analysis: 80-120 words (5-8 sentences with key facts)
- Technical topics: 150-200 words (10-14 sentences with structure)

VOICE-OPTIMIZED SPEAKING STYLE:
✅ Clear structure with smooth transitions
✅ Natural, conversational tone
✅ Use "Here's the thing", "Let me explain", "So basically"
✅ Short sentences (8-15 words) for easy listening
✅ Reference memory naturally: "You mentioned...", "Like we discussed..."
❌ Never: "As an AI...", robotic phrases

STRUCTURED RESPONSES:
For complex topics, use this format:
1. Brief intro (1 sentence)
2. Main explanation (3-5 sentences)
3. Key points or examples (2-4 sentences)
4. Brief summary or conclusion (1 sentence)

BE CONVERSATIONAL:
- Use contractions naturally
- Show personality while staying professional
- Remember context from conversation
- Give complete, helpful answers`;

  if (intent.type === "greeting") {
    return basePrompt + `\n\nFor greetings: Keep it brief (20-30 words) but warm and welcoming.`;
  }
  
  if (intent.type === "email" || intent.type === "calendar") {
    return basePrompt + `\n\nFor email/calendar requests: Confirm the action clearly and ask for any missing details.`;
  }
  
  if (hasDocument) {
    return basePrompt + `\n\nDocument context provided. Extract key facts and provide structured analysis with specific details.`;
  }
  
  if (intent.complexity === "complex") {
    return basePrompt + `\n\nComplex query detected. Provide thorough, well-structured explanation with clear transitions between points.`;
  }
  
  return basePrompt;
}

function buildMemoryContext(memoryContext) {
  if (!memoryContext || memoryContext.length < 10) return "";
  
  const lines = memoryContext.split('\n').filter(l => l.trim());
  const compact = [];
  
  for (const line of lines) {
    if (line.includes("User's name:") || line.includes("Topic:")) {
      compact.push(line);
    } else if (line.includes("Recent") && compact.length < 3) {
      const messages = line.split('|').slice(-3).join('|');
      compact.push(messages.substring(0, 200));
    }
  }
  
  return compact.join('\n').substring(0, 250);
}

function getGeminiFlashModel() {
  if (!geminiFlashModel) {
    geminiFlashModel = genAI.getGenerativeModel({ 
      model: "**gemini-2.5-flash**", // Changed from gemini-1.5-flash
      generationConfig: { 
        temperature: 0.7, 
        topP: 0.85, 
        maxOutputTokens: 300,
        candidateCount: 1
      }
    });
  }
  return geminiFlashModel;
}

function getGeminiProModel() {
  if (!geminiProModel) {
    geminiProModel = genAI.getGenerativeModel({ 
      model: "**gemini-2.5-pro**", // Changed from gemini-2.0-flash (which is also likely a mistype in the original code, as it's typically 'pro')
      generationConfig: { 
        temperature: 0.7, 
        topP: 0.9, 
        maxOutputTokens: 400,
        candidateCount: 1
      }
    });
  }
  return geminiProModel;
}


async function callGeminiFlash(prompt, systemPrompt, signal) {
  console.log("🚀 [AI-ROUTING] Selected: Gemini 1.5 Flash (Fast)");
  
  const model = getGeminiFlashModel();
  const startTime = Date.now();

  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] }
      ]
    }, { signal });

    const response = result.response.text().trim();
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ [AI-RESPONSE] Gemini Flash responded in ${elapsed}ms (${response.length} chars)`);
    return response;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [AI-ERROR] Gemini Flash failed after ${elapsed}ms: ${error.message}`);
    throw error;
  }
}

async function callGeminiPro(prompt, systemPrompt, signal) {
  console.log("🔍 [AI-ROUTING] Selected: Gemini 1.5 Pro (Complex)");
  
  const model = getGeminiProModel();
  const startTime = Date.now();

  try {
    const result = await model.generateContent({
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n\n" + prompt }] }
      ]
    }, { signal });

    const response = result.response.text().trim();
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ [AI-RESPONSE] Gemini Pro responded in ${elapsed}ms (${response.length} chars)`);
    return response;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [AI-ERROR] Gemini Pro failed after ${elapsed}ms: ${error.message}`);
    throw error;
  }
}

async function callGroq(prompt, systemPrompt, signal) {
  console.log("⚡ [AI-ROUTING] Selected: Groq Llama 3.3 70B (Fallback)");
  
  const startTime = Date.now();

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      max_tokens: 350,
      temperature: 0.75,
      top_p: 0.9
    }, { signal });

    const content = response.choices[0].message.content.trim();
    const elapsed = Date.now() - startTime;
    
    console.log(`✅ [AI-RESPONSE] Groq responded in ${elapsed}ms (${content.length} chars)`);
    return content;
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [AI-ERROR] Groq failed after ${elapsed}ms: ${error.message}`);
    throw error;
  }
}

async function routeRequest(text, memoryContext = "", documentContent = null, signal = null) {
  const startTime = Date.now();
  const intent = classifyIntent(text);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧠 [INTENT-CLASSIFICATION]`);
  console.log(`   Type: ${intent.type} | Complexity: ${intent.complexity}`);
  console.log(`   Query: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
  console.log(`${'='.repeat(70)}`);

  try {
    // Check cache
    const cacheKey = getCacheKey(text, memoryContext, !!documentContent);
    const cachedResponse = getCachedResponse(cacheKey);
    
    if (cachedResponse) {
      const elapsed = Date.now() - startTime;
      console.log(`⚡ [PERFORMANCE] Cache hit - Total time: ${elapsed}ms\n`);
      return cachedResponse;
    }

    const compactMemory = buildMemoryContext(memoryContext);
    const systemPrompt = getSystemPrompt(intent, !!compactMemory, !!documentContent);
    
    let response;
    let finalPrompt;
    let aiModel = "Unknown";

    // Document queries
    if (documentContent && (intent.type === "document" || /document|pdf|file/i.test(text))) {
      console.log("📄 [DOCUMENT-MODE] Detected - Using extended context");
      
      finalPrompt = `${compactMemory ? 'Context: ' + compactMemory + '\n\n' : ''}Document content (first 3000 chars):
${documentContent.substring(0, 3000)}

Question: ${text}

Provide a structured response (80-120 words, 5-8 sentences) with specific facts from the document.`;
      
      try {
        response = await callGeminiPro(finalPrompt, systemPrompt, signal);
        aiModel = "Gemini 1.5 Pro";
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.log("⚠️ [FALLBACK] Gemini Pro failed, trying Groq");
        response = await callGroq(finalPrompt, systemPrompt, signal);
        aiModel = "Groq Llama 3.3 70B";
      }
    }
    // Greetings
    else if (intent.type === "greeting") {
      finalPrompt = `${compactMemory ? 'Context: ' + compactMemory + '\n\n' : ''}User: ${text}

Respond warmly in 20-40 words (2-3 sentences).`;
      
      try {
        response = await callGeminiFlash(finalPrompt, systemPrompt, signal);
        aiModel = "Gemini 1.5 Flash";
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.log("⚠️ [FALLBACK] Gemini Flash failed, trying Groq");
        response = await callGroq(finalPrompt, systemPrompt, signal);
        aiModel = "Groq Llama 3.3 70B";
      }
    }
    // Simple queries
    else if (intent.complexity === "simple") {
      finalPrompt = `${compactMemory ? 'Context: ' + compactMemory + '\n\n' : ''}User: ${text}

Answer clearly in 40-70 words (3-4 sentences).`;
      
      try {
        response = await callGeminiFlash(finalPrompt, systemPrompt, signal);
        aiModel = "Gemini 1.5 Flash";
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.log("⚠️ [FALLBACK] Gemini Flash failed, trying Groq");
        response = await callGroq(finalPrompt, systemPrompt, signal);
        aiModel = "Groq Llama 3.3 70B";
      }
    }
    // Medium queries
    else if (intent.complexity === "medium") {
      finalPrompt = `${compactMemory ? 'Context: ' + compactMemory + '\n\n' : ''}User: ${text}

Provide a helpful response in 70-110 words (5-7 sentences).`;
      
      try {
        response = await callGeminiPro(finalPrompt, systemPrompt, signal);
        aiModel = "Gemini 1.5 Pro";
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.log("⚠️ [FALLBACK] Gemini Pro failed, trying Groq");
        response = await callGroq(finalPrompt, systemPrompt, signal);
        aiModel = "Groq Llama 3.3 70B";
      }
    }
    // Complex queries
    else {
      finalPrompt = `${compactMemory ? 'Context: ' + compactMemory + '\n\n' : ''}User: ${text}

Provide a thorough, well-structured response in 120-180 words (8-12 sentences). Use clear transitions and organize information logically.`;
      
      try {
        response = await callGeminiPro(finalPrompt, systemPrompt, signal);
        aiModel = "Gemini 1.5 Pro";
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.log("⚠️ [FALLBACK] Gemini Pro failed, trying Groq");
        response = await callGroq(finalPrompt, systemPrompt, signal);
        aiModel = "Groq Llama 3.3 70B";
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ [PERFORMANCE] Total processing time: ${elapsed}ms`);
    console.log(`📊 [STATS] Model: ${aiModel} | Response: ${response.length} chars | ${response.split(' ').length} words`);
    console.log(`${'='.repeat(70)}\n`);
    
    const cleanResponse = response.replace(/^Gyaanchand:\s*/i, "").trim();
    
    // Cache response
    setCachedResponse(cacheKey, cleanResponse);
    
    return cleanResponse;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("⛔ [INTERRUPT] Request aborted by user\n");
      throw error;
    }
    
    const elapsed = Date.now() - startTime;
    console.error(`❌ [CRITICAL-ERROR] All AI models failed after ${elapsed}ms: ${error.message}\n`);
    return "I'm having trouble processing that right now. Could you try asking again?";
  }
}

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      responseCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 [CACHE-CLEANUP] Removed ${cleaned} expired entries | Current size: ${responseCache.size}`);
  }
}, 60000);

module.exports = routeRequest;