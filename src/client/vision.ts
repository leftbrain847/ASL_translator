/**
 * Live camera tracking with MediaPipe (Apache-2.0): hand and pose landmarks, turned into CamFrames.
 * Only the public web build includes this module. The runtime and models load from pinned CDN URLs, and
 * nothing downloads until the viewer allows the camera. Video stays in the browser: frames go to the
 * on-device model and nowhere else.
 */
import { HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { CamFrame, CamHand } from '../asl/camera';

/** Exact URLs, pinned to versions (the index repo's site_deps.yml locks each by hash for the public site). */
export const VISION = {
  wasmLoaderPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.js',
  wasmBinaryPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_internal.wasm',
  handModel: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  poseModel: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  /** Run the pose model every Nth frame (the shoulders move slowly; the hands need every frame). */
  poseEvery: 2,
};

export interface Tracker {
  detect(video: HTMLVideoElement, nowMs: number): CamFrame | null;
  close(): void;
}

export async function createTracker(onStatus: (s: string) => void): Promise<Tracker> {
  const fileset = { wasmLoaderPath: VISION.wasmLoaderPath, wasmBinaryPath: VISION.wasmBinaryPath };
  const make = async (delegate: 'GPU' | 'CPU') => {
    onStatus('Loading hand tracking…');
    const hands = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: VISION.handModel, delegate }, runningMode: 'VIDEO', numHands: 2,
    });
    onStatus('Loading body tracking…');
    const pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: VISION.poseModel, delegate }, runningMode: 'VIDEO', numPoses: 1,
    });
    return { hands, pose };
  };
  let m: Awaited<ReturnType<typeof make>>;
  try { m = await make('GPU'); } catch { m = await make('CPU'); }
  let n = 0;
  let lastPose: CamFrame['pose'] = null;
  let lastTs = -1;
  return {
    detect(video, nowMs) {
      if (video.readyState < 2 || !video.videoWidth) return null;
      const ts = Math.max(lastTs + 1, Math.round(nowMs));
      lastTs = ts;
      const h = m.hands.detectForVideo(video, ts);
      if (n++ % VISION.poseEvery === 0) {
        const p = m.pose.detectForVideo(video, ts);
        lastPose = p.landmarks[0]?.map((q) => ({ x: q.x, y: q.y, z: q.z })) ?? null;
      }
      const hands: CamHand[] = h.landmarks.map((lm, i) => ({
        landmarks: lm.map((q) => ({ x: q.x, y: q.y, z: q.z })),
        label: h.handedness[i]?.[0]?.categoryName === 'Right' ? 'Right' : 'Left',
      }));
      return { t: ts / 1000, width: video.videoWidth, height: video.videoHeight, pose: lastPose, hands };
    },
    close() { m.hands.close(); m.pose.close(); },
  };
}
