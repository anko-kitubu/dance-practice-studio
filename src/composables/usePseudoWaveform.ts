import { ref } from "vue";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const ATTACK_SMOOTHING = 0.28;
const RELEASE_SMOOTHING = 0.1;
const MIN_BARS = 8;
const TAU = Math.PI * 2;

function createMicroPhase(index: number) {
  return ((index + 1) * 0.81) % TAU;
}

function createSignature(index: number, count: number) {
  const normalized = count <= 1 ? 0 : index / (count - 1);
  const distanceFromCenter = Math.abs(normalized * 2 - 1);
  const centerWeight = 1 - Math.pow(distanceFromCenter, 1.35) * 0.95;
  const floor = 0.08;
  return clamp(centerWeight, floor, 1);
}

function isSpikeCandidate(index: number, count: number) {
  const centerIndex = Math.floor((count - 1) * 0.5);
  if (Math.abs(index - centerIndex) <= 1) return true;
  return index % 11 === 0 || index % 17 === 0;
}

// 疑似波形の駆動状態を管理し、スペクトラムバー強度を生成する。
export function usePseudoWaveform() {
  const energyRef = ref(0);

  let isPlaying = false;
  let playbackRate = 1;
  let motionEnergy = 0;
  let clock = 0;
  let envelopeLevel = 0;
  let rafId: number | null = null;
  let lastTickAt = 0;
  let barLevels: number[] = [];
  let signature: number[] = [];
  let spikeMask: boolean[] = [];
  let microPhase: number[] = [];
  let microSpeed: number[] = [];

  function ensureBands(count: number) {
    if (barLevels.length === count) return;

    barLevels = new Array(count).fill(0);
    signature = new Array(count).fill(0);
    spikeMask = new Array(count).fill(false);
    microPhase = new Array(count).fill(0);
    microSpeed = new Array(count).fill(0);

    for (let index = 0; index < count; index += 1) {
      signature[index] = createSignature(index, count);
      spikeMask[index] = isSpikeCandidate(index, count);
      microPhase[index] = createMicroPhase(index);
      microSpeed[index] = 0.72 + (index % 9) * 0.07;
    }
  }

  function getMotionBoost() {
    return Math.pow(clamp(motionEnergy, 0, 1), 0.85);
  }

  function updateEnvelope() {
    if (!isPlaying) {
      envelopeLevel = 0;
      energyRef.value = 0;
      return;
    }

    const motionBoost = getMotionBoost();
    const pulse = 0.18 + Math.sin(clock * 2.2) * 0.06 + Math.sin(clock * 5.1) * 0.04;
    const targetEnvelope = clamp(0.22 + pulse + motionBoost * 0.24, 0, 1);
    const smoothing = targetEnvelope > envelopeLevel ? ATTACK_SMOOTHING : RELEASE_SMOOTHING;
    envelopeLevel += (targetEnvelope - envelopeLevel) * smoothing;
    energyRef.value = clamp(envelopeLevel * 0.72 + motionBoost * 0.68, 0, 1);
  }

  function tick(timestamp: number) {
    if (!lastTickAt) {
      lastTickAt = timestamp;
    }

    const dt = Math.min((timestamp - lastTickAt) / 1000, 0.1);
    lastTickAt = timestamp;
    if (isPlaying) {
      clock += dt * (1.2 + clamp(playbackRate, 0.25, 2) * 0.9);
      updateEnvelope();
    } else {
      envelopeLevel = 0;
      energyRef.value = 0;
    }

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
    clock = 0;
    envelopeLevel = 0;
    energyRef.value = 0;
    barLevels = [];
    signature = [];
    spikeMask = [];
    microPhase = [];
    microSpeed = [];
  }

  // 描画側が参照する制御値を更新する。
  function setState(state: {
    playing: boolean;
    rate: number;
    motion: number;
  }) {
    isPlaying = state.playing;
    playbackRate = clamp(Number(state.rate) || 1, 0.25, 2);
    motionEnergy = clamp(Number(state.motion) || 0, 0, 1);
  }

  // 現在状態から中央固定スペクトラムバー強度を返す。
  function getBarLevels(barCount: number): number[] {
    const safeCount = Math.max(MIN_BARS, Math.floor(barCount));
    ensureBands(safeCount);

    if (!isPlaying) {
      for (let index = 0; index < safeCount; index += 1) {
        barLevels[index] = 0;
      }
      return barLevels;
    }

    const motionBoost = getMotionBoost();
    const envelope = clamp(envelopeLevel, 0, 1);

    for (let index = 0; index < safeCount; index += 1) {
      const base = envelope * signature[index];
      const micro = 0.85 + Math.sin(clock * microSpeed[index] + microPhase[index]) * 0.15;
      const motion = motionBoost * (spikeMask[index] ? 0.95 : 0.55);
      const spikeAccent = spikeMask[index]
        ? (0.5 + Math.sin(clock * (microSpeed[index] * 1.8) + microPhase[index] * 1.31) * 0.5) *
          envelope *
          0.28
        : 0;
      const target = clamp(base * micro + motion + spikeAccent, 0, 1);
      const smooth = target > barLevels[index] ? ATTACK_SMOOTHING : RELEASE_SMOOTHING;
      barLevels[index] += (target - barLevels[index]) * smooth;
    }

    return barLevels;
  }

  return {
    energyRef,
    start,
    stop,
    setState,
    getBarLevels
  };
}
