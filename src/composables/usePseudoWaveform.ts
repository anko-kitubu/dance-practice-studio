import { ref } from "vue";

type WavePoint = number;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// 疑似波形の位相と振幅を管理し、描画用サンプルを生成する。
export function usePseudoWaveform() {
  const energyRef = ref(0);

  let isPlaying = false;
  let playbackRate = 1;
  let motionEnergy = 0;
  let sensitivity = 1;
  let phase = 0;
  let rafId: number | null = null;
  let lastTickAt = 0;

  function tick(timestamp: number) {
    if (!lastTickAt) {
      lastTickAt = timestamp;
    }

    const dt = Math.min((timestamp - lastTickAt) / 1000, 0.1);
    lastTickAt = timestamp;

    const targetEnergy = isPlaying ? clamp(0.35 + motionEnergy * 0.65, 0, 1) : 0;
    const smoothing = targetEnergy > energyRef.value ? 0.22 : 0.1;
    energyRef.value += (targetEnergy - energyRef.value) * smoothing;

    const speed = isPlaying ? 1 + playbackRate * 1.8 + motionEnergy * 1.6 : 0.35;
    phase += dt * speed * Math.PI;

    rafId = window.requestAnimationFrame(tick);
  }

  // 疑似波形の内部更新ループを開始する。
  function start() {
    if (rafId !== null) return;
    lastTickAt = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  // 疑似波形の内部更新ループを停止し、状態を初期化する。
  function stop() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTickAt = 0;
    energyRef.value = 0;
    phase = 0;
  }

  // 描画側が参照する制御値を更新する。
  function setState(state: {
    playing: boolean;
    rate: number;
    motion: number;
    sensitivity: number;
  }) {
    isPlaying = state.playing;
    playbackRate = clamp(Number(state.rate) || 1, 0.25, 2);
    motionEnergy = clamp(Number(state.motion) || 0, 0, 1);
    sensitivity = clamp(Number(state.sensitivity) || 1, 0.5, 1.5);
  }

  // 現在状態から疑似波形サンプルを返す。
  function getWavePoints(sampleCount: number): WavePoint[] {
    const points: WavePoint[] = [];
    const safeCount = Math.max(8, Math.floor(sampleCount));
    const amplitude = clamp((0.16 + energyRef.value * 0.72) * sensitivity, 0, 1);

    for (let index = 0; index < safeCount; index += 1) {
      const x = safeCount === 1 ? 0 : index / (safeCount - 1);
      const harmonicA = Math.sin(x * 10 + phase) * 0.56;
      const harmonicB = Math.sin(x * 24 + phase * 1.8) * 0.28;
      const harmonicC = Math.sin(x * 42 + phase * 2.5) * 0.16;
      const ripple = Math.sin(x * 78 + phase * 4.2) * (0.04 + energyRef.value * 0.1);
      const value = clamp((harmonicA + harmonicB + harmonicC + ripple) * amplitude, -1, 1);
      points.push(value);
    }

    return points;
  }

  return {
    energyRef,
    start,
    stop,
    setState,
    getWavePoints
  };
}
