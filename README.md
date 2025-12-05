# 🎙️ Gyaanchand Voice AI

**A  intelligent voice assistant powered by Murf Falcon**

Created by **Umer Zingu**

##🎥 Demo Video

This demo shows the full real-time pipeline in action:

👉 Watch here:
https://drive.google.com/drive/folders/1k3DuqfJZYQ6CRQcCfz2mnCF2UwGsQOjb?usp=drive_link

🔍 What the video demonstrates

1.Live microphone capture

2.Real-time transcription (Deepgram Nova-2)

3.Model routing (Gemini Flash / Groq)

4.Fast TTS streaming (Murf AI Falcon)

5.AI interruption handling

6.UI status indicators updating live

7.Weather + document query examples

---

## ✨ Features

### 🎯 Core Capabilities
- **Real-time Voice Recognition** - Powered by Deepgram Nova-2 for crystal-clear transcription
- **Ultra-Fast Speech Synthesis** - Using **Murf AI: The Fastest, Most Efficient Text-to-Speech API for Building Voice Agents**
- **Intelligent AI Routing** - Automatically selects the best AI model (Gemini 1.5 or Groq Llama 3.3) based on query complexity
- **Document Analysis** - Upload PDFs and DOCX files for AI-powered Q&A
- **Real-time Weather** - Live weather data integration with OpenWeather API
- **Conversation Memory** - Remembers your name, location, and conversation context
- **9 Natural Voices** - Choose from a variety of US and British English voices
- **Smart Interruptions** - Naturally interrupt the AI mid-response
- **Streaming Audio** - Audio starts playing before the full response is generated

### 🚀 Technical Highlights
- **WebSocket Architecture** - Real-time bidirectional communication
- **Optimized Response Times** - Sub-second latency for simple queries
- **Session Management** - Persistent user sessions with automatic cleanup
- **Document Upload** - Supports PDF and DOCX with intelligent parsing
- **Adaptive Chunking** - Smart text-to-speech chunking for natural delivery
- **Error Recovery** - Automatic fallback between AI models
- **Responsive UI** - Beautiful gradient interface with live status indicators

---

## 🎨 Demo

```
User: "What's the weather in Pune?"
Gyaanchand: "Currently in Pune, India, it's pleasant at 24°C. 
             The weather is partly cloudy with gentle winds..."
```

---

## 📦 Tech Stack

