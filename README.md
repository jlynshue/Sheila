[![CI](https://github.com/jlynshue/Sheila/actions/workflows/ci.yml/badge.svg)](https://github.com/jlynshue/Sheila/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Sheila

**Local-first research copilot with voice — fork of Roxanne**

Talk to your Zotero library and Obsidian vaults via voice or text using Anthropic Claude, OpenAI GPT, or local Ollama models. Sheila indexes and embeds your entire research database, then uses agentic MCP to search, read, and update your knowledge base—all offline and private.

## Fork Improvements

This fork adds substantial enhancements to the upstream Roxanne research copilot:

### Phase 1: Component Architecture Refactor
- Refactored `App.tsx` into focused, reusable component modules
- Improved code organization and maintainability
- Enhanced separation of concerns across the React UI layer

### Phase 2: Voice Integration
- Extracted voice and text-to-speech logic into a `useVoiceMode` custom hook
- Integrated Unmute library for robust audio input
- Added AWS Bedrock TTS for high-quality voice output
- Simplified voice feature management and testing

### Phase 3: Multi-Model Support
- Implemented dynamic model dropdown from OpenAI-compatible endpoints
- Added support for Claude Bedrock, GPT-4, and local Ollama models
- Model selection persisted across sessions
- Runtime model switching without app restart

### Phase 4: Backend Architecture Cleanup
- Split monolithic `main.py` into focused router modules
- Separated concerns: orchestration, embedding, search, Zotero MCP, Obsidian MCP
- Improved testability and maintainability of backend services
- Cleaner error handling and logging across routes

### Phase 5: Agentic Features
- Enhanced MCP orchestration for multi-step research workflows
- Improved Zotero and Obsidian integration with agentic capabilities
- Better handling of complex document retrieval and processing

### Phase 6: Debug & Stability
- Fixed debug logging across frontend and backend
- Corrected transcription callback behavior
- Improved error messages and stack traces for troubleshooting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Shell                          │
│                    (Main Process)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    React UI Layer                           │
│  ┌──────────────────┬──────────────────┬─────────────────┐  │
│  │  Voice Input     │  Text Interface  │  Model Selector │  │
│  │  (useVoiceMode)  │  (Chat UI)       │  (Dropdown)     │  │
│  └──────────────────┴──────────────────┴─────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────────┐
│              FastAPI Backend (Python)                       │
│  ┌────────────┬──────────────┬─────────────┬──────────────┐ │
│  │ Orchestr.  │ Embeddings   │ Zotero MCP  │ Obsidian MCP │ │
│  │ Router     │ Router       │ Router      │ Router       │ │
│  └────────────┴──────────────┴─────────────┴──────────────┘ │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │  FastEmbed (Vector Database)                           │ │
│  │  Local Index of Zotero + Obsidian Content              │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ┌────▼────┐    ┌─────▼──────┐  ┌──────▼──────┐
   │ Anthropic│    │  OpenAI    │  │ Ollama      │
   │ Bedrock  │    │  (GPT-4)   │  │ (Local)     │
   └──────────┘    └────────────┘  └─────────────┘
```

## Install

The install scripts pull the latest published Sheila release for your platform and install it for you.

### macOS or Linux

```bash
curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

### Windows PowerShell

```powershell
irm https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install-windows.ps1 | iex
```

### Optional Install Flags

Install a specific version:

```bash
SHEILA_VERSION=v0.2.0 curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

Install without auto-opening the app:

```bash
SHEILA_NO_OPEN=1 curl -fsSL https://raw.githubusercontent.com/jlynshue/Sheila/main/scripts/install.sh | bash
```

After install, launch from your terminal:

```bash
sheila
```

On macOS and Linux, the launcher is installed into `~/.local/bin`. Add it to your `PATH` if needed.

## Develop Locally

### Prerequisites

- Python 3.10+
- Node.js 20+
- Optional: [Ollama](https://ollama.com) for local models

### Clone the Repo

```bash
git clone https://github.com/jlynshue/Sheila.git
cd Sheila
```

### Quick Setup

```bash
npm run setup
```

This creates `apps/backend/.venv`, installs the editable backend with test dependencies, and installs desktop dependencies.

### Manual Setup

**Backend:**

```bash
python3 -m venv apps/backend/.venv
source apps/backend/.venv/bin/activate
pip install -e "./apps/backend[test]"
```

Windows PowerShell:

```powershell
py -3 -m venv apps/backend/.venv
.\apps\backend\.venv\Scripts\Activate.ps1
pip install -e ".\apps\backend[test]"
```

**Frontend:**

```bash
npm install
```

### Run in Development

Full app:

```bash
npm run open:desktop
```

Separate processes (easier debugging):

```bash
npm run debug:backend       # FastAPI backend with reload
npm run debug:frontend      # React dev server
npm run debug:desktop       # Electron shell (needs backend running)
npm run debug:full          # Backend + Electron together
```

### Build the App

Ensure backend dependencies include build tools:

```bash
source apps/backend/.venv/bin/activate
pip install -e "./apps/backend[build]"
```

Build unpacked release:

```bash
SHEILA_PYTHON_BIN="$PWD/apps/backend/.venv/bin/python3" npm run pack:desktop
```

Build installer for your platform:

```bash
SHEILA_PYTHON_BIN="$PWD/apps/backend/.venv/bin/python3" npm run dist:desktop
```

Outputs go to `apps/desktop/release`.

### Run Tests

**Backend tests:**

```bash
source apps/backend/.venv/bin/activate
python -m pytest apps/backend/tests -m "not slow and not integration"
```

**Desktop type-check:**

```bash
npm --workspace apps/desktop run lint
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Desktop** | Electron | Cross-platform app shell |
| **UI** | React + TypeScript | Component-based interface with type safety |
| **Backend** | FastAPI (Python) | REST API and orchestration |
| **Embeddings** | FastEmbed | Fast, local vector embeddings |
| **Vector DB** | Built-in | Indexed embeddings of research library |
| **LLM** | Claude (Bedrock) / GPT-4 / Ollama | Multi-model inference |
| **Voice** | Unmute + AWS Bedrock TTS | Audio input and speech synthesis |
| **Research Integration** | MCP (Model Context Protocol) | Agentic Zotero and Obsidian access |
| **Package Manager** | npm (frontend) + pip (backend) | Dependency management |

## Project Layout

```text
apps/
  backend/            FastAPI backend, indexing, orchestration, routers
  desktop/            Electron shell and React renderer
scripts/
  build-backend-binary.mjs
  install.sh
  install-windows.ps1
docs/assets/
  banner.png
```

## Credits

**Forked from [Roxanne](https://github.com/TylerIllman/Roxanne)** by [Tyler Illman](https://github.com/TylerIllman)

This fork extends Roxanne with voice integration, multi-model support, and architectural improvements for production use.

## Author

[**Jonathan Lyn-Shue**](https://jonathanlynshue.com) — Fractional CIO/CTO | Data & AI Executive

---

## License

MIT — See LICENSE file for details.
