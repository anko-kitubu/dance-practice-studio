<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import {
  createYouTubePlayer,
  extractVideoId,
  type YouTubePlayer,
  type YouTubePlayerEvent
} from "./services/youtube.ts";
import { startCamera, stopCamera } from "./services/camera.ts";
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

type LayoutOption = "split" | "splitReverse" | "videoOnly" | "cameraOnly";

type AppState = {
  videoId: string;
  lastInput: string;
  playbackRate: number;
  layout: LayoutOption;
  mirrorCamera: boolean;
};

type SaveOptions = {
  skipSave?: boolean;
};

type PanelTab = "history" | "playlists";

type DragState = {
  id: string;
  fromIndex: number;
  overIndex: number;
};

const DEFAULT_STATE: AppState = {
  videoId: "FgGJ323GlUk",
  lastInput: "",
  playbackRate: 1,
  layout: "split",
  mirrorCamera: true
};

const stored = loadState<AppState>();
const state: AppState = { ...DEFAULT_STATE, ...stored };

const ytUrl = ref<string>(state.lastInput || state.videoId);
const layout = ref<LayoutOption>(state.layout);
const mirrorCamera = ref<boolean>(state.mirrorCamera);
const selectedRate = ref<number>(state.playbackRate);

const ytStatus = ref<string>("");
const cameraStatus = ref<string>("");
const timeLabel = ref<string>("0:00 / 0:00");
const seekValue = ref<number>(0);
const seekMax = ref<number>(100);
const isPlaying = ref<boolean>(false);
const isSeeking = ref<boolean>(false);

const historyItems = ref<HistoryItem[]>(
  loadHistory().map((item) => ({
    ...item,
    thumbnailUrl: item.thumbnailUrl || makeThumbnailUrl(item.id)
  }))
);
const historyOpen = ref(false);
const panelTab = ref<PanelTab>("history");

const playlistState = loadPlaylists();
const playlists = ref<Playlist[]>(playlistState.playlists);
const activePlaylistId = ref<string | null>(
  playlistState.activePlaylistId ?? (playlistState.playlists[0]?.id ?? null)
);

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const rateOptions = ref<number[]>([...DEFAULT_RATES]);
const SEEK_HOLD_MS = 1200;
const SEEK_EPSILON = 0.8;
const HISTORY_SYNC_MS = 2000;

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

const cameraVideo = ref<HTMLVideoElement | null>(null);
const dragState = ref<DragState | null>(null);

let player: YouTubePlayer | null = null;
let playerReady = false;
let pendingVideoId: string | null = null;
let durationSec = 0;
let timeTimer: number | null = null;
let cameraStream: MediaStream | null = null;
let pendingSeekTo: number | null = null;
let pendingSeekAt = 0;
let lastHistorySyncAt = 0;
let dragHandleEl: HTMLElement | null = null;

function setStatus(target: Ref<string>, message = "") {
  target.value = message;
}

function persist(partial: Partial<AppState>) {
  Object.assign(state, partial);
  saveState<AppState>(partial);
}

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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

function makeThumbnailUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function getHistoryItem(videoId: string) {
  return historyMap.value.get(videoId);
}

function getVideoTitle(videoId: string) {
  return getHistoryItem(videoId)?.title || videoId;
}

function getVideoThumbnail(videoId: string) {
  return getHistoryItem(videoId)?.thumbnailUrl || makeThumbnailUrl(videoId);
}

function getVideoPosition(videoId: string) {
  return getHistoryItem(videoId)?.lastPositionSec ?? 0;
}

function commitHistory(items: HistoryItem[]) {
  const sorted = [...items].sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  historyItems.value = sorted;
  saveHistory(sorted);
}

function upsertHistoryEntry(update: Partial<HistoryItem> & { id: string }) {
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
  commitHistory(next);
}

function touchHistory(videoId: string) {
  upsertHistoryEntry({
    id: videoId,
    lastPlayedAt: Date.now(),
    thumbnailUrl: makeThumbnailUrl(videoId)
  });
}

