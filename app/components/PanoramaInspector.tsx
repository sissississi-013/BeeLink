"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Camera, ImagePlus, RotateCcw, ScanLine } from "lucide-react";
import "pannellum/build/pannellum.css";

export type PanoramaHandle = {
  captureFrame: () => { data: string; mimeType: string } | null;
  getOrientation: () => { yaw: number; pitch: number } | null;
};

type Props = {
  onAvailabilityChange?: (available: boolean) => void;
  onSceneKindChange?: (kind: "none" | "real" | "synthetic") => void;
};

type ViewMode = "panorama" | "camera";

const DEMO_PANORAMA = "/demo-apiary-panorama-v2.png";

export const PanoramaInspector = memo(forwardRef<PanoramaHandle, Props>(
  function PanoramaInspector(
    { onAvailabilityChange, onSceneKindChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const viewerRef = useRef<Pannellum.Viewer | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const objectUrlRef = useRef<string | null>(null);
    const loadRequestRef = useRef(0);
    const availabilityCallbackRef = useRef(onAvailabilityChange);
    const sceneKindCallbackRef = useRef(onSceneKindChange);
    const [mode, setMode] = useState<ViewMode>("panorama");
    const [loading, setLoading] = useState(true);
    const [cameraError, setCameraError] = useState("");
    const [sceneLabel, setSceneLabel] = useState("Synthetic demo panorama");

    useEffect(() => {
      availabilityCallbackRef.current = onAvailabilityChange;
      sceneKindCallbackRef.current = onSceneKindChange;
    }, [onAvailabilityChange, onSceneKindChange]);

    const stopCamera = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }, []);

    const destroyViewer = useCallback(() => {
      const viewer = viewerRef.current;
      viewerRef.current = null;
      if (!viewer) return;
      try {
        viewer.destroy();
      } catch {
        // Pannellum may already have released its WebGL surface.
      }
    }, []);

    const loadPanorama = useCallback(
      async (
        source: string,
        kind: "real" | "synthetic",
        label: string,
      ) => {
        const requestId = ++loadRequestRef.current;
        stopCamera();
        setMode("panorama");
        setLoading(true);
        setCameraError("");
        setSceneLabel(label);
        availabilityCallbackRef.current?.(false);
        sceneKindCallbackRef.current?.(kind);
        destroyViewer();
        await import("pannellum");
        if (loadRequestRef.current !== requestId || !containerRef.current) return;

        const viewer = window.pannellum.viewer(containerRef.current, {
          type: "equirectangular",
          panorama: source,
          autoLoad: true,
          autoRotate: -0.45,
          autoRotateInactivityDelay: 8000,
          showFullscreenCtrl: true,
          showZoomCtrl: true,
          compass: true,
          hfov: 92,
          yaw: -12,
          pitch: -6,
          hotSpots:
            kind === "synthetic"
              ? [
                  {
                    pitch: -15,
                    yaw: -76,
                    type: "info",
                    text: "Foreground hive stack · fastening visible",
                  },
                  {
                    pitch: -9,
                    yaw: -3,
                    type: "info",
                    text: "Water tote and hose",
                  },
                  {
                    pitch: -14,
                    yaw: 52,
                    type: "info",
                    text: "Hive row and vehicle approach",
                  },
                ]
              : [],
        });
        viewerRef.current = viewer;
        viewer.on("load", () => {
          if (loadRequestRef.current !== requestId) return;
          setLoading(false);
          availabilityCallbackRef.current?.(true);
        });
        viewer.on("error", () => {
          if (loadRequestRef.current !== requestId) return;
          setLoading(false);
          availabilityCallbackRef.current?.(false);
        });
      },
      [destroyViewer, stopCamera],
    );

    const loadDemo = useCallback(() => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      return loadPanorama(DEMO_PANORAMA, "synthetic", "Demo apiary · orchard block 12");
    }, [loadPanorama]);

    useEffect(() => {
      void loadDemo();
      return () => {
        loadRequestRef.current += 1;
        destroyViewer();
        stopCamera();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      };
    }, [destroyViewer, loadDemo, stopCamera]);

    async function startCamera() {
      setCameraError("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not supported in this browser.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        loadRequestRef.current += 1;
        destroyViewer();
        streamRef.current = stream;
        setMode("camera");
        setLoading(false);
        setSceneLabel("Live surrounding camera");
        sceneKindCallbackRef.current?.("real");
        requestAnimationFrame(() => {
          if (!videoRef.current) return;
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        });
        availabilityCallbackRef.current?.(true);
      } catch (error) {
        setCameraError(
          error instanceof Error ? error.message : "Could not open the camera.",
        );
      }
    }

    useImperativeHandle(ref, () => ({
      captureFrame() {
        if (mode === "camera") {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return null;
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 960 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          return {
            data: canvas.toDataURL("image/jpeg", 0.72).split(",")[1],
            mimeType: "image/jpeg",
          };
        }

        const canvas = containerRef.current?.querySelector("canvas");
        if (!canvas || !viewerRef.current?.isLoaded()) return null;
        try {
          return {
            data: canvas.toDataURL("image/jpeg", 0.68).split(",")[1],
            mimeType: "image/jpeg",
          };
        } catch {
          return null;
        }
      },
      getOrientation() {
        if (mode === "camera" || !viewerRef.current) return null;
        return {
          yaw: Math.round(viewerRef.current.getYaw()),
          pitch: Math.round(viewerRef.current.getPitch()),
        };
      },
    }));

    return (
      <section className="panorama-stage" aria-label="360 degree apiary inspection">
        <div
          ref={containerRef}
          className={`panorama-canvas ${mode === "camera" ? "is-hidden" : ""}`}
        />
        <video
          ref={videoRef}
          className={`inspection-camera ${mode === "camera" ? "is-visible" : ""}`}
          autoPlay
          muted
          playsInline
        />

        <div className="scene-toolbar">
          <span className={`scene-status ${mode}`}>
            <span />
            {sceneLabel}
          </span>
          <div className="scene-actions">
            <button onClick={() => void startCamera()}>
              <Camera size={15} />
              Live camera
            </button>
            <button onClick={() => void loadDemo()}>
              <RotateCcw size={15} />
              Demo 360°
            </button>
            <label>
              <ImagePlus size={15} />
              Replace
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
                  objectUrlRef.current = URL.createObjectURL(file);
                  void loadPanorama(objectUrlRef.current, "real", file.name);
                }}
              />
            </label>
          </div>
        </div>

        {loading && (
          <div className="panorama-loading">
            <ScanLine size={20} />
            Preparing the inspection scene…
          </div>
        )}
        {cameraError && <div className="camera-error">{cameraError}</div>}

        <div className="panorama-hint">
          Drag to look around · scroll to inspect hive details
        </div>
      </section>
    );
  },
));
