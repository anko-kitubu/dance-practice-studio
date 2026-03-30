<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import WaveformCanvas from "./components/WaveformCanvas.vue";
import {
  createYouTubePlayer,
  extractVideoId,
  type YouTubePlayer,
  type YouTubePlayerEvent
} from "./services/youtube.ts";
import { startCamera, stopCamera } from "./services/camera.ts";
import { useCameraMotionEnergy } from "./composables/useCameraMotionEnergy.ts";
import {
  loadHistory,
  loadPlaylists,
  loadState,
  saveHistory,
  savePlaylists,
  saveState,
  type HistoryItem,
  type Playlist
} from "./services/storage.ts";

type LayoutOption =
  | "split"
  | "splitReverse"
  | "cameraFloat"
  | "videoFloat"
  | "videoOnly"
  | "cameraOnly";

type WaveformMode = "pseudo";

type FloatRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type AppState = {
  videoId: string;
  lastInput: string;
  playbackRate: number;
  layout: LayoutOption;
  mirrorCamera: boolean;
  mirrorVideo: boolean;
  floatRect: FloatRect;
  waveformEnabled: boolean;
  motionTrackerEnabled: boolean;
  waveformMode: WaveformMode;
};

type SaveOptions = {
  skipSave?: boolean;
};

type HistoryCommitOptions = {
  keepOrder?: boolean;
  skipSave?: boolean;
};

type PanelTab = "history" | "playlists";

type DragState = {
  id: string;
  fromIndex: number;
  overIndex: number;
};

type FloatDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type FrameStyle = {
  width: string;
  height: string;
};

type PendingResumeState = {
  videoId: string;
  position: number;
};

const DEFAULT_FLOAT_RECT: FloatRect = {
  x: 24,
  y: 24,
  w: 360,
  h: 220
};

function isLayoutOption(value: unknown): value is LayoutOption {
  return (
    value === "split" ||
    value === "splitReverse" ||
    value === "cameraFloat" ||
    value === "videoFloat" ||
    value === "videoOnly" ||
    value === "cameraOnly"
  );
}

function isWaveformMode(value: unknown): value is WaveformMode {
  return value === "pseudo";
}

function normalizeFloatRect(value: unknown): FloatRect {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_FLOAT_RECT };
  }

  const raw = value as Record<string, unknown>;
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : DEFAULT_FLOAT_RECT.x;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : DEFAULT_FLOAT_RECT.y;
  const w = typeof raw.w === "number" && Number.isFinite(raw.w) ? raw.w : DEFAULT_FLOAT_RECT.w;
  const h = typeof raw.h === "number" && Number.isFinite(raw.h) ? raw.h : DEFAULT_FLOAT_RECT.h;
  return { x, y, w, h };
}

const DEFAULT_STATE: AppState = {
  videoId: "",
  lastInput: "",
  playbackRate: 1,
  layout: "split",
  mirrorCamera: true,
  mirrorVideo: false,
  floatRect: { ...DEFAULT_FLOAT_RECT },
  waveformEnabled: true,
  motionTrackerEnabled: true,
  waveformMode: "pseudo"
};

const stored = loadState<AppState>();
const state: AppState = {
  ...DEFAULT_STATE,
  ...stored,
  layout: isLayoutOption(stored.layout) ? stored.layout : DEFAULT_STATE.layout,
  floatRect: normalizeFloatRect(stored.floatRect),
  motionTrackerEnabled: typeof stored.motionTrackerEnabled === "boolean" ? stored.motionTrackerEnabled : DEFAULT_STATE.motionTrackerEnabled,
  waveformMode: isWaveformMode(stored.waveformMode) ? stored.waveformMode : DEFAULT_STATE.waveformMode
};

const ytUrl = ref<string>(state.lastInput || state.videoId);
const layout = ref<LayoutOption>(state.layout);
const mirrorCamera = ref<boolean>(state.mirrorCamera);
const mirrorVideo = ref<boolean>(state.mirrorVideo);
const selectedRate = ref<number>(state.playbackRate);
const waveformEnabled = ref<boolean>(state.waveformEnabled);
const motionTrackerEnabled = ref<boolean>(state.motionTrackerEnabled);
const waveformMode = ref<WaveformMode>(state.waveformMode);

const ytStatus = ref<string>("");
const cameraStatus = ref<string>("");
const timeLabel = ref<string>("0:00 / 0:00");
const seekValue = ref<number>(0);
const seekMax = ref<number>(100);
const isPlaying = ref<boolean>(false);
const isSeeking = ref<boolean>(false);
const floatRect = ref<FloatRect>({ ...state.floatRect });

const historyItems = ref<HistoryItem[]>(
  loadHistory().map((item) => ({
    ...item,
    thumbnailUrl: item.thumbnailUrl || makeThumbnailUrl(item.id)
  }))
);
const historyOpen = ref(false);
const isFocusMode = ref(false);
const showFocusExitButton = ref(false);
const panelTab = ref<PanelTab>("history");

const playlistState = loadPlaylists();
const playlists = ref<Playlist[]>(playlistState.playlists);
const activePlaylistId = ref<string | null>(
  playlistState.activePlaylistId ?? (playlistState.playlists[0]?.id ?? null)
);

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const rateOptions = ref<number[]>([...DEFAULT_RATES]);
const MEDIA_ASPECT_RATIO = 16 / 9;
const SEEK_HOLD_MS = 1200;
const SEEK_EPSILON = 0.8;
const HISTORY_SYNC_MS = 2000;
const FOCUS_EXIT_HIDE_DELAY_MS = 1600;
const FLOAT_MARGIN = 12;
const FLOAT_MIN_WIDTH = 220;
const FLOAT_MIN_HEIGHT = 140;

const historyMap = computed(() => {
  const map = new Map<string, HistoryItem>();
  historyItems.value.forEach((item) => map.set(item.id, item));
  return map;
});

const activePlaylist = computed(() =>
  playlists.value.find((playlist) => playlist.id === activePlaylistId.value) ?? null
);
const playlistItems = computed(() => activePlaylist.value?.items ?? []);
const canAddCurrent = computed(() => Boolean(activePlaylist.value) && Boolean(getActiveVideoId()));
const isFloatingLayout = computed(() => layout.value === "cameraFloat" || layout.value === "videoFloat");
const floatingPaneStyle = computed(() => ({
  left: `${floatRect.value.x}px`,
  top: `${floatRect.value.y}px`,
  width: `${floatRect.value.w}px`,
  height: `${floatRect.value.h}px`
}));
const motionTracker = useCameraMotionEnergy();
const motionEnergy = computed(() => (motionTrackerEnabled.value ? motionTracker.energyRef.value : 0));

