export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export class LiveAudio {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private workletLoaded = false;
  private scheduled: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private captureBuffer = new Float32Array(1600);
  private captureOffset = 0;
  private captureSumSquares = 0;

  async prepare() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    if (this.context.state !== "running") {
      throw new Error(
        "Browser audio is paused. Click Start interview again to enable the microphone and speaker.",
      );
    }
    if (!this.workletLoaded) {
      await this.context.audioWorklet.addModule("/pcm-processor.js");
      this.workletLoaded = true;
    }
    return this.context;
  }

  async startCapture(
    onPcm: (pcm: ArrayBuffer) => void,
    onLevel?: (level: number) => void,
  ) {
    const context = await this.prepare();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const source = context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(context, "pcm-processor");
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const downsampled = this.downsample(event.data, context.sampleRate, 16000);
      for (const sample of downsampled) {
        this.captureSumSquares += sample * sample;
        this.captureBuffer[this.captureOffset] = sample;
        this.captureOffset += 1;
        if (this.captureOffset === this.captureBuffer.length) {
          onLevel?.(
            Math.min(
              1,
              Math.sqrt(this.captureSumSquares / this.captureBuffer.length) * 5,
            ),
          );
          onPcm(this.floatToInt16(this.captureBuffer));
          this.captureBuffer = new Float32Array(1600);
          this.captureOffset = 0;
          this.captureSumSquares = 0;
        }
      }
    };
    const silence = context.createGain();
    silence.gain.value = 0;
    source.connect(this.worklet);
    this.worklet.connect(silence);
    silence.connect(context.destination);
  }

  stopCapture() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.worklet?.disconnect();
    this.worklet = null;
    this.captureBuffer = new Float32Array(1600);
    this.captureOffset = 0;
    this.captureSumSquares = 0;
  }

  async playBase64Pcm(base64: string, mimeType = "audio/pcm;rate=24000") {
    const context = await this.prepare();
    const pcm = new Int16Array(base64ToArrayBuffer(base64));
    if (!pcm.length) return;
    const floats = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1) {
      floats[index] = pcm[index] / 32768;
    }
    const sampleRateMatch = /rate=(\d+)/i.exec(mimeType);
    const sampleRate = Number(sampleRateMatch?.[1] ?? 24000);
    const buffer = context.createBuffer(
      1,
      floats.length,
      Number.isFinite(sampleRate) ? sampleRate : 24000,
    );
    buffer.getChannelData(0).set(floats);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.nextStartTime = Math.max(context.currentTime, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.scheduled.push(source);
    source.onended = () => {
      this.scheduled = this.scheduled.filter((item) => item !== source);
    };
  }

  stopPlayback() {
    for (const source of this.scheduled) {
      try {
        source.stop();
      } catch {
        // A source may already have ended.
      }
    }
    this.scheduled = [];
    if (this.context) this.nextStartTime = this.context.currentTime;
  }

  close() {
    this.stopCapture();
    this.stopPlayback();
    void this.context?.close();
    this.context = null;
    this.workletLoaded = false;
  }

  private downsample(input: Float32Array, inputRate: number, outputRate: number) {
    if (inputRate === outputRate) return input;
    const ratio = inputRate / outputRate;
    const output = new Float32Array(Math.round(input.length / ratio));
    let inputOffset = 0;
    for (let outputOffset = 0; outputOffset < output.length; outputOffset += 1) {
      const nextInputOffset = Math.round((outputOffset + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (
        let index = inputOffset;
        index < nextInputOffset && index < input.length;
        index += 1
      ) {
        sum += input[index];
        count += 1;
      }
      output[outputOffset] = count ? sum / count : 0;
      inputOffset = nextInputOffset;
    }
    return output;
  }

  private floatToInt16(input: Float32Array) {
    const output = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      output[index] = Math.max(-1, Math.min(1, input[index])) * 0x7fff;
    }
    return output.buffer;
  }
}
