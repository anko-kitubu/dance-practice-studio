let apiPromise = null;

export function loadYouTubeApi() {
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
      resolve(window.YT);
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load YouTube API"));
    document.head.appendChild(script);
  });

  return apiPromise;
}

export function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let value = trimmed;
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  let url;
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

  let id = null;
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

export async function createYouTubePlayer({
  elementId,
  videoId,
  onReady,
  onStateChange,
  onError
}) {
  await loadYouTubeApi();

  return new Promise((resolve) => {
    const player = new window.YT.Player(elementId, {
      videoId,
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
    });
  });
}
