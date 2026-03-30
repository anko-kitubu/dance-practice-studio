<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePseudoWaveform } from "../composables/usePseudoWaveform.ts";

type Props = {
  enabled: boolean;
  isPlaying: boolean;
  playbackRate: number;
  motionEnergy: number;
  focusMode?: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  focusMode: false
});

const canvasEl = ref<HTMLCanvasElement | null>(null);
const pseudoWave = usePseudoWaveform();

let renderRafId: number | null = null;
let renderLoopActive = false;
const BAR_COUNT = 56;
const BAR_GAP = 2;
const MIN_HALF_HEIGHT = 1.2;
const MAX_HALF_RATIO = 0.38;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function shouldAnimate() {
  return props.enabled && props.isPlaying;
}

// propsから疑似波形生成ロジックへ入力値を同期する。
function syncWaveState() {
  pseudoWave.setState({
    playing: props.enabled && props.isPlaying,
    rate: props.playbackRate,
    motion: props.enabled ? props.motionEnergy : 0
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
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

// 中央固定の白発光スペクトラムバーを上下対称で描画する。
function drawSpectrumBars(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const levels = pseudoWave.getBarLevels(BAR_COUNT);
  const motion = clamp(props.motionEnergy, 0, 1);
  const midY = height / 2;
  const totalGap = BAR_GAP * (BAR_COUNT - 1);
  const slotWidth = Math.max(1, (width - totalGap) / BAR_COUNT);
  const usedWidth = slotWidth * BAR_COUNT + totalGap;
  const startX = (width - usedWidth) * 0.5;
  const maxHalf = height * MAX_HALF_RATIO;
  const baseLineWidth = Math.max(1.1, Math.min(2.6, slotWidth * 0.45));

  drawBaseline(ctx, width, midY);

  if (!props.enabled) {
    return;
  }

  type BarSegment = {
    x: number;
    top: number;
    bottom: number;
    alpha: number;
  };

  const segments: BarSegment[] = [];
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const level = clamp(levels[index] ?? 0, 0, 1);
    const halfHeight = MIN_HALF_HEIGHT + level * maxHalf;
    const x = startX + index * (slotWidth + BAR_GAP) + slotWidth * 0.5;
    const alpha = 0.2 + level * 0.8;
    segments.push({
      x,
      top: midY - halfHeight,
      bottom: midY + halfHeight,
      alpha
    });
  }

  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(255, 255, 255, 0.95)";
  ctx.shadowBlur = 12 + motion * 24;
  for (const segment of segments) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + segment.alpha * 0.36})`;
    ctx.lineWidth = baseLineWidth + 2.6;
    ctx.beginPath();
    ctx.moveTo(segment.x, segment.top);
    ctx.lineTo(segment.x, segment.bottom);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  for (const segment of segments) {
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.38 + segment.alpha * 0.56})`;
    ctx.lineWidth = baseLineWidth;
    ctx.beginPath();
    ctx.moveTo(segment.x, segment.top);
    ctx.lineTo(segment.x, segment.bottom);
    ctx.stroke();
  }
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
  const midY = height * 0.5;

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const centerGlow = ctx.createRadialGradient(width * 0.5, midY, 0, width * 0.5, midY, height * 0.85);
  centerGlow.addColorStop(0, "rgba(255, 255, 255, 0.06)");
  centerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, width, height);

  drawSpectrumBars(ctx, width, height);
}

// 描画ループを継続実行する。
function renderLoop() {
  if (!renderLoopActive) {
    renderRafId = null;
    return;
  }
  syncWaveState();
  renderFrame();
  renderRafId = window.requestAnimationFrame(renderLoop);
}

function startRenderLoop() {
  if (renderLoopActive) return;
  renderLoopActive = true;
  pseudoWave.start();
  renderLoop();
}

function stopRenderLoop() {
  renderLoopActive = false;
  if (renderRafId !== null) {
    window.cancelAnimationFrame(renderRafId);
    renderRafId = null;
  }
}

function stopWaveAnimation() {
  stopRenderLoop();
  pseudoWave.stop();
}

function updateAnimationState() {
  syncWaveState();
  if (shouldAnimate()) {
    startRenderLoop();
    return;
  }
  stopWaveAnimation();
  renderFrame();
}

function handleResize() {
  resizeCanvas();
  renderFrame();
}

onMounted(() => {
  resizeCanvas();
  syncWaveState();
  renderFrame();
  if (shouldAnimate()) {
    startRenderLoop();
  }
  window.addEventListener("resize", handleResize);
});

onBeforeUnmount(() => {
  stopWaveAnimation();
  window.removeEventListener("resize", handleResize);
});

watch(
  () => [props.enabled, props.isPlaying],
  () => {
    updateAnimationState();
  }
);
</script>

<template>
  <div class="waveform-shell" :class="{ 'is-focus': focusMode, 'is-disabled': !enabled }">
    <canvas ref="canvasEl" class="waveform-canvas"></canvas>
    <span class="waveform-label">Pseudo Spectrum</span>
  </div>
</template>

<style scoped>
.waveform-shell {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  background: #000;
}

.waveform-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.waveform-label {
  position: absolute;
  right: 10px;
  bottom: 6px;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
  pointer-events: none;
}

.waveform-shell.is-focus {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}

.waveform-shell.is-disabled .waveform-label {
  opacity: 0.45;
}
</style>
