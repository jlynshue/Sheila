# Third-Party Licenses

This file documents third-party code included in this repository (beyond npm/pip
dependencies which carry their own LICENSE files in node_modules/ and .venv/).

---

## kyutai-labs/unmute

**Files:** `apps/desktop/public/audio-output-processor.js`
**Source:** https://github.com/kyutai-labs/unmute/blob/main/frontend/public/audio-output-processor.js
**License:** MIT

```
MIT License

Copyright (c) 2025 kyutai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## opus-recorder

**Files:** `apps/desktop/public/encoderWorker.min.js`, `apps/desktop/public/decoderWorker.min.js`, `apps/desktop/public/decoderWorker.min.wasm`
**Source:** https://github.com/nickinchrismath/opus-recorder (npm: opus-recorder@^8.0.5)
**Author:** Chris Rudmin
**License:** MIT

These are pre-built worker bundles from the opus-recorder npm package, copied
into `public/` so the Electron renderer can load them as Web Workers at runtime.
The package's MIT license applies.

---

## Protocol inspiration

`apps/desktop/src/renderer/voice/UnmuteSession.ts` implements the WebSocket
protocol described in kyutai-labs/unmute's `docs/browser_backend_communication.md`.
This is original code (not copied), but the protocol shape follows Unmute's
OpenAI Realtime API-inspired design. No license obligation for protocol
compatibility, but attribution is given here for clarity.
