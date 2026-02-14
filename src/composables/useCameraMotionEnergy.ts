import { ref } from "vue";

const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 54;
const SAMPLE_INTERVAL_MS = 1000 / 20;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// カメラ映像のフレーム差分から動き量(0..1)を推定する。
export function useCameraMotionEnergy() {
  const energyRef = ref(0);

  let rafId: number | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let sampleCanvas: HTMLCanvasElement | null = null;
  let sampleContext: CanvasRenderingContext2D | null = null;
  let previousLuma: Uint8Array | null = null;
  let latestLuma: Uint8Array | null = null;
  let lastSampleAt = 0;

  function ensureSamplingContext() {
    if (!sampleCanvas) {
      sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = SAMPLE_WIDTH;
      sampleCanvas.height = SAMPLE_HEIGHT;
    }
    if (!sampleContext) {
      sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!previousLuma) {
      previousLuma = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    }
    if (!latestLuma) {
      latestLuma = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT);
    }
  }

  function sampleFrame() {
    if (!videoEl || !sampleContext || !latestLuma) return false;
    if (videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;

    sampleContext.drawImage(videoEl, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

    const imageData = sampleContext.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const pixels = imageData.data;
    for (let srcIndex = 0, dstIndex = 0; srcIndex < pixels.length; srcIndex += 4, dstIndex += 1) {
      // ITU-R BT.601 近似で輝度へ変換する。
      latestLuma[dstIndex] = (pixels[srcIndex] * 77 + pixels[srcIndex + 1] * 150 + pixels[srcIndex + 2] * 29) >> 8;
    }
    return true;
  }

  function updateEnergy() {
    if (!previousLuma || !latestLuma) return;

    let diffSum = 0;
    let activePixels = 0;
    const stride = 2;
    const sampleCount = Math.floor(latestLuma.length / stride);

    for (let index = 0; index < latestLuma.length; index += stride) {
      const diff = Math.abs(latestLuma[index] - previousLuma[index]);
      diffSum += diff;
      if (diff > 18) {
        activePixels += 1;
      }
    }

    previousLuma.set(latestLuma);

    const averageDiff = sampleCount > 0 ? diffSum / sampleCount / 255 : 0;
    const activeRatio = sampleCount > 0 ? activePixels / sampleCount : 0;
    const rawEnergy = clamp(averageDiff * 2.8 + activeRatio * 1.3, 0, 1);
    const smoothing = rawEnergy > energyRef.value ? 0.28 : 0.12;
    energyRef.value += (rawEnergy - energyRef.value) * smoothing;
  }

  function loop(timestamp: number) {
    if (!videoEl) return;

    if (!lastSampleAt) {
      lastSampleAt = timestamp;
    }

    if (timestamp - lastSampleAt >= SAMPLE_INTERVAL_MS) {
      lastSampleAt = timestamp;
      try {
        if (sampleFrame()) {
          updateEnergy();
        } else {
          energyRef.value *= 0.92;
        }
      } catch {
        // フレーム読取りが失敗した場合は滑らかに減衰させる。
        energyRef.value *= 0.9;
      }
    }

    rafId = window.requestAnimationFrame(loop);
  }

  // 指定したvideo要素を入力として動き推定ループを開始する。
  function start(target: HTMLVideoElement) {
    stop();
    videoEl = target;
    ensureSamplingContext();
    lastSampleAt = 0;
    rafId = window.requestAnimationFrame(loop);
  }

  // 推定ループと内部バッファを停止/破棄する。
  function stop() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    videoEl = null;
    previousLuma = null;
    latestLuma = null;
    sampleContext = null;
    sampleCanvas = null;
    lastSampleAt = 0;
    energyRef.value = 0;
  }

  return {
    energyRef,
    start,
    stop
  };
}
