export type CameraOptions = {
  width?: number;
  height?: number;
};

export async function startCamera(
  videoEl: HTMLVideoElement,
  options: CameraOptions = {}
): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Camera not supported");
  }

  const constraints = {
    video: {
      width: options.width || 1280,
      height: options.height || 720
    },
    audio: false
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  return stream;
}

export function stopCamera(stream?: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}
