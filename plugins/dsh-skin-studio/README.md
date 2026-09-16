# dsh-skin-studio-cws

Lets a model design and install a launcher or frontend skin from inside a conversation, on the user's
request, through the model-facing `skin_studio` tool.

## Flow

1. A system-prompt section constrains the interaction: ask for requirements first; when the user gave no
   image and the model cannot generate one, ask the user for an image (never fabricate one); when an
   image-generation tool exists (for example `dsh-media-lab`), call it.
2. The model writes the CSS and calls `skin_studio` with the target (`launcher` or `frontend`), a name and
   the CSS; local images are inlined as data URIs.
3. The tool persists the skin through the launcher API (`/api/skins/import`) and, unless the call passes
   `apply: false`, applies it (`/api/skins/apply`), so the result shows up on the launcher's Skins page like
   any other skin and can be switched or deleted there.

## Files

- `lib/index.js` the tool and the prompt section
- `lib/studio.js` pure helpers: target validation, name sanitising, CSS assembly, image inlining

## Requirements

The launcher must be running: the tool talks to `http://127.0.0.1:<DSH_LAUNCHER_PORT, default 3090>` with
the token from `$DSH_HOME/launcher.token`. `dsh-skin-loader` applies frontend skins to the Web UI.
