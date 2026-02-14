<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePseudoWaveform } from "../composables/usePseudoWaveform.ts";

type Props = {
  enabled: boolean;
  isPlaying: boolean;
  playbackRate: number;
  motionEnergy: number;
  sensitivity: number;
  focusMode?: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  focusMode: false
});

const canvasEl = ref<HTMLCanvasElement | null>(null);
const pseudoWave = usePseudoWaveform();

let renderRafId: number | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// propsから疑似波形生成ロジックへ入力値を同期する。
function syncWaveState() {
  pseudoWave.setState({
    playing: props.enabled && props.isPlaying,
    rate: props.playbackRate,
    motion: props.enabled ? props.motionEnergy : 0,
    sensitivity: props.sensitivity
  });
}

// Canvasの表示サイズと内部解像度を揃える。
function resizeCanvas() {
  const canvas = canvasEl.value;
  if (!canvas) return;

  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const pixelRatio = window.devicePixelRatio || 1;

  const internalWidth = Math.floor(width * pixelRatio);
  const internalHeight = Math.floor(height * pixelRatio);
  if (canvas.width !== internalWidth || canvas.height !== internalHeight) {
    canvas.width = internalWidth;
    canvas.height = internalHeight;
  }
}

// 中央の基準線を描画する。
function drawBaseline(ctx: CanvasRenderingContext2D, width: number, midY: number) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(154, 164, 178, 0.24)";
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

// 疑似波形を描画する。
function drawWave(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const points = pseudoWave.getWavePoints(Math.max(48, Math.floor(width / 5)));
  const motion = clamp(props.motionEnergy, 0, 1);
  const midY = height / 2;
  const amplitudePx = height * (0.26 + motion * 0.18);

  drawBaseline(ctx, width, midY);

  if (!props.enabled) {
    return;
  }

  ctx.beginPath();
  points.forEach((value, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
    const y = midY - value * amplitudePx;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  const glow = 10 + motion * 22;
  ctx.shadowBlur = glow;
  ctx.shadowColor = `rgba(225, 81, 59, ${0.38 + motion * 0.4})`;
  ctx.lineWidth = 2 + motion * 2.4;
  ctx.strokeStyle = `rgba(240, 106, 79, ${0.82 + motion * 0.14})`;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// 1フレーム分の背景と波形を再描画する。
function renderFrame() {
  const canvas = canvasEl.value;
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const pixelRatio = window.devicePixelRatio || 1;
  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(14, 20, 28, 0.95)");
  gradient.addColorStop(1, "rgba(8, 12, 18, 0.92)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawWave(ctx, width, height);
}

// 描画ループを継続実行する。
function renderLoop() {
  syncWaveState();
  renderFrame();
  renderRafId = window.requestAnimationFrame(renderLoop);
}

onMounted(() => {
  resizeCanvas();
  pseudoWave.start();
  renderLoop();
  window.addEventListener("resize", resizeCanvas);
});

onBeforeUnmount(() => {
  if (renderRafId !== null) {
    window.cancelAnimationFrame(renderRafId);
    renderRafId = null;
  }
  pseudoWave.stop();
  window.removeEventListener("resize", resizeCanvas);
});

watch(
  () => [props.enabled, props.isPlaying, props.playbackRate, props.motionEnergy, props.sensitivity],
  () => {
    syncWaveState();
  },
  { immediate: true }
);
</script>

<template>
  <div class="waveform-shell" :class="{ 'is-focus': focusMode, 'is-disabled': !enabled }">
    <canvas ref="canvasEl" class="waveform-canvas"></canvas>
    <span class="waveform-label">Pseudo Wave</span>
  </div>
</template>

<style scoped>
.waveform-shell {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 14px;
  border: 1px solid rgba(42, 52, 68, 0.9);
  overflow: hidden;
}

.waveform-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.waveform-label {
  position: absolute;
  top: 8px;
  left: 12px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(154, 164, 178, 0.9);
  pointer-events: none;
}

.waveform-shell.is-focus {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}

.waveform-shell.is-disabled .waveform-label {
  opacity: 0.6;
}
</style>
