# Gesture Studio

A lightweight, static webcam hand-tracking studio. MediaPipe Hands tracks up to two hands in the browser and draws a live landmark mesh, glowing fingertips, and pinch-triggered particles. Camera frames are processed locally and are not uploaded.

## Project structure

```text
hand-gesture/
├── index.html
├── style.css
├── app.js
└── README.md
```

## Run locally

Camera access requires a secure browser context: use `https://` or `localhost`. Opening `index.html` directly as a `file://` URL will generally prevent camera access. An internet connection is also needed to load the MediaPipe and Tailwind CDN assets.

1. Open this folder in VS Code.
2. Start a local development server, for example with the **Live Server** extension: right-click `index.html` and choose **Open with Live Server**.
3. Allow camera access when the browser prompts. The app requests the camera automatically when it loads.

Alternatively, if Python is installed, run `python -m http.server 8000` in this directory and open `http://localhost:8000`.

## Use

- Move up to two hands into view to see the tracking mesh.
- Point with your index finger to move the on-screen air cursor.
- Pinch your thumb and index finger to click buttons, switches, and color swatches. Pinch over the camera preview to cycle the glow color and emit particles.
- Use the studio controls to pause the camera, toggle the mirrored view or landmarks, select a color, and capture a PNG snapshot.
- Camera permission or device errors appear in the preview with a retry action.

The camera stream and tracking run in the browser. No video is sent to a server. Use a current desktop or mobile browser with webcam support.
