// audio-processor.js - Modern AudioWorklet processor for PCM conversion
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkCount = 0;
  }

  // Convert Float32 to Int16 PCM
  float32ToInt16(float32Array) {
    const int16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp value between -1 and 1
      let val = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit PCM
      int16[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
    }
    return int16;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const channelData = input[0];
      
      if (channelData && channelData.length > 0) {
        // Convert to Int16 PCM
        const pcmData = this.float32ToInt16(channelData);
        
        // Calculate amplitude for debugging
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += Math.abs(channelData[i]);
        }
        const avgAmplitude = sum / channelData.length;
        
        // Send audio data to main thread
        this.port.postMessage({
          audio: pcmData.buffer,
          amplitude: avgAmplitude,
          samples: channelData.length,
          chunkCount: this.chunkCount
        }, [pcmData.buffer]);
        
        this.chunkCount++;
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor', AudioProcessor);