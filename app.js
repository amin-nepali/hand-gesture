(() => {
  "use strict";

  const video = document.querySelector("#video");
  const canvas = document.querySelector("#canvas");
  const context = canvas.getContext("2d");
  const stage = document.querySelector("#stage");
  const cameraStatus = document.querySelector("#camera-status");
  const cameraStatusText = document.querySelector("#camera-status-text");
  const handCount = document.querySelector("#hand-count");
  const trackingState = document.querySelector("#tracking-state");
  const fpsValue = document.querySelector("#fps-value");
  const resolutionLabel = document.querySelector("#resolution-label");
  const messageTitle = document.querySelector("#message-title");
  const messageCopy = document.querySelector("#message-copy");
  const messageIcon = document.querySelector("#message-icon");
  const retryButton = document.querySelector("#retry-button");
  const cameraButton = document.querySelector("#camera-button");
  const mirrorButton = document.querySelector("#mirror-button");
  const landmarksButton = document.querySelector("#landmarks-button");
  const snapshotButton = document.querySelector("#snapshot-button");
  const cameraButtonTitle = document.querySelector("#camera-button-title");
  const cameraButtonHint = document.querySelector("#camera-button-hint");
  const cameraSwitch = document.querySelector("#camera-switch");
  const mirrorSwitch = document.querySelector("#mirror-switch");
  const landmarksSwitch = document.querySelector("#landmarks-switch");
  const colorName = document.querySelector("#color-name");
  const airCursor = document.querySelector("#air-cursor");
  const airCursorLabel = document.querySelector("#air-cursor-label");

  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
    [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
  ];
  const palette = ["#b49aff", "#65e6c2", "#ff8fab", "#ffd479"];
  const particles = [];
  const pinchStates = new Map();
  let stream = null;
  let hands = null;
  let rafId = 0;
  let processing = false;
  let isRunning = false;
  let isStarting = false;
  let trackingFailed = false;
  let mirrored = true;
  let showLandmarks = true;
  let colorIndex = 0;
  let latestResults = null;
  let lastVideoTime = -1;
  let lastPinchAt = 0;
  let lastFrameAt = 0;
  let fps = 0;
  let resizeObserver = null;
  let cursorX = 0;
  let cursorY = 0;
  let cursorReady = false;
  let hoveredGestureTarget = null;

  const activeColor = () => palette[colorIndex];

  function setCameraStatus(state, text) {
    cameraStatus.classList.remove("is-live", "is-error");
    if (state === "live") cameraStatus.classList.add("is-live");
    if (state === "error") cameraStatus.classList.add("is-error");
    cameraStatusText.textContent = text;
  }

  function setSwitch(button, switchElement, enabled) {
    button.setAttribute("aria-pressed", String(enabled));
    switchElement.classList.toggle("is-on", enabled);
  }

  function setMessage(title, copy, error = false) {
    messageTitle.textContent = title;
    messageCopy.textContent = copy;
    retryButton.classList.toggle("hidden", !error);
    messageIcon.classList.toggle("is-error", error);
  }

  function updateCanvasSize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pointFor(landmark) {
    const bounds = stage.getBoundingClientRect();
    const sourceWidth = video.videoWidth || bounds.width;
    const sourceHeight = video.videoHeight || bounds.height;
    const scale = Math.max(bounds.width / sourceWidth, bounds.height / sourceHeight);
    const offsetX = (bounds.width - sourceWidth * scale) / 2;
    const offsetY = (bounds.height - sourceHeight * scale) / 2;
    const sourceX = (mirrored ? 1 - landmark.x : landmark.x) * sourceWidth;
    return { x: sourceX * scale + offsetX, y: landmark.y * sourceHeight * scale + offsetY };
  }

  function drawSkeleton(landmarks, color) {
    const points = landmarks.map(pointFor);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.strokeStyle = color;
    context.globalAlpha = 0.76;
    context.lineWidth = 1.7;
    context.beginPath();
    for (const [start, end] of connections) {
      context.moveTo(points[start].x, points[start].y);
      context.lineTo(points[end].x, points[end].y);
    }
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;

    for (let i = 0; i < points.length; i++) {
      const tip = [4, 8, 12, 16, 20].includes(i);
      const radius = tip ? 4 : (i === 0 ? 3.3 : 2.4);
      context.beginPath();
      context.arc(points[i].x, points[i].y, radius, 0, Math.PI * 2);
      context.fillStyle = "#f5efff";
      context.shadowColor = color;
      context.shadowBlur = tip ? 15 : 7;
      context.fill();
      context.shadowBlur = 0;
    }
    return points;
  }

  function addParticles(point, color) {
    for (let i = 0; i < 2; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.45 + Math.random() * 1.4;
      particles.push({
        x: point.x, y: point.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        radius: 1 + Math.random() * 2.3, life: 1, color
      });
    }
    if (particles.length > 120) particles.splice(0, particles.length - 120);
  }

  function drawParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.x += particle.vx * delta * 0.06;
      particle.y += particle.vy * delta * 0.06;
      particle.life -= delta * 0.001;
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      context.globalAlpha = particle.life;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius * particle.life, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;
  }

  function cycleColor() {
    colorIndex = (colorIndex + 1) % palette.length;
    const swatches = document.querySelectorAll(".swatch");
    swatches.forEach((swatch, index) => {
      const selected = index === colorIndex;
      swatch.classList.toggle("selected", selected);
      swatch.setAttribute("aria-pressed", String(selected));
    });
    colorName.textContent = ["Electric lilac", "Mint pulse", "Soft coral", "Solar gold"][colorIndex];
  }

  function updateAirCursor(landmarks, pinching) {
    const screenX = (mirrored ? 1 - landmarks[8].x : landmarks[8].x) * window.innerWidth;
    const screenY = landmarks[8].y * window.innerHeight;
    if (!cursorReady) {
      cursorX = screenX;
      cursorY = screenY;
      cursorReady = true;
    } else {
      cursorX += (screenX - cursorX) * 0.4;
      cursorY += (screenY - cursorY) * 0.4;
    }
    airCursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
    airCursor.classList.remove("is-hidden");
    airCursor.classList.toggle("is-pinching", pinching);
    airCursorLabel.textContent = pinching ? "CLICK" : "POINT";
    const target = getButtonAtCursor();
    if (hoveredGestureTarget !== target) {
      if (hoveredGestureTarget) hoveredGestureTarget.classList.remove("is-air-hovered");
      hoveredGestureTarget = target;
      if (hoveredGestureTarget) hoveredGestureTarget.classList.add("is-air-hovered");
    }
  }

  function getButtonAtCursor() {
    const target = document.elementFromPoint(cursorX, cursorY);
    const button = target && target.closest("button:not(:disabled), [role='button']:not([aria-disabled='true'])");
    return button && !button.disabled ? button : null;
  }

  function activateAtCursor(points) {
    const target = document.elementFromPoint(cursorX, cursorY);
    const button = getButtonAtCursor();
    if (button) {
      button.click();
      airCursor.classList.add("is-clicked");
      window.setTimeout(() => airCursor.classList.remove("is-clicked"), 180);
      return true;
    }
    if (target && stage.contains(target)) {
      cycleColor();
      addParticles(points[8], activeColor());
      return true;
    }
    return false;
  }

  function detectPinch(landmarks, points, handIndex) {
    const dx = landmarks[4].x - landmarks[8].x;
    const dy = landmarks[4].y - landmarks[8].y;
    const distance = Math.hypot(dx, dy);
    const wasPinching = pinchStates.get(handIndex) || false;
    const pinching = distance < (wasPinching ? 0.075 : 0.055);
    const now = performance.now();
    if (handIndex === 0 && pinching && !wasPinching && now - lastPinchAt > 550) {
      activateAtCursor(points);
      addParticles({ x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 }, activeColor());
      lastPinchAt = now;
    }
    pinchStates.set(handIndex, pinching);
    if (pinching) {
      const middle = { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 };
      context.beginPath();
      context.moveTo(points[4].x, points[4].y);
      context.lineTo(points[8].x, points[8].y);
      context.strokeStyle = activeColor();
      context.lineWidth = 2;
      context.globalAlpha = 0.9;
      context.shadowColor = activeColor();
      context.shadowBlur = 14;
      context.stroke();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
      context.beginPath();
      context.arc(middle.x, middle.y, 11 + Math.sin(performance.now() / 90) * 2, 0, Math.PI * 2);
      context.strokeStyle = activeColor();
      context.lineWidth = 1.5;
      context.stroke();
      addParticles(middle, activeColor());
    }
    return pinching;
  }

  function render(now) {
    rafId = requestAnimationFrame(render);
    if (!isRunning) return;
    updateCanvasSize();
    const bounds = stage.getBoundingClientRect();
    context.clearRect(0, 0, bounds.width, bounds.height);
    const delta = lastFrameAt ? Math.min(now - lastFrameAt, 50) : 16.7;
    lastFrameAt = now;
    fps = fps ? fps * 0.88 + (1000 / Math.max(delta, 1)) * 0.12 : 1000 / Math.max(delta, 1);
    fpsValue.textContent = String(Math.round(fps));

    const results = latestResults;
    const handsFound = results && results.multiHandLandmarks ? results.multiHandLandmarks : [];
    handCount.textContent = String(handsFound.length);
    trackingState.textContent = handsFound.length ? "LOCKED" : "SEARCHING";
    if (handsFound.length === 0) {
      pinchStates.clear();
      cursorReady = false;
      airCursor.classList.add("is-hidden");
      if (hoveredGestureTarget) hoveredGestureTarget.classList.remove("is-air-hovered");
      hoveredGestureTarget = null;
    }
    handsFound.forEach((landmarks, index) => {
      const points = showLandmarks ? drawSkeleton(landmarks, activeColor()) : landmarks.map(pointFor);
      if (index === 0) updateAirCursor(landmarks, pinchStates.get(index) || false);
      detectPinch(landmarks, points, index);
      if (index === 0) {
        airCursor.classList.toggle("is-pinching", pinchStates.get(index) || false);
        airCursorLabel.textContent = pinchStates.get(index) ? "CLICK" : "POINT";
      }
    });
    drawParticles(delta);

    if (!trackingFailed && hands && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !processing && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      processing = true;
      const trackerForFrame = hands;
      trackerForFrame.send({ image: video })
        .catch((error) => {
          if (hands !== trackerForFrame || !isRunning) return;
          console.error("Hand tracking frame failed:", error);
          trackingFailed = true;
          void stopCamera().then(() => {
            setCameraStatus("error", "Tracking interrupted");
            setMessage("Tracking was interrupted", "Restart the camera to reconnect hand tracking.", true);
          });
        })
        .finally(() => {
          if (hands === trackerForFrame) processing = false;
        });
    }
  }

  function createTracker() {
    if (typeof window.Hands !== "function") {
      throw new Error("MediaPipe Hands did not load. Check your internet connection and reload the page.");
    }
    const tracker = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    tracker.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.55
    });
    tracker.onResults((results) => {
      latestResults = results;
      if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
        handCount.textContent = String(results.multiHandLandmarks.length);
      }
    });
    return tracker;
  }

  function getCameraError(error) {
    if (error && error.name === "NotAllowedError") return "Camera permission was denied. Allow camera access in your browser, then try again.";
    if (error && error.name === "NotFoundError") return "No camera was found. Connect a camera and try again.";
    if (error && error.name === "NotReadableError") return "Your camera is already in use by another app. Close it and try again.";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "Camera access requires HTTPS or localhost in a modern browser.";
    if (error instanceof Error && error.message) return error.message;
    return "We couldn't start the camera. Check your browser permissions and try again.";
  }

  async function startCamera() {
    if (isStarting || isRunning) return;
    isStarting = true;
    cameraButton.disabled = true;
    retryButton.classList.add("hidden");
    setCameraStatus("loading", "Requesting camera…");
    setMessage("Warming up your camera", "Allow camera access when your browser asks.");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access requires HTTPS or localhost in a modern browser.");
      }
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        }
      });
      stream = newStream;
      video.srcObject = stream;
      await video.play();
      resolutionLabel.textContent = `${video.videoWidth} × ${video.videoHeight}`;
      hands = createTracker();
      isRunning = true;
      trackingFailed = false;
      latestResults = null;
      lastVideoTime = -1;
      stage.classList.add("is-active");
      cameraButtonTitle.textContent = "Camera on";
      cameraButtonHint.textContent = "Your camera is active";
      setSwitch(cameraButton, cameraSwitch, true);
      setCameraStatus("live", "Camera live");
      snapshotButton.disabled = false;
      trackingState.textContent = "SEARCHING";
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(render);
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(updateCanvasSize);
        resizeObserver.observe(stage);
      }
    } catch (error) {
      console.error("Unable to start Gesture Studio:", error);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      isRunning = false;
      stage.classList.remove("is-active");
      setCameraStatus("error", "Camera unavailable");
      const detail = getCameraError(error);
      setMessage("Camera couldn’t start", detail, true);
      cameraButtonTitle.textContent = "Camera off";
      cameraButtonHint.textContent = "Tap to try again";
      setSwitch(cameraButton, cameraSwitch, false);
      snapshotButton.disabled = true;
    } finally {
      isStarting = false;
      cameraButton.disabled = false;
    }
  }

  async function stopCamera() {
    if (isStarting) return;
    isRunning = false;
    cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    if (hands) {
      const tracker = hands;
      hands = null;
      try {
        await tracker.close();
      } catch (error) {
        console.error("Unable to close the hand tracker cleanly:", error);
      }
    }
    latestResults = null;
    processing = false;
    pinchStates.clear();
    airCursor.classList.add("is-hidden");
    cursorReady = false;
    if (hoveredGestureTarget) hoveredGestureTarget.classList.remove("is-air-hovered");
    hoveredGestureTarget = null;
    handCount.textContent = "0";
    fpsValue.textContent = "—";
    trackingState.textContent = "PAUSED";
    resolutionLabel.textContent = "— × —";
    stage.classList.remove("is-active");
    setCameraStatus("loading", "Camera paused");
    setMessage("You’re off camera", "Turn your camera back on whenever you’re ready.");
    cameraButtonTitle.textContent = "Camera off";
    cameraButtonHint.textContent = "Tap to turn it back on";
    setSwitch(cameraButton, cameraSwitch, false);
    snapshotButton.disabled = true;
    updateCanvasSize();
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function captureSnapshot() {
    if (!isRunning || !video.videoWidth) return;
    const output = document.createElement("canvas");
    const bounds = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    output.width = Math.round(bounds.width * dpr);
    output.height = Math.round(bounds.height * dpr);
    const outputContext = output.getContext("2d");
    const scale = Math.max(output.width / video.videoWidth, output.height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    outputContext.save();
    if (mirrored) {
      outputContext.translate(output.width, 0);
      outputContext.scale(-1, 1);
    }
    outputContext.drawImage(video, (output.width - drawWidth) / 2, (output.height - drawHeight) / 2, drawWidth, drawHeight);
    outputContext.restore();
    outputContext.drawImage(canvas, 0, 0, output.width, output.height);
    if (showLandmarks && latestResults && latestResults.multiHandLandmarks) {
      latestResults.multiHandLandmarks.forEach((landmarks) => {
        const points = landmarks.map((landmark) => {
          const sourceX = (mirrored ? 1 - landmark.x : landmark.x) * video.videoWidth;
          return {
            x: sourceX * scale + (output.width - drawWidth) / 2,
            y: landmark.y * video.videoHeight * scale + (output.height - drawHeight) / 2
          };
        });
        outputContext.lineCap = "round";
        outputContext.lineJoin = "round";
        outputContext.strokeStyle = activeColor();
        outputContext.lineWidth = 1.7 * dpr;
        outputContext.shadowColor = activeColor();
        outputContext.shadowBlur = 12 * dpr;
        outputContext.beginPath();
        connections.forEach(([start, end]) => {
          outputContext.moveTo(points[start].x, points[start].y);
          outputContext.lineTo(points[end].x, points[end].y);
        });
        outputContext.stroke();
        outputContext.shadowBlur = 0;
        points.forEach((point, index) => {
          outputContext.beginPath();
          outputContext.arc(point.x, point.y, ([4, 8, 12, 16, 20].includes(index) ? 4 : 2.4) * dpr, 0, Math.PI * 2);
          outputContext.fillStyle = "#f5efff";
          outputContext.fill();
        });
      });
    }
    output.toBlob((blob) => {
      if (!blob) {
        console.error("Snapshot could not be encoded.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `gesture-studio-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  cameraButton.addEventListener("click", () => {
    if (isRunning) stopCamera();
    else startCamera();
  });
  retryButton.addEventListener("click", async () => {
    if (isRunning) await stopCamera();
    await startCamera();
  });
  mirrorButton.addEventListener("click", () => {
    mirrored = !mirrored;
    video.style.transform = mirrored ? "scaleX(-1)" : "none";
    setSwitch(mirrorButton, mirrorSwitch, mirrored);
  });
  landmarksButton.addEventListener("click", () => {
    showLandmarks = !showLandmarks;
    setSwitch(landmarksButton, landmarksSwitch, showLandmarks);
  });
  document.querySelectorAll(".swatch").forEach((swatch, index) => {
    swatch.addEventListener("click", () => {
      colorIndex = index;
      document.querySelectorAll(".swatch").forEach((item, itemIndex) => {
        const selected = itemIndex === colorIndex;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      colorName.textContent = swatch.dataset.name;
    });
  });
  snapshotButton.addEventListener("click", captureSnapshot);
  window.addEventListener("beforeunload", () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (hands) hands.close();
  });

  video.style.transform = "scaleX(-1)";
  startCamera();
})();
