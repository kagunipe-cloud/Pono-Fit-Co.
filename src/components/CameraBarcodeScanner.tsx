"use client";

import { useRef, useCallback, useState } from "react";
import type { RefObject } from "react";
import { useZxing } from "react-zxing";

type CameraBarcodeScannerProps = {
  onScan: (barcode: string) => void;
  onClose: () => void;
  /** Cooldown in ms after a scan before accepting the same barcode again (default 2500). */
  cooldownMs?: number;
};

/**
 * Camera-based barcode scanner using react-zxing (ZXing).
 * Prefer rear camera on mobile (facingMode: "environment") for scanning products.
 */
export default function CameraBarcodeScanner({ onScan, onClose, cooldownMs = 2500 }: CameraBarcodeScannerProps) {
  const lastScanned = useRef<string | null>(null);
  const lastTime = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);

  const handleDecode = useCallback(
    (result: { getText: () => string }) => {
      const barcode = result.getText()?.trim();
      if (!barcode) return;
      const now = Date.now();
      if (lastScanned.current === barcode && now - lastTime.current < cooldownMs) return;
      lastScanned.current = barcode;
      lastTime.current = now;
      onScan(barcode);
    },
    [onScan, cooldownMs]
  );

  const { ref } = useZxing({
    onDecodeResult(result) {
      handleDecode(result);
    },
    onError(err: unknown) {
      setError(err instanceof Error ? err.message : "Camera error");
    },
    constraints: {
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    timeBetweenDecodingAttempts: 300,
  });

  return (
    <div className="rounded-xl overflow-hidden border border-stone-200 bg-black">
      <div className="relative aspect-[4/3] max-h-[50vh] w-full">
        <video
          ref={ref as RefObject<HTMLVideoElement>}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
            <p className="text-center text-sm text-white">{error}</p>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 flex justify-center gap-2 p-3 bg-gradient-to-t from-black/80 to-transparent">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/90 text-stone-800 text-sm font-medium hover:bg-white"
          >
            Cancel
          </button>
        </div>
      </div>
      <p className="p-2 text-center text-xs text-stone-400 bg-stone-900 text-white">
        Point your camera at a barcode
      </p>
      <p className="px-3 pb-2 text-center text-[11px] text-stone-500 bg-stone-900 text-white">
        First time? Allow camera access when your browser asks — we only use it to read barcodes.
      </p>
    </div>
  );
}
