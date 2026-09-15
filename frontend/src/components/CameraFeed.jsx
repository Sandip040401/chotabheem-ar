import { forwardRef, useEffect, useState } from 'react'

/**
 * Renders the live camera feed as a full-bleed <video> background and
 * reports readiness/errors upward. facingMode "environment" targets the
 * rear camera on phones (better for pointing the asset "into the world");
 * it falls back automatically on devices/browsers that only expose one camera.
 */
const CameraFeed = forwardRef(function CameraFeed(
  { facingMode, selectedCamera, cameraResolution, trackingFps = 20, trackingResolution = '320x240', onReady, onError, onHandResults },
  videoRef
) {
  const [stream, setStream] = useState(null)

  useEffect(() => {
    let cancelled = false
    let localStream = null

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.('This browser doesn\u2019t support camera access (getUserMedia).')
        return
      }
      try {
        const [targetWidth, targetHeight] =
          cameraResolution === '1080p' ? [1920, 1080] : cameraResolution === '480p' ? [640, 480] : [1280, 720]

        // Try with selectedCamera if specified, otherwise ideal facingMode
        let constraints = selectedCamera
          ? { video: { deviceId: { ideal: selectedCamera }, width: { ideal: targetWidth }, height: { ideal: targetHeight } }, audio: false }
          : { video: { facingMode: { ideal: facingMode }, width: { ideal: targetWidth }, height: { ideal: targetHeight } }, audio: false }

        try {
          localStream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch (firstErr) {
          console.warn('Initial camera constraint failed, retrying with default video stream...', firstErr)
          // Fallback to simple video: true if constraints failed
          localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }

        if (cancelled) {
          localStream?.getTracks().forEach((t) => t.stop())
          return
        }
        setStream(localStream)
        if (videoRef.current) {
          videoRef.current.srcObject = localStream
          await videoRef.current.play().catch(() => {})
        }
        onReady?.()
      } catch (err) {
        if (cancelled) return
        const message =
          err?.name === 'NotAllowedError'
            ? 'Camera access was denied. Allow camera permission and try again.'
            : err?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : `Couldn\u2019t start the camera (${err?.message || err?.name || 'unknown error'}).`
        onError?.(message)
      }
    }

    start()

    return () => {
      cancelled = true
      localStream?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [facingMode, selectedCamera, cameraResolution])

  // Process video stream for hand tracking using MediaPipe Hands
  useEffect(() => {
    if (!stream || !videoRef.current || !window.Hands) return

    let active = true
    let hands
    let isProcessing = false

    // Fast offscreen downsampling canvas to prevent MediaPipe CPU/GPU bottleneck
    const [procW, procH] = trackingResolution === '480x360' ? [480, 360] : trackingResolution === '360x270' ? [360, 270] : [320, 240]
    const procCanvas = document.createElement('canvas')
    procCanvas.width = procW
    procCanvas.height = procH
    const procCtx = procCanvas.getContext('2d', { willReadFrequently: true, alpha: false })

    try {
      hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      })

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, // Lite model for ultra-low latency execution
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      hands.onResults((results) => {
        isProcessing = false
        if (!active) return
        onHandResults?.(results)
      })
    } catch (e) {
      console.error('Failed to initialize MediaPipe Hands:', e)
      return
    }

    let animationFrameId
    let lastTime = 0
    const frameInterval = Math.max(16, Math.floor(1000 / (trackingFps || 20)))

    async function processVideo(now) {
      if (!active) return

      // Throttle frames and enforce isProcessing lock to prevent queue stacking
      if (!isProcessing && now - lastTime >= frameInterval) {
        const video = videoRef.current
        if (video && video.readyState >= 2 && procCtx) {
          try {
            isProcessing = true
            procCtx.drawImage(video, 0, 0, procW, procH)
            await hands.send({ image: procCanvas })
            lastTime = now
          } catch (err) {
            isProcessing = false
          }
        }
      }
      animationFrameId = requestAnimationFrame(processVideo)
    }

    animationFrameId = requestAnimationFrame(processVideo)

    return () => {
      active = false
      isProcessing = false
      cancelAnimationFrame(animationFrameId)
      try {
        hands.close()
      } catch (e) {
        // Ignore close errors
      }
    }
  }, [stream, onHandResults, videoRef, trackingFps, trackingResolution])

  return (
    <video
      ref={videoRef}
      className="camera-feed"
      playsInline
      muted
      autoPlay
    />
  )
})

export default CameraFeed