const cameraVideo = ref<HTMLVideoElement | null>(null);
const appRoot = ref<HTMLElement | null>(null);
const stageElement = ref<HTMLElement | null>(null);
const videoViewport = ref<HTMLElement | null>(null);
const cameraViewport = ref<HTMLElement | null>(null);
const videoFrameStyle = ref<FrameStyle>({ width: "100%", height: "100%" });
const cameraFrameStyle = ref<FrameStyle>({ width: "100%", height: "100%" });
const dragState = ref<DragState | null>(null);

let player: YouTubePlayer | null = null;
let playerReady = false;
let pendingVideoId: string | null = null;
let durationSec = 0;
let timeTimer: number | null = null;
let cameraStream: MediaStream | null = null;
let pendingSeekTo: number | null = null;
let pendingSeekAt = 0;
let pendingResumeState: PendingResumeState | null = null;
let historyDirty = false;
let lastHistorySyncAt = 0;
let dragHandleEl: HTMLElement | null = null;
let floatDragState: FloatDragState | null = null;
let floatDragHandleEl: HTMLElement | null = null;
let mediaFrameResizeObserver: ResizeObserver | null = null;
let focusExitTimer: number | null = null;
let isUnmounted = false;

// ステータスメッセージの表示内容を更新する。
function setStatus(target: Ref<string>, message = "") {
  target.value = message;
}

// アプリ状態の一部をメモリとストレージへ反映する。
function persist(partial: Partial<AppState>) {
  Object.assign(state, partial);
  saveState<AppState>(partial);
}