### Voice & Speech
- **ASR**: [Deepgram Nova-2](https://deepgram.com/) - Best-in-class speech recognition with 98%+ accuracy
- **TTS**: [**Murf AI**](https://murf.ai/) - **The Fastest, Most Efficient Text-to-Speech API for Building Voice Agents**
  - Sub-second latency
  - Natural, human-like voices
  - Perfect pronunciation and prosody
  - Streaming audio support

### AI Intelligence
- **Google Gemini 1.5** (Flash & Pro) - Advanced reasoning and document understanding
- **Groq Llama 3.3 70B** - Ultra-fast inference for quick responses

### Infrastructure
- **Node.js** - Backend runtime
- **Express** - Web server
- **WebSocket (ws)** - Real-time communication
- **Multer** - File upload handling
- **Mammoth & PDF-Parse** - Document processing

### APIs
- **OpenWeather API** - Real-time weather data
- **Google Generative AI** - Gemini models
- **Groq SDK** - Llama 3.3 access

---

## 🛠️ Installation

### Prerequisites
- Node.js 16+ and npm
- API keys for:
  - Deepgram
  - Murf AI
  - Google Gemini
  - Groq
  - OpenWeather (optional)

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/gyaanchand-voice-ai.git
cd gyaanchand-voice-ai
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create a `.env` file in the root directory:

```env
# Speech & Voice APIs
DEEPGRAM_API_KEY=your_deepgram_key_here
MURF_API_KEY=your_murf_key_here

# AI Models
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here

# Weather API
OPENWEATHER_API_KEY=your_openweather_key_here

# Server Configuration
PORT=5000
NODE_ENV=production
```

4. **Start the server**
```bash
npm start
```

5. **Open your browser**
Navigate to `http://localhost:5000`

---

## 📖 Usage Guide

### Basic Conversation
1. Click **"Start Live"** to begin
2. Speak naturally into your microphone
3. Gyaanchand will transcribe, process, and respond in real-time
4. Click **"Stop"** to end the session

### Voice Selection
Choose from 9 different voices:
- **Male US**: Terrell (default), Michael, Wayne, Ryan
- **Female US**: Natalie, Lily, Claire
- **British**: William, Emma

### Document Upload
1. Click **"Choose File"** or drag & drop
2. Upload a PDF or DOCX document
3. Ask questions about the document
4. Example: *"Can you summarize the document?"*

### Weather Queries
- *"What's the weather?"* - Uses your saved location or default
- *"Weather in London"* - Gets weather for specific city
- *"Tell me the forecast"* - Future weather information

### Memory Features
Gyaanchand remembers:
- **Your name**: "My name is Sarah"
- **Your location**: Automatically extracted from weather queries
- **Current date**: Always aware of today's date
- **Conversation history**: Last 3-4 exchanges for context

---

## 🏗️ Architecture

### Frontend (`index.html` + `app.js`)
```
┌─────────────────────────────────────┐
│         User Interface              │
│  ┌────────────────────────────┐    │
│  │   Microphone Input         │    │
│  │   WebSocket Connection     │    │
│  │   Audio Playback Queue     │    │
│  │   Real-time Transcripts    │    │
│  └────────────────────────────┘    │
└─────────────────────────────────────┘
                 ↕️
         WebSocket (Binary + JSON)
                 ↕️
```

### Backend (`server-enhanced.js`)
```
┌─────────────────────────────────────┐
│         WebSocket Server            │
│  ┌────────────────────────────┐    │
│  │   Session Management       │    │
│  │   Memory Context           │    │
│  │   Deepgram Connection      │    │
│  │   Document Storage         │    │
│  └────────────────────────────┘    │
└─────────────────────────────────────┘
                 ↕️
         AI Router & TTS Pipeline
                 ↕️
┌─────────────────────────────────────┐
│       External Services             │
│  ┌────────────────────────────┐    │
│  │   Deepgram API (ASR)       │    │
│  │   Murf AI (TTS)            │    │
│  │   Gemini / Groq (AI)       │    │
│  │   OpenWeather (Weather)    │    │
│  └────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Data Flow
1. **Audio Input** → Microphone → PCM conversion → WebSocket
2. **Speech Recognition** → Deepgram → Transcript
3. **AI Processing** → Router → Gemini/Groq → Response
4. **Speech Synthesis** → Murf AI → Audio chunks
5. **Audio Playback** → WebSocket → Queue → Speakers


[User voice] 
      │  (microphone via browser)
      ▼
[Deepgram ASR] ── live transcription ──▶  
      ▼  
[Gemini LLM if fallback Grok LLM] ── generates response text ──▶  
      ▼  
[Murf Falcon TTS] ── generates audio ──▶  
      ▼  
[Browser Audio Output] ── user hears reply


---

## 🎯 API Integrations

### Murf AI - Text-to-Speech
**Why Murf AI?**
- ⚡ **Fastest API Response**: Average 200-500ms per chunk
- 🎭 **Natural Voices**: 120+ AI voices in 20+ languages
- 🌊 **Streaming Support**: Start playback before full generation
- 🎛️ **Fine Control**: Adjust speed, pitch, and pauses
- 💰 **Cost Effective**: Best pricing for production use

```javascript
// Murf AI Configuration
{
  voice_id: "en-US-terrell",
  model: "FALCON",
  format: "MP3",
  sampleRate: 24000,
  channelType: "MONO",
  style: "Conversational"
}
```

### Deepgram - Speech Recognition
- Model: Nova-2
- Language: English (India)
- Real-time interim results
- Smart formatting and punctuation
- VAD (Voice Activity Detection)

### AI Routing Logic
```
Simple Queries (< 50 chars) → Gemini Flash (fastest)
Medium Queries → Gemini Flash with fallback to Groq
Complex Queries (> 100 chars) → Gemini Pro with fallback to Groq
Document Queries → Gemini Pro (best understanding)
Weather Queries → Gemini Flash + Weather API
```

---

## 📁 Project Structure

```
gyaanchand-voice-ai/
├── backend/
│   ├── server-enhanced.js      # Main WebSocket server
│   ├── intelligentRouter.js    # AI routing & weather integration
│   ├── ttsStreamSentences.js   # Murf AI TTS streaming
│   ├── weatherService.js       # OpenWeather API integration
│   └── googleAPIs.js           # (Optional) Gmail/Calendar
├── uploads/                     # Temporary document storage
├── index.html                   # Main UI
├── app.js                       # Frontend WebSocket logic
├── audio-processor.js           # AudioWorklet for PCM conversion
├── .env                         # Environment variables
├── .gitignore                   # Git ignore rules
├── package.json                 # Dependencies
├── vercel.json                  # Vercel deployment config
└── README.md                    # This file
```

---

## 🔧 Configuration

### Voice Settings
Adjust in `ttsStreamSentences.js`:
```javascript
const VOICE_CONFIGS = {
  'en-US-terrell': {
    id: 'en-US-terrell',
    style: 'Conversational',
    speed: 0,      // -50 to 50
    pitch: 0,      // -50 to 50
    variation: 1   // Voice variation
  }
}
```

### Memory Settings
Adjust in `server-enhanced.js`:
```javascript
memory: {
  userName: null,
  location: null,
  date: new Date().toLocaleDateString(),
  lastUserMessages: [],  // Max 4 messages
  lastBotMessages: []    // Max 4 messages
}
```

### Response Length
Adjust in `intelligentRouter.js`:
```javascript
// Greeting: 20-40 words
// Simple: 40-70 words
// Medium: 70-110 words
// Complex: 120-180 words
maxOutputTokens: 250
```

---

## 🐛 Troubleshooting

### Issue: Microphone not working
**Solution**: 
- Allow microphone permissions in browser
- Use HTTPS (required for production)
- Check browser console for errors

### Issue: No audio playback
**Solution**:
- Check Murf AI API key
- Verify WebSocket connection
- Look for TTS errors in server logs

### Issue: Slow responses
**Solution**:
- Check your internet connection
- Verify API quotas haven't been exceeded
- Consider upgrading to faster AI models

### Issue: Weather not working
**Solution**:
- Verify OpenWeather API key
- Check if location extraction is working
- Default location fallback is Pimpri, India

---

## 📊 Performance Benchmarks

| Operation | Average Time |
|-----------|-------------|
| Speech Recognition (Deepgram) | 50-150ms |
| AI Response (Groq) | 400-600ms |
| AI Response (Gemini Flash) | 300-500ms |
| TTS Generation (Murf AI) | 200-400ms per chunk |
| First Audio Playback | < 1 second |
| Total Round Trip | 1-2 seconds |

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

MIT License

Copyright (c) 2025 Umer Zingu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
---

## 🙏 Acknowledgments

- **Murf AI** - For providing the fastest and most efficient TTS API for voice agents
- **Deepgram** - For industry-leading speech recognition
- **Google** - For powerful Gemini AI models
- **Groq** - For ultra-fast Llama 3.3 inference
- **OpenWeather** - For comprehensive weather data

---

## 📧 Contact

**Umer Zingu**

Project Link: [https://github.com/yourusername/gyaanchand-voice-ai](https://github.com/yourusername/gyaanchand-voice-ai)

---

## 🌟 Powered By

<div align="center">

### Murf AI
**The Fastest, Most Efficient Text-to-Speech API for Building Voice Agents**

[Visit Murf AI →](https://murf.ai/)

</div>

---

<div align="center">

Made with ❤️ by Umer Zingu

⭐ Star this repo if you find it helpful!

</div>