function updateHistoryPosition(position: number) {
  const activeId = getActiveVideoId();
  if (!activeId) return;
  const safePosition = Math.max(0, Math.floor(position));
  upsertHistoryEntry({ id: activeId, lastPositionSec: safePosition });
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

function createPlaylistId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function commitPlaylists(nextPlaylists: Playlist[], nextActiveId = activePlaylistId.value) {
  const activeId = nextActiveId ?? null;
  playlists.value = nextPlaylists;
  activePlaylistId.value = activeId;
  savePlaylists({ playlists: nextPlaylists, activePlaylistId: activeId });
}

function setActivePlaylist(playlistId: string) {
  if (playlistId === activePlaylistId.value) return;
  commitPlaylists(playlists.value, playlistId);
}

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

function deletePlaylist(playlistId: string) {
  const target = playlists.value.find((item) => item.id === playlistId);
  if (!target) return;
  const ok = window.confirm(`Delete playlist \"${target.name}\"?`);
  if (!ok) return;

  const next = playlists.value.filter((item) => item.id !== playlistId);
  const nextActive = next[0]?.id ?? null;
  commitPlaylists(next, nextActive);
}

function updatePlaylistItems(playlistId: string, items: string[]) {
  const next = playlists.value.map((playlist) =>
    playlist.id === playlistId ? { ...playlist, items, updatedAt: Date.now() } : playlist
  );
  commitPlaylists(next);
}

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

function canAddVideoToPlaylist(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return false;
  return !playlist.items.includes(videoId);
}

function getAddVideoTitle(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return "Create playlist first";
  if (playlist.items.includes(videoId)) return "Already in playlist";
  return "Add to playlist";
}

function addVideoToPlaylist(videoId: string) {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  if (playlist.items.includes(videoId)) return;
  const nextItems = [...playlist.items, videoId];
  updatePlaylistItems(playlist.id, nextItems);
  touchHistory(videoId);
  syncHistoryMetadata(videoId);
}

function removePlaylistItem(index: number) {
  const playlist = activePlaylist.value;
  if (!playlist) return;
  const nextItems = playlist.items.filter((_, idx) => idx !== index);
  updatePlaylistItems(playlist.id, nextItems);
}

function playFromVideoId(videoId: string) {
  const inputValue = `https://youtu.be/${videoId}`;
  ytUrl.value = inputValue;
  handleLoad();
  closeHistory();
}

function playFromPlaylist(videoId: string) {
  playFromVideoId(videoId);
}

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
}

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

function handleDragEnd(event: PointerEvent) {
  if (!dragState.value) return;
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);

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

function getActiveVideoId() {
  if (!player || !playerReady) return state.videoId;
  const data = player.getVideoData ? player.getVideoData() : undefined;
  const dataId = typeof data?.video_id === "string" ? data.video_id : "";
  return dataId || state.videoId;
}

function updateTimeLabel(current: number, duration: number) {
  timeLabel.value = `${formatTime(current)} / ${formatTime(duration)}`;
}

function updateLayout(value: LayoutOption) {
  layout.value = value;
  persist({ layout: value });
}

function updateMirror() {
  persist({ mirrorCamera: mirrorCamera.value });
}

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
        updateHistoryPosition(safeCurrent);
        lastHistorySyncAt = now;
      }
    }
  }
}

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

  if (playerReady && player) {
    player.loadVideoById(videoId);
  } else {
    pendingVideoId = videoId;
  }
}

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

function handleSeekStart() {
  isSeeking.value = true;
}

function handleSeekInput() {
  updateTimeLabel(seekValue.value, durationSec || 0);
}

function handleSeekCommit() {
  const target = seekValue.value;
  if (playerReady && player) {
    player.seekTo(target, true);
  }
  pendingSeekTo = target;
  pendingSeekAt = Date.now();
  isSeeking.value = false;
  updateHistoryPosition(target);
  lastHistorySyncAt = Date.now();
}

function closeHistory() {
  historyOpen.value = false;
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeHistory();
  }
}

function handleHistorySelect(item: HistoryItem) {
  playFromVideoId(item.id);
}

function removeHistoryItem(id: string) {
  const next = historyItems.value.filter((item) => item.id !== id);
  commitHistory(next);
}

function clearHistory() {
  commitHistory([]);
}

function onPlayerReady(_event: YouTubePlayerEvent, instance: YouTubePlayer) {
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

  if (pendingVideoId) {
    player.loadVideoById(pendingVideoId);
    pendingVideoId = null;
  }

  if (timeTimer) clearInterval(timeTimer);
  timeTimer = window.setInterval(updateTime, 300);
  updateTime();
}

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

function onPlayerError(_event: YouTubePlayerEvent) {
  setStatus(ytStatus, "Video failed to load.");
  console.error("YouTube error", _event);
}

async function initCamera() {
  if (!cameraVideo.value) return;
  try {
    cameraStream = await startCamera(cameraVideo.value, { width: 1280, height: 720 });
    setStatus(cameraStatus, "");
  } catch (error) {
    setStatus(cameraStatus, "Camera unavailable.");
    console.error("Camera error", error);
  }
}

async function initPlayer() {
  try {
    await createYouTubePlayer({
      elementId: "yt-player",
      videoId: state.videoId,
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    });
  } catch (error) {
    setStatus(ytStatus, "YouTube API failed.");
    console.error("YouTube API error", error);
  }
}

onMounted(() => {
  initCamera();
  initPlayer();
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  if (timeTimer) clearInterval(timeTimer);
  stopCamera(cameraStream);
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-title">Dance Practice</span>
        <span class="brand-sub">Split View</span>
      </div>

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
      </div>

      <div class="control-row history-actions">
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

    <main class="content">
      <section class="stage" :data-layout="layout">
        <section class="pane video-pane">
          <div class="pane-header">
            <span>Video</span>
          </div>
          <div id="yt-player" class="media"></div>
        </section>

        <section class="pane camera-pane">
          <div class="pane-header">
            <span>Camera</span>
            <span class="status" :class="{ 'is-visible': cameraStatus }" aria-live="polite">{{ cameraStatus }}</span>
          </div>
          <video
            ref="cameraVideo"
            class="media"
            :class="{ 'is-mirror': mirrorCamera }"
            autoplay
            playsinline
            muted
          ></video>
        </section>
      </section>
    </main>

    <div class="history-overlay" :class="{ 'is-open': historyOpen }" @click="closeHistory">
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