// 秒数を mm:ss 形式に変換する。
function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// UNIX時刻を日本語ロケールの表示文字列に変換する。
function formatDate(timestamp: number) {
  if (!timestamp) return "--";
  return new Date(timestamp).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// 値を最小値と最大値の範囲に収める。
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// 現在のステージ表示領域サイズを取得する。
function getStageSize() {
  const element = stageElement.value;
  if (element) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

// 指定領域に収まる固定アスペクト比フレームのサイズを計算する。
function calcFrameStyle(viewport: HTMLElement | null, fallback: FrameStyle): FrameStyle {
  if (!viewport) return fallback;

  const rect = viewport.getBoundingClientRect();
  const maxWidth = Math.max(0, rect.width);
  const maxHeight = Math.max(0, rect.height);
  if (maxWidth === 0 || maxHeight === 0) {
    return fallback;
  }

  const widthByHeight = maxHeight * MEDIA_ASPECT_RATIO;
  const width = widthByHeight <= maxWidth ? widthByHeight : maxWidth;
  const height = width / MEDIA_ASPECT_RATIO;

  return {
    width: `${Math.round(width)}px`,
    height: `${Math.round(height)}px`
  };
}

// 動画とカメラの表示フレームサイズを再計算する。
function updateMediaFrameStyles() {
  videoFrameStyle.value = calcFrameStyle(videoViewport.value, videoFrameStyle.value);
  cameraFrameStyle.value = calcFrameStyle(cameraViewport.value, cameraFrameStyle.value);
}

// レイアウト変更直後の0サイズ計測を避けるため、次フレームでも再計算する。
function scheduleMediaFrameStylesUpdate() {
  void nextTick(() => {
    updateMediaFrameStyles();
    window.requestAnimationFrame(() => {
      updateMediaFrameStyles();
    });
  });
}

// 小窓レイアウトかどうかを判定する。
function isFloatingLayoutMode(value: LayoutOption) {
  return value === "cameraFloat" || value === "videoFloat";
}

// 小窓の位置とサイズをステージ内に収まる値へ補正する。
function clampFloatRect(rect: FloatRect) {
  const { width, height } = getStageSize();
  const minWidth = Math.min(FLOAT_MIN_WIDTH, Math.max(120, width - FLOAT_MARGIN * 2));
  const minHeight = Math.min(FLOAT_MIN_HEIGHT, Math.max(90, height - FLOAT_MARGIN * 2));
  const maxWidth = Math.max(minWidth, width - FLOAT_MARGIN * 2);
  const maxHeight = Math.max(minHeight, height - FLOAT_MARGIN * 2);
  const w = clamp(rect.w, minWidth, maxWidth);
  const h = clamp(rect.h, minHeight, maxHeight);
  const maxX = Math.max(FLOAT_MARGIN, width - w - FLOAT_MARGIN);
  const maxY = Math.max(FLOAT_MARGIN, height - h - FLOAT_MARGIN);
  const x = clamp(rect.x, FLOAT_MARGIN, maxX);
  const y = clamp(rect.y, FLOAT_MARGIN, maxY);
  return { x, y, w, h };
}

// 小窓位置を更新し、必要に応じて永続化する。
function applyFloatRect(rect: FloatRect, options: SaveOptions = {}) {
  const next = clampFloatRect(rect);
  floatRect.value = next;
  if (!options.skipSave) {
    persist({ floatRect: next });
  }
}

// 動画IDからYouTubeサムネイルURLを生成する。
function makeThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

// 履歴から対象動画のエントリを取得する。
function getHistoryItem(videoId: string) {
  return historyMap.value.get(videoId);
}

// 履歴情報を優先して動画タイトルを返す。
function getVideoTitle(videoId: string) {
  return getHistoryItem(videoId)?.title || videoId;
}

// 履歴情報を優先してサムネイルURLを返す。
function getVideoThumbnail(videoId: string) {
  return getHistoryItem(videoId)?.thumbnailUrl || makeThumbnailUrl(videoId);
}

// 履歴情報を優先して前回再生位置を返す。
function getVideoPosition(videoId: string) {
  return getHistoryItem(videoId)?.lastPositionSec ?? 0;
}

// 履歴を再生日時順に整列して保存する。
function commitHistory(items: HistoryItem[], options: HistoryCommitOptions = {}) {
  const nextItems = options.keepOrder
    ? [...items]
    : [...items].sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  historyItems.value = nextItems;
  if (options.skipSave) {
    historyDirty = true;
    return;
  }
  saveHistory(nextItems);
  historyDirty = false;
}

// 履歴1件をマージ更新し、存在しなければ追加する。
function upsertHistoryEntry(
  update: Partial<HistoryItem> & { id: string },
  options: HistoryCommitOptions = {}
) {
  const items = historyItems.value;
  const index = items.findIndex((item) => item.id === update.id);
  const existing = index >= 0 ? items[index] : null;

  const titleCandidate = typeof update.title === "string" ? update.title.trim() : "";
  const title = titleCandidate || existing?.title || "Unknown title";
  const thumbnailUrl =
    typeof update.thumbnailUrl === "string" && update.thumbnailUrl
      ? update.thumbnailUrl
      : existing?.thumbnailUrl || makeThumbnailUrl(update.id);
  const channelTitle =
    update.channelTitle !== undefined ? update.channelTitle : existing?.channelTitle;
  const durationSec =
    typeof update.durationSec === "number" ? update.durationSec : existing?.durationSec;
  const lastPlayedAt =
    typeof update.lastPlayedAt === "number"
      ? update.lastPlayedAt
      : existing?.lastPlayedAt ?? Date.now();
  const lastPositionSec =
    typeof update.lastPositionSec === "number"
      ? update.lastPositionSec
      : existing?.lastPositionSec ?? 0;

  const merged: HistoryItem = {
    id: update.id,
    title,
    thumbnailUrl,
    channelTitle,
    durationSec,
    lastPlayedAt,
    lastPositionSec
  };

  const next =
    index >= 0 ? items.map((item, idx) => (idx === index ? merged : item)) : [merged, ...items];
  commitHistory(next, options);
}

// 再生時刻だけを更新して履歴をアクティブ扱いにする。
function touchHistory(videoId: string) {
  upsertHistoryEntry({
    id: videoId,
    lastPlayedAt: Date.now(),
    thumbnailUrl: makeThumbnailUrl(videoId)
  });
}

// 現在アクティブな動画の再生位置を履歴に保存する。
function updateHistoryPosition(position: number, options: HistoryCommitOptions = {}) {
  const activeId = getActiveVideoId();
  if (!activeId) return;
  const safePosition = Math.max(0, Math.floor(position));
  const items = historyItems.value;
  const index = items.findIndex((item) => item.id === activeId);

  if (index < 0) {
    upsertHistoryEntry({ id: activeId, lastPositionSec: safePosition }, options);
    return;
  }

  const existing = items[index];
  if (existing.lastPositionSec === safePosition) {
    if (!options.skipSave && historyDirty) {
      saveHistory(historyItems.value);
      historyDirty = false;
    }
    return;
  }

  const nextItems = [...items];
  nextItems[index] = {
    ...existing,
    lastPositionSec: safePosition
  };
  commitHistory(nextItems, { ...options, keepOrder: true });
}

// YouTubeプレイヤーから取得できるメタ情報を履歴へ同期する。
function scheduleResumePosition(videoId: string) {
  const position = getVideoPosition(videoId);
  pendingResumeState = position > 0 ? { videoId, position } : null;
}

function applyPendingResumePosition() {
  if (!pendingResumeState || !player || !playerReady) return;

  const activeId = getActiveVideoId();
  if (activeId !== pendingResumeState.videoId) return;

  const duration = player.getDuration();
  if (!Number.isFinite(duration) || duration <= 0) return;

  const safePosition = Math.max(0, pendingResumeState.position);
  const target = safePosition >= duration ? Math.max(0, duration - 1) : safePosition;
  pendingResumeState = null;
  if (target <= 0) return;

  player.seekTo(target, true);
  pendingSeekTo = target;
  pendingSeekAt = Date.now();
  seekValue.value = Math.floor(target);
  updateTimeLabel(target, durationSec || duration);
}

function syncHistoryMetadata(videoId: string) {
  if (!player || !playerReady) return;
  const data = player.getVideoData ? player.getVideoData() : undefined;
  const dataId = typeof data?.video_id === "string" ? data.video_id : "";
  if (!dataId || dataId !== videoId) return;
  const titleCandidate = typeof data?.title === "string" ? data.title.trim() : "";
  const title = titleCandidate || "Unknown title";
  const channelTitle = typeof data?.author === "string" ? data.author.trim() : undefined;
  const duration = player.getDuration();
  const durationSec = Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : undefined;

  upsertHistoryEntry({
    id: videoId,
    title,
    channelTitle,
    durationSec,
    thumbnailUrl: makeThumbnailUrl(videoId)
  });
}

// プレイリストIDを生成する。
function createPlaylistId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// プレイリスト一覧とアクティブ状態をまとめて保存する。
function commitPlaylists(nextPlaylists: Playlist[], nextActiveId = activePlaylistId.value) {
  const activeId = nextActiveId ?? null;
  playlists.value = nextPlaylists;
  activePlaylistId.value = activeId;
  savePlaylists({ playlists: nextPlaylists, activePlaylistId: activeId });
}

// 指定したプレイリストをアクティブに切り替える。
function setActivePlaylist(playlistId: string) {
  if (playlistId === activePlaylistId.value) return;
  commitPlaylists(playlists.value, playlistId);
}

// 新規プレイリストを作成して選択状態にする。
function createPlaylist() {
  const index = playlists.value.length + 1;
  const now = Date.now();
  const playlist: Playlist = {
    id: createPlaylistId(),
    name: `Playlist ${index}`,
    createdAt: now,
    updatedAt: now,
    items: []
  };
  commitPlaylists([playlist, ...playlists.value], playlist.id);
  panelTab.value = "playlists";
}

// プレイリスト名を入力ダイアログ経由で変更する。
function renamePlaylist(playlist: Playlist) {
  const name = window.prompt("Playlist name", playlist.name);
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const next = playlists.value.map((item) =>
    item.id === playlist.id ? { ...item, name: trimmed, updatedAt: Date.now() } : item
  );
  commitPlaylists(next);
}

// プレイリストを削除し、必要なら次のプレイリストを選択する。
function deletePlaylist(playlistId: string) {
  const target = playlists.value.find((item) => item.id === playlistId);
  if (!target) return;
  const ok = window.confirm(`Delete playlist \"${target.name}\"?`);
  if (!ok) return;

  const next = playlists.value.filter((item) => item.id !== playlistId);
  const currentActiveId = activePlaylistId.value;
  const nextActive =
    currentActiveId === playlistId
      ? (next[0]?.id ?? null)
      : (next.some((item) => item.id === currentActiveId) ? currentActiveId : (next[0]?.id ?? null));
  commitPlaylists(next, nextActive);
}

// 指定プレイリストの動画ID配列を置き換える。
function updatePlaylistItems(playlistId: string, items: string[]) {
  const next = playlists.value.map((playlist) =>
    playlist.id === playlistId ? { ...playlist, items, updatedAt: Date.now() } : playlist
  );
  commitPlaylists(next);
}

// 現在再生中の動画をアクティブプレイリストへ追加する。
function addCurrentToPlaylist() {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  const activeId = getActiveVideoId();
  if (!activeId) return;

  if (playlist.items.includes(activeId)) return;
  const nextItems = [...playlist.items, activeId];
  updatePlaylistItems(playlist.id, nextItems);
  touchHistory(activeId);
  syncHistoryMetadata(activeId);
}

// 対象動画が現在のプレイリストへ追加可能か判定する。
function canAddVideoToPlaylist(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return false;
  return !playlist.items.includes(videoId);
}

// 追加ボタンに表示する補助テキストを返す。
function getAddVideoTitle(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return "Create playlist first";
  if (playlist.items.includes(videoId)) return "Already in playlist";
  return "Add to playlist";
}

// 任意の動画をアクティブプレイリストへ追加する。
function addVideoToPlaylist(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  if (playlist.items.includes(videoId)) return;
  const nextItems = [...playlist.items, videoId];
  updatePlaylistItems(playlist.id, nextItems);
  touchHistory(videoId);
  syncHistoryMetadata(videoId);
}

// プレイリストから指定位置の動画を削除する。
function removePlaylistItem(index: number) {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  const nextItems = playlist.items.filter((_, idx) => idx !== index);
  updatePlaylistItems(playlist.id, nextItems);
}

// 動画IDからURL入力を組み立てて読み込みを実行する。
function playFromVideoId(videoId: string) {
  const inputValue = `https://youtu.be/${videoId}`;
  ytUrl.value = inputValue;
  handleLoad();
  closeHistory();
}

// プレイリスト項目クリック時の再生ハンドラ。
function playFromPlaylist(videoId: string) {
  playFromVideoId(videoId);
}

// 並び替えドラッグを開始し、追跡リスナーを登録する。
function startDrag(event: PointerEvent, index: number) {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  if (index < 0 || index >= playlist.items.length) return;

  event.preventDefault();
  dragHandleEl = event.currentTarget as HTMLElement;
  dragHandleEl.setPointerCapture(event.pointerId);
  dragState.value = {
    id: playlist.items[index],
    fromIndex: index,
    overIndex: index
  };
  window.addEventListener("pointermove", handleDragMove);
  window.addEventListener("pointerup", handleDragEnd);
  window.addEventListener("pointercancel", handleDragEnd);
}

// ドラッグ中のポインタ位置から挿入候補インデックスを更新する。
function handleDragMove(event: PointerEvent) {
  if (!dragState.value) return;
  const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const row = element?.closest(".playlist-row-item") as HTMLElement | null;
  if (!row) return;
  const index = Number(row.dataset.index);
  if (!Number.isFinite(index)) return;
  if (index === dragState.value.overIndex) return;

  dragState.value = { ...dragState.value, overIndex: index };
}

// 並び替えドラッグを終了し、実際の順序変更を確定する。
function handleDragEnd(event: PointerEvent) {
  if (!dragState.value) return;
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);
  window.removeEventListener("pointercancel", handleDragEnd);

  if (dragHandleEl) {
    try {
      dragHandleEl.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors.
    }
    dragHandleEl = null;
  }

  const { fromIndex, overIndex } = dragState.value;
  dragState.value = null;

  const playlist = activePlaylist.value;
  if (!playlist) return;
  if (fromIndex === overIndex) return;

  const nextItems = [...playlist.items];
  const [moved] = nextItems.splice(fromIndex, 1);
  nextItems.splice(overIndex, 0, moved);
  updatePlaylistItems(playlist.id, nextItems);
}

// 小窓のドラッグ移動を開始する。
function startFloatDrag(event: PointerEvent) {
  if (!isFloatingLayout.value) return;
  if (event.button !== 0) return;
  event.preventDefault();

  floatDragHandleEl = event.currentTarget as HTMLElement;
  floatDragHandleEl.setPointerCapture(event.pointerId);
  floatDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: floatRect.value.x,
    originY: floatRect.value.y
  };
  window.addEventListener("pointermove", handleFloatDragMove);
  window.addEventListener("pointerup", handleFloatDragEnd);
  window.addEventListener("pointercancel", handleFloatDragEnd);
}

