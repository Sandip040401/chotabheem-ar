# Webcam AR Viewer

A React app that opens your camera and overlays an interactive 3D asset
(currently `apple.glb`) on top of the live feed, like a filter — the object
sits on screen with you, and you can rotate, scale, and reposition it with
touch or mouse.

This uses **getUserMedia + three.js**, not device WebXR, so it works in any
modern browser on desktop or mobile (no "AR-capable phone" requirement).
It's a camera overlay, not true surface-anchored placement.

## Run it

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. Camera access requires a **secure
context** — `localhost` works automatically. To test on your phone:

- Same wifi network: the dev server prints a network URL, but most mobile
  browsers still require HTTPS for camera access off localhost. Use a
  tunnel such as `npx localtunnel --port 5173` or `ngrok http 5173`, or
- Deploy the built `dist/` folder anywhere with HTTPS (Vercel, Netlify,
  GitHub Pages, etc.) — `npm run build` then upload `dist/`.

## Controls (once the camera is live)

| Gesture | Effect |
|---|---|
| Drag (1 finger / mouse) | Rotate the object |
| Pinch (2 fingers) / scroll wheel | Scale the object |
| Two-finger drag | Move the object |
| Reset position | Snap back to center, default size/rotation |
| Flip (top right) | Switch between rear and front camera |

## Adding more assets

Drop additional `.glb` files into `public/assets/` and add an entry to the
`ASSETS` array at the top of `src/App.jsx`:

```js
const ASSETS = [
  { id: 'apple', label: 'Apple', url: '/assets/apple.glb' },
  { id: 'banana', label: 'Banana', url: '/assets/banana.glb' },
]
```

The rest of the app (start screen preview, AR gestures, HUD) is asset-
agnostic. A simple asset picker on the start screen is a natural next step
once there's more than one — happy to wire that up.

## Project structure

```
src/
  App.jsx                  state machine: idle -> requesting -> active/error
  App.css                  layout + HUD styling
  components/
    CameraFeed.jsx          getUserMedia lifecycle, renders <video>
    ARScene.jsx             transparent three.js canvas, gesture handling
    ViewfinderFrame.jsx     corner-bracket frame (visual signature)
public/
  assets/apple.glb          the 3D asset
```
