'use client'

// eslint-disable-next-line no-var
declare var BarcodeDetector: any

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Flashlight, FlashlightOff, Camera, Check } from 'lucide-react'
import { useLocale } from 'next-intl'

interface BoxCameraScannerProps {
  onDetect: (code: string) => Promise<{ ok: boolean; message: string }>
  onClose: () => void
}

export function BoxCameraScanner({ onDetect, onClose }: BoxCameraScannerProps) {
  const locale = useLocale()
  const t3 = (d: string, e: string, a: string) => (locale === 'ar' ? a : locale === 'en' ? e : d)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scannerRef = useRef<any>(null)
  const lastScannedRef = useRef<string>('')
  const lastScanTimeRef = useRef<number>(0)

  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [hasFlash, setHasFlash] = useState(false)
  const [flashMessage, setFlashMessage] = useState<{ text: string; type: 'ok' | 'error' } | null>(null)
  const [scanCount, setScanCount] = useState(0)

  const handleDetection = useCallback(async (code: string) => {
    const now = Date.now()
    if (code === lastScannedRef.current && now - lastScanTimeRef.current < 2000) return
    lastScannedRef.current = code
    lastScanTimeRef.current = now

    const result = await onDetect(code.trim())
    setFlashMessage({ text: result.message, type: result.ok ? 'ok' : 'error' })
    if (result.ok) setScanCount((c) => c + 1)

    try {
      if (result.ok) {
        new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQBvT18AAA==').play().catch(() => {})
      }
    } catch { /* ignore */ }
  }, [onDetect])

  useEffect(() => {
    if (!flashMessage) return
    const timer = setTimeout(() => setFlashMessage(null), 1800)
    return () => clearTimeout(timer)
  }, [flashMessage])

  useEffect(() => {
    let mounted = true

    async function startCamera() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })

        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream

        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() as any
        if (caps?.torch) setHasFlash(true)

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
        }

        const detector = (typeof BarcodeDetector !== 'undefined')
          ? new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] })
          : null

        if (detector && videoRef.current) {
          const loop = async () => {
            if (!mounted || !videoRef.current) return
            try {
              const barcodes = await detector.detect(videoRef.current)
              if (barcodes.length > 0) {
                const code = barcodes[0].rawValue
                if (code) handleDetection(code)
              }
            } catch { /* ignore frame errors */ }
            if (mounted) requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
        } else {
          const containerId = 'box-qr-scanner-' + Date.now()
          const div = document.createElement('div')
          div.id = containerId
          div.style.display = 'none'
          document.body.appendChild(div)

          const scanner = new Html5Qrcode(containerId)
          scannerRef.current = scanner

          await scanner.start(
            { facingMode: 'environment' },
            { fps: 5, qrbox: { width: 250, height: 150 } },
            (text: string) => { handleDetection(text) },
            () => {},
          )

          if (videoRef.current && stream) {
            videoRef.current.srcObject = stream
            videoRef.current.play()
          }
        }
      } catch (err) {
        if (mounted) setCameraError(true)
      }
    }

    startCamera()

    return () => {
      mounted = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      scannerRef.current?.stop?.().catch(() => {})
    }
  }, [handleDetection])

  const toggleFlash = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !flashOn } as any] })
      setFlashOn(!flashOn)
    } catch { /* not supported */ }
  }, [flashOn])

  return (
    <div className="fixed inset-0 z-[70] bg-[#0a0a1a] flex flex-col" style={{ animation: 'fadeIn 200ms ease-out' }}>
      <div className="flex items-center justify-between px-4 py-3 bg-black/50 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-[#d4a853]" />
          <span className="text-white font-bold text-sm">
            {t3('Karton-Scanner', 'Box Scanner', 'ماسح الكرتونة')}
          </span>
          {scanCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-[#d4a853] text-black text-xs font-bold">
              {scanCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFlash && (
            <button onClick={toggleFlash} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
              {flashOn
                ? <FlashlightOff className="h-4 w-4 text-yellow-400" />
                : <Flashlight className="h-4 w-4 text-white/60" />}
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all">
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {cameraError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <Camera className="h-16 w-16 mx-auto mb-4 text-white/20" />
              <p className="text-white font-bold mb-2">
                {t3('Kamerazugriff erforderlich', 'Camera access required', 'يتطلب الوصول للكاميرا')}
              </p>
              <p className="text-white/50 text-sm">
                {t3('Erlaube den Kamerazugriff um Barcodes zu scannen', 'Allow camera access to scan barcodes', 'السماح بالوصول إلى الكاميرا لمسح الباركود')}
              </p>
            </div>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />

            {cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute inset-0 bg-black/40" />
                <div className="relative z-10 w-72 h-40">
                  <div className="absolute inset-0 border-2 border-white/50 rounded-xl" />
                  <div className="absolute left-2 right-2 h-0.5 bg-[#d4a853] rounded-full animate-scan-line" />
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-[#d4a853] rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-[#d4a853] rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-[#d4a853] rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-[#d4a853] rounded-br-xl" />
                </div>
                <p className="absolute bottom-8 left-0 right-0 text-center text-white/70 text-sm">
                  {t3('Barcode auf das Feld richten', 'Point barcode at the frame', 'وجّه الباركود نحو الإطار')}
                </p>
              </div>
            )}

            {flashMessage && (
              <div className={`absolute top-16 left-4 right-4 z-20 px-4 py-3 rounded-xl text-center font-bold text-sm backdrop-blur-md flex items-center justify-center gap-2 ${
                flashMessage.type === 'ok' ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'
              }`} style={{ animation: 'fadeSlideDown 300ms ease-out' }}>
                {flashMessage.type === 'ok' ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                {flashMessage.text}
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-3 bg-black/50 border-t border-white/10">
        <button
          onClick={onClose}
          className="w-full h-11 rounded-xl bg-[#d4a853] hover:bg-[#c49943] text-black font-bold text-sm flex items-center justify-center gap-2"
        >
          <Check className="h-4 w-4" />
          {t3('Fertig', 'Done', 'تم')}
          {scanCount > 0 && ` (${scanCount})`}
        </button>
      </div>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeSlideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-scan-line { animation: scanLineMove 2s ease-in-out infinite; }
        @keyframes scanLineMove { 0%, 100% { top: 10%; } 50% { top: 85%; } }
      `}</style>
    </div>
  )
}