// 小窓ドラッグ中の座標を更新する。
function handleFloatDragMove(event: PointerEvent) {
  if (!floatDragState) return;
  if (event.pointerId !== floatDragState.pointerId) return;
  const dx = event.clientX - floatDragState.startX;
  const dy = event.clientY - floatDragState.startY;
  floatRect.value = clampFloatRect({
    ...floatRect.value,
    x: floatDragState.originX + dx,
    y: floatDragState.originY + dy
  });
}

// 小窓ドラッグを終了して位置を保存する。
function handleFloatDragEnd(event: PointerEvent) {
  if (!floatDragState) return;
  if (event.pointerId !== floatDragState.pointerId) return;
  window.removeEventListener("pointermove", handleFloatDragMove);
  window.removeEventListener("pointerup", handleFloatDragEnd);
  window.removeEventListener("pointercancel", handleFloatDragEnd);

  if (floatDragHandleEl) {
    try {
      floatDragHandleEl.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release errors.
    }
    floatDragHandleEl = null;
  }

  floatDragState = null;
  applyFloatRect(floatRect.value);
}

// 再生中プレイヤーを基準に現在の動画IDを返す。
function getActiveVideoId() {
  if (!player || !playerReady) return state.videoId;
  const data = player.getVideoData ? player.getVideoData() : undefined;
  const dataId = typeof data?.video_id === "string" ? data.video_id : "";
  return dataId || state.videoId;
}

