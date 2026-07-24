class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      this.port.postMessage(new Float32Array(channel));
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
