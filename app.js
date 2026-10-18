(() => {
  "use strict";

  const camera = document.querySelector("#camera");
  const cameraFrame = document.querySelector("#camera-frame");
  const cameraStatus = document.querySelector("#camera-status");
  const cameraQuality = document.querySelector("#camera-quality");
  const promptTitle = document.querySelector("#prompt-title");
  const promptCopy = document.querySelector("#prompt-copy");
  const feedback = document.querySelector("#feedback");
  const loginButton = document.querySelector("#login-button");
  const enrollButton = document.querySelector("#enroll-button");
  const deleteButton = document.querySelector("#delete-profile");
  const loginTab = document.querySelector("#login-tab");
  const enrollTab = document.querySelector("#enroll-tab");
  const loginPanel = document.querySelector("#login-panel");
  const enrollPanel = document.querySelector("#enroll-panel");
  const consent = document.querySelector("#consent");
  const displayName = document.querySelector("#display-name");
  const destination = document.querySelector("#destination");
  const profileStorageKey = "facekey-profile";
  const captureCount = 3;
  let stream = null;
  let modelsReady = false;
  let modelsLoading = null;
  let busy = false;
  let mode = "login";

  async function loadModels() {
    if (modelsReady) return;
    if (!window.faceapi) throw new Error("The face matching library didn’t load. Check your connection and reload.");
    if (!modelsLoading) {
      modelsLoading = Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models")
      ]).then(() => { modelsReady = true; });
    }
    await modelsLoading;
  }

  function setFeedback(message, kind = "") {
    feedback.textContent = message;
    feedback.className = `form-feedback${kind ? ` is-${kind}` : ""}`;
  }

  function setCameraStatus(status, text) {
    cameraStatus.classList.toggle("is-on", status === "on");
    cameraStatus.classList.toggle("is-error", status === "error");
    cameraStatus.querySelector("span").textContent = text;
  }

  async function startCamera() {
    if (stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access requires HTTPS or localhost in a modern browser.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 720 },
        height: { ideal: 540 },
        frameRate: { ideal: 24, max: 30 }
      }
    });
    camera.srcObject = stream;
    await camera.play();
    cameraFrame.classList.add("is-live");
    setCameraStatus("on", "CAMERA READY");
    promptTitle.textContent = "Center your face";
    promptCopy.textContent = "Look at the camera and keep your face in the frame.";
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    camera.srcObject = null;
    cameraFrame.classList.remove("is-live");
    cameraQuality.textContent = "";
    setCameraStatus("off", "CAMERA OFF");
    promptTitle.textContent = "Camera is off";
    promptCopy.textContent = "Start when you’re ready to continue.";
  }

  function explainCameraError(error) {
    if (error?.name === "NotAllowedError") return "Camera permission was denied. Allow access in your browser, then try again.";
    if (error?.name === "NotFoundError") return "No camera was found. Connect a camera and try again.";
    if (error?.name === "NotReadableError") return "Your camera is in use by another app. Close that app and try again.";
    if (!navigator.mediaDevices?.getUserMedia) return "Camera access requires HTTPS or localhost in a modern browser.";
    if (error instanceof Error) return error.message;
    return "We couldn’t start the camera. Check permissions and try again.";
  }

  function validateDestination() {
    let url;
    try {
      url = new URL(destination.value.trim());
    } catch {
      throw new Error("Enter a complete destination URL, such as https://example.com.");
    }
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error("Destination must use HTTPS (HTTP is allowed only for local testing).");
    }
    if (url.username || url.password) throw new Error("Destination URLs must not contain a username or password.");
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("For safety, external destinations must use HTTPS.");
    }
    return url;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function captureDescriptor(index) {
    let result;
    for (let attempt = 0; attempt < 12; attempt++) {
      result = await faceapi
        .detectSingleFace(camera, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.62 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (result && result.detection.score >= 0.68) break;
      await wait(160);
    }
    if (!result || result.detection.score < 0.68) {
      cameraQuality.textContent = "FACE NOT CLEAR";
      throw new Error("Keep one face centered in good lighting, then try again.");
    }
    cameraQuality.textContent = `SAMPLE ${index + 1} OF ${captureCount}`;
    return Array.from(result.descriptor);
  }

  function averageDescriptors(samples) {
    const length = samples[0].length;
    return Array.from({ length }, (_unused, index) => (
      samples.reduce((sum, sample) => sum + sample[index], 0) / samples.length
    ));
  }

  async function captureSamples() {
    const samples = [];
    for (let index = 0; index < captureCount; index++) {
      if (index > 0) await wait(650);
      samples.push(await captureDescriptor(index));
    }
    return averageDescriptors(samples);
  }

  async function postJson(path, data) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The server couldn’t complete that request.");
    return result;
  }

  async function runAction(action) {
    if (busy) return;
    busy = true;
    loginButton.disabled = true;
    enrollButton.disabled = true;
    cameraQuality.textContent = "PREPARING CAMERA";
    setFeedback("Preparing face matching…");
    try {
      validateDestination();
      await loadModels();
      await startCamera();
      cameraQuality.textContent = "LOOK AT THE CAMERA";
      setFeedback(action === "enroll" ? "Capturing your face template. Please stay still…" : "Checking your face. Please stay still…");
      const descriptor = await captureSamples();
      cameraQuality.textContent = "SAMPLE READY";

      if (action === "enroll") {
        const result = await postJson("/api/enroll", {
          displayName: displayName.value,
          descriptor,
          consent: consent.checked
        });
        localStorage.setItem(profileStorageKey, JSON.stringify({
          id: result.id,
          token: result.managementToken,
          name: result.displayName
        }));
        syncDeleteButton();
        setActiveMode("login");
        setFeedback(`Face profile created for ${result.displayName}. You can now sign in.`, "success");
      } else {
        const result = await postJson("/api/verify", { descriptor });
        setFeedback(`Welcome, ${result.displayName}. Redirecting…`, "success");
        window.location.assign(validateDestination().href);
      }
    } catch (error) {
      console.error("FaceKey action failed:", error);
      if (error?.name === "NotAllowedError" || error?.name === "NotFoundError" || error?.name === "NotReadableError") {
        setCameraStatus("error", "CAMERA ERROR");
      }
      setFeedback(explainCameraError(error), "error");
      if (error?.name === "NotAllowedError" || error?.name === "NotFoundError" || error?.name === "NotReadableError") {
        stopCamera();
        setCameraStatus("error", "CAMERA ERROR");
      }
    } finally {
      busy = false;
      loginButton.disabled = mode !== "login";
      updateEnrollButton();
      if (stream) cameraQuality.textContent = "CAMERA READY";
    }
  }

  function updateEnrollButton() {
    enrollButton.disabled = busy || !consent.checked || displayName.value.trim().length === 0;
  }

  function setActiveMode(nextMode) {
    mode = nextMode;
    const loginActive = nextMode === "login";
    loginTab.classList.toggle("is-active", loginActive);
    enrollTab.classList.toggle("is-active", !loginActive);
    loginTab.setAttribute("aria-selected", String(loginActive));
    enrollTab.setAttribute("aria-selected", String(!loginActive));
    loginPanel.hidden = !loginActive;
    enrollPanel.hidden = loginActive;
    document.querySelector(".auth-card-header h2").textContent = loginActive ? "Welcome back" : "Create your profile";
    document.querySelector(".auth-card-header p").textContent = loginActive
      ? "Look into your camera to continue."
      : "Enroll a face template with your explicit consent.";
    setFeedback("");
    updateEnrollButton();
  }

  function syncDeleteButton() {
    const profile = readSavedProfile();
    deleteButton.hidden = !profile;
  }

  function readSavedProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem(profileStorageKey) || "null");
      if (profile && typeof profile.id === "string" && typeof profile.token === "string") return profile;
    } catch (error) {
      console.error("Saved profile information could not be read:", error);
    }
    return null;
  }

  async function deleteSavedProfile() {
    const profile = readSavedProfile();
    if (!profile || !window.confirm("Permanently delete your saved face template? This cannot be undone.")) return;
    deleteButton.disabled = true;
    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(profile.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${profile.token}` }
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Your face profile couldn’t be deleted.");
      }
      localStorage.removeItem(profileStorageKey);
      syncDeleteButton();
      setFeedback("Your saved face template has been deleted.", "success");
    } catch (error) {
      console.error("Unable to delete the saved face profile:", error);
      setFeedback(error.message || "Your face profile couldn’t be deleted.", "error");
    } finally {
      deleteButton.disabled = false;
    }
  }

  loginTab.addEventListener("click", () => setActiveMode("login"));
  enrollTab.addEventListener("click", () => setActiveMode("enroll"));
  loginButton.addEventListener("click", () => runAction("login"));
  enrollButton.addEventListener("click", () => runAction("enroll"));
  deleteButton.addEventListener("click", deleteSavedProfile);
  displayName.addEventListener("input", updateEnrollButton);
  consent.addEventListener("change", updateEnrollButton);
  document.querySelector("#disclaimer-button").addEventListener("click", () => {
    window.alert("FaceKey is an experimental face-matching demo, not a secure authentication product or an implementation of Apple Face ID. Face templates are sensitive biometric data. Do not enroll a face unless you have consent and understand the privacy and spoofing risks. Do not use this demo to protect sensitive accounts. The server encrypts templates at rest; keep the encryption key secret and maintain secure database backups.");
  });
  window.addEventListener("pagehide", stopCamera);

  syncDeleteButton();
  loadModels().then(() => {
    loginButton.disabled = false;
    setFeedback("Face matching is ready. Start when you’re ready.");
  }).catch((error) => {
    console.error("Unable to load face matching models:", error);
    setFeedback("Face matching models could not be loaded. Check your connection and reload.", "error");
  });
})();