// 現在時刻表示ラベルを更新する。
function updateTimeLabel(current: number, duration: number) {
  timeLabel.value = `${formatTime(current)} / ${formatTime(duration)}`;
}

// レイアウト選択を反映して永続化する。
function updateLayout(value: LayoutOption) {
  if (!isFloatingLayoutMode(value) && floatDragState) {
    window.removeEventListener("pointermove", handleFloatDragMove);
    window.removeEventListener("pointerup", handleFloatDragEnd);
    window.removeEventListener("pointercancel", handleFloatDragEnd);
    floatDragState = null;
    floatDragHandleEl = null;
  }
  layout.value = value;
  if (isFloatingLayoutMode(value)) {
    applyFloatRect(floatRect.value, { skipSave: true });
  }
  persist({ layout: value });
  scheduleMediaFrameStylesUpdate();
}

// 画面リサイズ時に小窓の表示領域を補正する。
function handleWindowResize() {
  if (isFloatingLayout.value) {
    applyFloatRect(floatRect.value, { skipSave: true });
  }
  updateMediaFrameStyles();
}

// 固定比率フレームの監視を開始する。
function initMediaFrameObserver() {
  if (typeof ResizeObserver === "undefined") return;
  if (mediaFrameResizeObserver) {
    mediaFrameResizeObserver.disconnect();
  }
  mediaFrameResizeObserver = new ResizeObserver(() => {
    updateMediaFrameStyles();
  });
  if (videoViewport.value) {
    mediaFrameResizeObserver.observe(videoViewport.value);
  }
  if (cameraViewport.value) {
    mediaFrameResizeObserver.observe(cameraViewport.value);
  }
}

// 固定比率フレームの監視を停止する。
function disposeMediaFrameObserver() {
  if (!mediaFrameResizeObserver) return;
  mediaFrameResizeObserver.disconnect();
  mediaFrameResizeObserver = null;
}

// 簡易モーショントラッカーの状態を現在のカメラ入力へ反映する。
function applyMotionTrackerState(videoEl: HTMLVideoElement | null) {
  if (!motionTrackerEnabled.value || !videoEl) {
    motionTracker.stop();
    return;
  }
  motionTracker.start(videoEl);
}

// カメラの反転設定を永続化する。
function updateMirror() {
  persist({ mirrorCamera: mirrorCamera.value });
}

// YouTube表示の反転設定を永続化する。
function updateVideoMirror() {
  persist({ mirrorVideo: mirrorVideo.value });
}

// 疑似波形の表示ON/OFF設定を永続化する。
function updateWaveformEnabled() {
  persist({ waveformEnabled: waveformEnabled.value });
}

// 簡易モーショントラッカーのON/OFF設定を永続化して即時反映する。
function updateMotionTrackerEnabled() {
  persist({ motionTrackerEnabled: motionTrackerEnabled.value });
  applyMotionTrackerState(cameraVideo.value);
}

// 再生速度を安全な値で適用し、必要に応じて保存する。
function setPlaybackRate(rate: number, options: SaveOptions = {}) {
  const numericRate = Number(rate);
  const safeRate = rateOptions.value.includes(numericRate) ? numericRate : 1;
  selectedRate.value = safeRate;
  if (playerReady && player) {
    try {
      player.setPlaybackRate(safeRate);
    } catch {
      // Ignore unsupported rate errors.
    }
  }
  if (!options.skipSave) {
    persist({ playbackRate: safeRate });
  }
}

// プレイヤー時刻をUIへ同期し、再生中は履歴位置も定期保存する。
function updateTime() {
  if (!playerReady || !player) return;

  const duration = player.getDuration();
  if (Number.isFinite(duration) && duration > 0) {
    const rounded = Math.floor(duration);
    if (rounded !== durationSec) {
      durationSec = rounded;
      seekMax.value = rounded;
    }
  }

  applyPendingResumePosition();

  if (isSeeking.value) return;

  const current = player.getCurrentTime();
  if (pendingSeekTo !== null) {
    const elapsed = Date.now() - pendingSeekAt;
    const isSynced =
      Number.isFinite(current) && Math.abs(current - pendingSeekTo) <= SEEK_EPSILON;
    if (isSynced || elapsed >= SEEK_HOLD_MS) {
      pendingSeekTo = null;
    } else {
      const labelDuration = durationSec || (Number.isFinite(duration) ? duration : 0);
      seekValue.value = pendingSeekTo;
      updateTimeLabel(pendingSeekTo, labelDuration);
      return;
    }
  }
  if (Number.isFinite(current)) {
    const safeCurrent = Math.min(Math.floor(current), seekMax.value);
    seekValue.value = safeCurrent;
    updateTimeLabel(safeCurrent, durationSec || duration || 0);

    if (isPlaying.value) {
      const now = Date.now();
      if (now - lastHistorySyncAt >= HISTORY_SYNC_MS) {
        updateHistoryPosition(safeCurrent, { skipSave: true });
        lastHistorySyncAt = now;
      }
    }
  }
}

// 入力URL/IDを検証し、対象動画の読み込み要求を出す。
function handleLoad() {
  const inputValue = ytUrl.value.trim();
  const videoId = extractVideoId(inputValue);
  if (!videoId) {
    setStatus(ytStatus, "Invalid YouTube URL or ID.");
    return;
  }

  setStatus(ytStatus, "");
  persist({ videoId, lastInput: inputValue });
  touchHistory(videoId);
  syncHistoryMetadata(videoId);
  scheduleResumePosition(videoId);

  if (playerReady && player) {
    player.loadVideoById(videoId);
  } else {
    pendingVideoId = videoId;
  }
}

