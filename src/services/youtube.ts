type YouTubePlayerState = {
  PLAYING: number;
  PAUSED: number;
  ENDED: number;
};

export type YouTubePlayer = {
  getDuration: () => number;
  getCurrentTime: () => number;
  getAvailablePlaybackRates: () => number[];
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getPlayerState: () => number;
  getVideoData: () => { video_id?: string; title?: string; author?: string };
};

export type YouTubePlayerEvent = {
  data?: number;
  target?: YouTubePlayer;
};

type YouTubeNamespace = {
  Player: new (
    elementId: string,
    options: {
      videoId?: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: (event: YouTubePlayerEvent) => void;
        onStateChange?: (event: YouTubePlayerEvent) => void;
        onError?: (event: YouTubePlayerEvent) => void;
      };
    }
  ) => YouTubePlayer;
  PlayerState: YouTubePlayerState;
};

declare global {
  interface Window {
    YT?: YouTubeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeNamespace> | null = null;

export function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") {
        previous();
      }
      if (window.YT) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube API not available"));
      }
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load YouTube API"));
    document.head.appendChild(script);
  });

  return apiPromise;
}

export function extractVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let value = trimmed;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  const isYouTubeHost =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host.endsWith("youtube-nocookie.com");

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (isYouTubeHost) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/embed/")) {
      id = url.pathname.split("/")[2];
    } else if (url.pathname.startsWith("/shorts/")) {
      id = url.pathname.split("/")[2];
    } else if (url.pathname.startsWith("/live/")) {
      id = url.pathname.split("/")[2];
    }
  }

  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return null;
  }

  return id;
}

type CreatePlayerOptions = {
  elementId: string;
  videoId?: string;
  onReady?: (event: YouTubePlayerEvent, player: YouTubePlayer) => void;
  onStateChange?: (event: YouTubePlayerEvent, player: YouTubePlayer) => void;
  onError?: (event: YouTubePlayerEvent, player: YouTubePlayer) => void;
};

export async function createYouTubePlayer({
  elementId,
  videoId,
  onReady,
  onStateChange,
  onError
}: CreatePlayerOptions): Promise<YouTubePlayer> {
  const yt = await loadYouTubeApi();

  return new Promise((resolve) => {
    const playerOptions: ConstructorParameters<YouTubeNamespace["Player"]>[1] = {
      ...(videoId ? { videoId } : {}),
      playerVars: {
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        controls: 0,
        fs: 0,
        disablekb: 1
      },
      events: {
        onReady: (event) => {
          if (onReady) onReady(event, player);
          resolve(player);
        },
        onStateChange: (event) => {
          if (onStateChange) onStateChange(event, player);
        },
        onError: (event) => {
          if (onError) onError(event, player);
        }
      }
    };

    const player = new yt.Player(elementId, playerOptions);
  });
}