// 再生状態を見て Play/Pause をトグルする。
function togglePlay() {
  const yt = window.YT;
  if (!playerReady || !player || !yt) return;
  const currentState = player.getPlayerState();
  if (currentState === yt.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

// シーク操作開始時に自動同期を一時停止する。
function handleSeekStart() {
  isSeeking.value = true;
}

// シーク中のつまみ位置で時刻ラベルを先行表示する。
function handleSeekInput() {
  updateTimeLabel(seekValue.value, durationSec || 0);
}

// シーク確定時にプレイヤー移動と履歴更新を行う。
function handleSeekCommit() {
  const target = seekValue.value;
  pendingResumeState = null;
  if (playerReady && player) {
    player.seekTo(target, true);
  }
  pendingSeekTo = target;
  pendingSeekAt = Date.now();
  isSeeking.value = false;
  updateHistoryPosition(target);
  lastHistorySyncAt = Date.now();
}

// 履歴パネルを閉じる。
function closeHistory() {
  historyOpen.value = false;
}

// 履歴パネルの開閉をトグルする。
function toggleHistory() {
  if (isFocusMode.value) return;
  historyOpen.value = !historyOpen.value;
}

// フォーカス終了ボタンの非表示タイマーを停止する。
function clearFocusExitTimer() {
  if (!focusExitTimer) return;
  clearTimeout(focusExitTimer);
  focusExitTimer = null;
}

// フォーカス終了ボタンを一時表示し、一定時間後に隠す。
function showFocusExitButtonTemporarily() {
  if (!isFocusMode.value) return;
  showFocusExitButton.value = true;
  clearFocusExitTimer();
  focusExitTimer = window.setTimeout(() => {
    showFocusExitButton.value = false;
    focusExitTimer = null;
  }, FOCUS_EXIT_HIDE_DELAY_MS);
}

// UIを隠したフォーカスモードへ遷移する。
async function enterFocusMode() {
  closeHistory();
  isFocusMode.value = true;
  showFocusExitButtonTemporarily();
  void nextTick(() => {
    updateMediaFrameStyles();
  });

  const root = appRoot.value;
  if (!root || !document.fullscreenEnabled || document.fullscreenElement) return;
  try {
    await root.requestFullscreen();
  } catch {
    // Keep focus mode enabled even when native fullscreen is blocked.
  }
}

// フォーカスモードを終了し、通常表示へ戻す。
async function exitFocusMode() {
  clearFocusExitTimer();
  isFocusMode.value = false;
  showFocusExitButton.value = false;
  void nextTick(() => {
    updateMediaFrameStyles();
  });
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // Ignore fullscreen exit errors.
  }
}

// フォーカスモードのON/OFFを切り替える。
function toggleFocusMode() {
  if (isFocusMode.value) {
    void exitFocusMode();
  } else {
    void enterFocusMode();
  }
}

// Fullscreen API の状態変化をUI状態へ同期する。
function handleFullscreenChange() {
  if (!document.fullscreenElement) {
    clearFocusExitTimer();
    isFocusMode.value = false;
    showFocusExitButton.value = false;
  }
  void nextTick(() => {
    updateMediaFrameStyles();
  });
}

// フォーカス中の操作を検知して終了ボタンを再表示する。
function handleFocusActivity() {
  showFocusExitButtonTemporarily();
}

// グローバルキー入力を処理し、Escで優先的にフォーカス解除する。
function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (isFocusMode.value) {
      void exitFocusMode();
      return;
    }
    closeHistory();
  }
}

// 履歴項目選択時に対象動画を再生する。
function handleHistorySelect(item: HistoryItem) {
  playFromVideoId(item.id);
}

// 履歴から指定動画を1件削除する。
function removeHistoryItem(id: string) {
  const next = historyItems.value.filter((item) => item.id !== id);
  commitHistory(next);
}

// 履歴全件をクリアする。
function clearHistory() {
  commitHistory([]);
}

// YouTubeプレイヤー準備完了時の初期同期処理を行う。
function flushCurrentHistoryPosition() {
  if (!playerReady || !player) {
    if (historyDirty) {
      saveHistory(historyItems.value);
      historyDirty = false;
    }
    return;
  }
  const current = player.getCurrentTime();
  if (!Number.isFinite(current)) {
    if (historyDirty) {
      saveHistory(historyItems.value);
      historyDirty = false;
    }
    return;
  }
  updateHistoryPosition(current);
  if (historyDirty) {
    saveHistory(historyItems.value);
    historyDirty = false;
  }
  lastHistorySyncAt = Date.now();
}

function handleBeforeUnload() {
  flushCurrentHistoryPosition();
}

function onPlayerReady(_event: YouTubePlayerEvent, instance: YouTubePlayer) {
  if (isUnmounted) {
    return;
  }

  player = instance;
  playerReady = true;
  setStatus(ytStatus, "");

  const rates = player.getAvailablePlaybackRates();
  if (Array.isArray(rates) && rates.length) {
    rateOptions.value = rates;
  } else {
    rateOptions.value = [...DEFAULT_RATES];
  }

  setPlaybackRate(state.playbackRate, { skipSave: true });

  const startupVideoId = pendingVideoId ?? state.videoId;
  if (startupVideoId) {
    scheduleResumePosition(startupVideoId);
  }

  if (pendingVideoId) {
    player.loadVideoById(pendingVideoId);
    pendingVideoId = null;
  }

  if (timeTimer) clearInterval(timeTimer);
  timeTimer = window.setInterval(updateTime, 300);
  updateTime();
}

// YouTubeプレイヤーの状態変化に応じてUIと履歴を更新する。
function onPlayerStateChange(event: YouTubePlayerEvent) {
  const yt = window.YT;
  if (!yt) return;

  isPlaying.value = event.data === yt.PlayerState.PLAYING;

  if (event.data === yt.PlayerState.PLAYING) {
    const activeId = getActiveVideoId();
    if (activeId) {
      touchHistory(activeId);
      syncHistoryMetadata(activeId);
    }
  }

  if (event.data === yt.PlayerState.PAUSED || event.data === yt.PlayerState.ENDED) {
    if (player) {
      const current = player.getCurrentTime();
      if (Number.isFinite(current)) {
        updateHistoryPosition(current);
        lastHistorySyncAt = Date.now();
      }
    }
  }

  if (event.data === yt.PlayerState.ENDED && player) {
    const duration = player.getDuration();
    if (Number.isFinite(duration) && duration > 0) {
      updateHistoryPosition(duration);
    }
  }
}

// YouTubeプレイヤーエラー時の表示とログ出力を行う。
function onPlayerError(_event: YouTubePlayerEvent) {
  setStatus(ytStatus, "Video failed to load.");
  console.error("YouTube error", _event);
}

// カメラストリームを初期化し、動画要素へ接続する。
async function initCamera() {
  const videoEl = cameraVideo.value;
  if (!videoEl || isUnmounted) return;
  try {
    const stream = await startCamera(videoEl, { width: 1280, height: 720 });
    if (isUnmounted) {
      stopCamera(stream);
      return;
    }
    cameraStream = stream;
    applyMotionTrackerState(videoEl);
    setStatus(cameraStatus, "");
  } catch (error) {
    motionTracker.stop();
    if (isUnmounted) return;
    setStatus(cameraStatus, "Camera unavailable.");
    console.error("Camera error", error);
  }
}

// YouTubeプレイヤーを初期化し、イベントを接続する。
async function initPlayer() {
  try {
    await createYouTubePlayer({
      elementId: "yt-player",
      ...(state.videoId ? { videoId: state.videoId } : {}),
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    });
  } catch (error) {
    setStatus(ytStatus, "YouTube API failed.");
    console.error("YouTube API error", error);
  }
}

// マウント時にカメラ/プレイヤー初期化とイベント登録を実行する。
onMounted(() => {
  isUnmounted = false;
  persist({ waveformMode: waveformMode.value });
  initCamera();
  initPlayer();
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleWindowResize);
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  void nextTick(() => {
    applyFloatRect(floatRect.value, { skipSave: true });
    initMediaFrameObserver();
    updateMediaFrameStyles();
  });
});

// アンマウント時にタイマー/イベント/メディアリソースを解放する。
onBeforeUnmount(() => {
  flushCurrentHistoryPosition();
  isUnmounted = true;
  if (timeTimer) clearInterval(timeTimer);
  clearFocusExitTimer();
  disposeMediaFrameObserver();
  stopCamera(cameraStream);
  motionTracker.stop();
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", handleWindowResize);
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);
  window.removeEventListener("pointercancel", handleDragEnd);
  window.removeEventListener("pointermove", handleFloatDragMove);
  window.removeEventListener("pointerup", handleFloatDragEnd);
  window.removeEventListener("pointercancel", handleFloatDragEnd);
  floatDragState = null;
  floatDragHandleEl = null;
  if (document.fullscreenElement === appRoot.value) {
    void document.exitFullscreen();
  }
});
</script>

<template>
  <div ref="appRoot" class="app" :class="{ 'is-focus-mode': isFocusMode }">
    <header class="topbar">
      <div class="control-row">
        <label class="field">
          <span class="field-label">YouTube</span>
          <input
            id="yt-url"
            v-model="ytUrl"
            type="text"
            placeholder="YouTube URL or ID"
            @keydown.enter.prevent="handleLoad"
          />
        </label>
        <button class="btn primary" type="button" @click="handleLoad">Load</button>
        <span class="status" :class="{ 'is-visible': ytStatus }" aria-live="polite">{{ ytStatus }}</span>
      </div>

      <div class="control-row playback">
        <button class="btn play-toggle" type="button" @click="togglePlay">
          {{ isPlaying ? "Pause" : "Play" }}
        </button>
        <input
          id="yt-seek"
          v-model.number="seekValue"
          class="range"
          type="range"
          min="0"
          :max="seekMax"
          step="1"
          @pointerdown="handleSeekStart"
          @input="handleSeekInput"
          @pointerup="handleSeekCommit"
          @change="handleSeekCommit"
        />
        <span class="time">{{ timeLabel }}</span>
        <select class="select" v-model.number="selectedRate" @change="setPlaybackRate(selectedRate)">
          <option v-for="rate in rateOptions" :key="rate" :value="rate">{{ rate }}x</option>
        </select>
      </div>

      <div class="control-row layout">
        <span class="field-label">Layout</span>
        <div class="segmented">
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'split' }"
            type="button"
            @click="updateLayout('split')"
          >
            Split
          </button>
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'splitReverse' }"
            type="button"
            @click="updateLayout('splitReverse')"
          >
            Reverse
          </button>
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'cameraFloat' }"
            type="button"
            @click="updateLayout('cameraFloat')"
          >
            Cam Float
          </button>
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'videoFloat' }"
            type="button"
            @click="updateLayout('videoFloat')"
          >
            Vid Float
          </button>
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'videoOnly' }"
            type="button"
            @click="updateLayout('videoOnly')"
          >
            Video
          </button>
          <button
            class="btn segment"
            :class="{ 'is-active': layout === 'cameraOnly' }"
            type="button"
            @click="updateLayout('cameraOnly')"
          >
            Camera
          </button>
        </div>
        <label class="toggle">
          <input type="checkbox" v-model="mirrorCamera" @change="updateMirror" />
          <span>Mirror Camera</span>
        </label>
        <label class="toggle">
          <input type="checkbox" v-model="mirrorVideo" @change="updateVideoMirror" />
          <span>Mirror Video</span>
        </label>
      </div>

      <div class="control-row waveform-actions">
        <span class="field-label">Wave</span>
        <label class="toggle">
          <input type="checkbox" v-model="waveformEnabled" @change="updateWaveformEnabled" />
          <span>Wave ON/OFF</span>
        </label>
        <label class="toggle">
          <input type="checkbox" v-model="motionTrackerEnabled" @change="updateMotionTrackerEnabled" />
          <span>Motion Tracker</span>
        </label>
      </div>

      <div class="control-row history-actions">
        <button class="btn subtle focus-toggle" type="button" @click="toggleFocusMode" aria-label="Focus view">
          Focus View
        </button>
        <button
          class="btn icon history-toggle"
          type="button"
          @click="toggleHistory"
          :aria-expanded="historyOpen"
          aria-controls="history-panel"
          aria-label="History"
          title="History"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.6"
            />
          </svg>
        </button>
      </div>
    </header>

    <main class="content" @pointermove="handleFocusActivity" @pointerdown="handleFocusActivity">
      <button
        v-if="isFocusMode"
        class="btn subtle focus-exit"
        :class="{ 'is-visible': showFocusExitButton }"
        type="button"
        @click="toggleFocusMode"
        aria-label="Exit focus mode"
      >
        Close
      </button>
      <section ref="stageElement" class="stage" :data-layout="layout">
        <section
          class="pane video-pane"
          :class="{ 'is-floating': layout === 'videoFloat' }"
          :style="layout === 'videoFloat' ? floatingPaneStyle : undefined"
        >
          <div class="pane-header">
            <span>Video</span>
            <button
              v-if="layout === 'videoFloat'"
              class="btn subtle float-drag-handle"
              type="button"
              @pointerdown="startFloatDrag"
            >
              Drag
            </button>
          </div>
          <div ref="videoViewport" class="media-viewport">
            <div class="media-frame" :style="videoFrameStyle">
              <div class="media yt-shell" :class="{ 'is-mirror': mirrorVideo }">
                <div id="yt-player" class="yt-host"></div>
              </div>
            </div>
          </div>
        </section>

        <section
          class="pane camera-pane"
          :class="{ 'is-floating': layout === 'cameraFloat' }"
          :style="layout === 'cameraFloat' ? floatingPaneStyle : undefined"
        >
          <div class="pane-header">
            <span>Camera</span>
            <span class="status" :class="{ 'is-visible': cameraStatus }" aria-live="polite">{{ cameraStatus }}</span>
            <button
              v-if="layout === 'cameraFloat'"
              class="btn subtle float-drag-handle"
              type="button"
              @pointerdown="startFloatDrag"
            >
              Drag
            </button>
          </div>
          <div ref="cameraViewport" class="media-viewport">
            <div class="media-frame" :style="cameraFrameStyle">
              <video
                ref="cameraVideo"
                class="media"
                :class="{ 'is-mirror': mirrorCamera }"
                autoplay
                playsinline
                muted
              ></video>
            </div>
          </div>
        </section>
      </section>
      <section v-if="waveformEnabled && waveformMode === 'pseudo'" class="waveform-bar">
        <WaveformCanvas
          :enabled="waveformEnabled"
          :is-playing="isPlaying"
          :playback-rate="selectedRate"
          :motion-energy="motionEnergy"
          :focus-mode="isFocusMode"
        />
      </section>
    </main>

    <div v-if="!isFocusMode" class="history-overlay" :class="{ 'is-open': historyOpen }" @click="closeHistory">
      <aside id="history-panel" class="history-panel" @click.stop>
        <div class="panel-header">
          <span>{{ panelTab === "history" ? "History" : "Playlists" }}</span>
          <button class="btn subtle" type="button" @click="closeHistory" aria-label="Close history panel">
            Close
          </button>
        </div>
        <div class="panel-tabs">
          <button
            class="panel-tab"
            type="button"
            :class="{ 'is-active': panelTab === 'history' }"
            @click="panelTab = 'history'"
          >
            History
          </button>
          <button
            class="panel-tab"
            type="button"
            :class="{ 'is-active': panelTab === 'playlists' }"
            @click="panelTab = 'playlists'"
          >
            Playlists
          </button>
        </div>

        <div v-if="panelTab === 'history'" class="history-view">
          <div v-if="!historyItems.length" class="empty-state">No history yet.</div>
          <ul v-else class="history-list">
          <li v-for="item in historyItems" :key="item.id" class="history-item">
            <button class="history-card" type="button" @click="handleHistorySelect(item)">
              <img class="history-thumb" :src="item.thumbnailUrl" :alt="item.title || 'YouTube thumbnail'" />
              <div class="history-meta">
                <div class="history-title">{{ item.title || "Unknown title" }}</div>
                <div class="history-sub">
                  {{ formatTime(item.lastPositionSec) }} / {{ formatDate(item.lastPlayedAt) }}
                </div>
              </div>
            </button>
            <button
              class="btn icon add"
              type="button"
              @click="addVideoToPlaylist(item.id)"
              :disabled="!canAddVideoToPlaylist(item.id)"
              :aria-label="getAddVideoTitle(item.id)"
              :title="getAddVideoTitle(item.id)"
            >
              +
            </button>
            <button class="btn icon" type="button" @click="removeHistoryItem(item.id)" aria-label="Remove">
              x
            </button>
          </li>
          </ul>
          <div class="history-footer">
            <button
              class="btn icon trash"
              type="button"
              @click="clearHistory"
              :disabled="!historyItems.length"
              aria-label="Clear history"
              title="Clear history"
            >
              <svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 7h16M9 7V5h6v2m-8 0v12c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V7"
                  fill="none"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.6"
                />
              </svg>
            </button>
          </div>
        </div>

        <div v-else class="playlist-view">
          <div class="playlist-header">
            <span>Playlists</span>
            <button class="btn subtle" type="button" @click="createPlaylist">＋</button>
          </div>

          <div v-if="!playlists.length" class="empty-state">No playlists yet.</div>
          <div v-else class="playlist-list">
            <div
              v-for="playlist in playlists"
              :key="playlist.id"
              class="playlist-entry"
              :class="{ 'is-active': playlist.id === activePlaylistId }"
            >
              <button class="playlist-select" type="button" @click="setActivePlaylist(playlist.id)">
                {{ playlist.name }}
              </button>
              <div class="playlist-entry-actions">
                <button class="btn icon" type="button" @click="renamePlaylist(playlist)" aria-label="Rename playlist">
                  R
                </button>
                <button class="btn icon" type="button" @click="deletePlaylist(playlist.id)" aria-label="Delete playlist">
                  x
                </button>
              </div>
            </div>
          </div>

          <div v-if="activePlaylist" class="playlist-detail">
            <div class="playlist-detail-header">
              <div class="playlist-detail-title">{{ activePlaylist.name }}</div>
              <button class="btn subtle" type="button" @click="addCurrentToPlaylist" :disabled="!canAddCurrent">
                Add current
              </button>
            </div>
            <div v-if="!playlistItems.length" class="empty-state">No videos yet.</div>
            <ul v-else class="playlist-items">
              <li
                v-for="(videoId, index) in playlistItems"
                :key="`${activePlaylist.id}-${videoId}-${index}`"
                class="playlist-row-item"
                :class="{ 'is-over': dragState && dragState.overIndex === index }"
                :data-index="index"
              >
                <button
                  class="drag-handle"
                  type="button"
                  @pointerdown="startDrag($event, index)"
                  aria-label="Reorder"
                >
                  |||
                </button>
                <button class="playlist-card" type="button" @click="playFromPlaylist(videoId)">
                  <img class="playlist-thumb" :src="getVideoThumbnail(videoId)" :alt="getVideoTitle(videoId)" />
                  <div class="history-meta">
                    <div class="history-title">{{ getVideoTitle(videoId) }}</div>
                    <div class="history-sub">{{ formatTime(getVideoPosition(videoId)) }}</div>
                  </div>
                </button>
                <button class="btn icon" type="button" @click="removePlaylistItem(index)" aria-label="Remove">
                  x
                </button>
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
