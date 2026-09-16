# dsh-media-lab

Extra media APIs for DeepSeek Harness — image generation, video generation, text-to-speech and
transcription — configured **once** in dsh Settings → 多媒体 API, and handed to the model as tools.

## Install

```sh
dsh plugin --profile web add dsh-media-lab
```

Restart dsh afterwards. As part of [DSH CyberWorkStation](https://github.com/WZZNNE/DSH-CyberWorkStation) the plugin is registered by `setup.cmd` from the repository checkout instead.

Zero core rewrites: the plugin registers tools (`ctx.tools.register`), a system-prompt section and
its own HTTP routes (`ctx.webServer.register`), and stores keys in the dsh credential store.

## What you get

| Kind | Tool | Providers |
|---|---|---|
| Image | `generate_image` | OpenAI-compatible `/v1/images/generations` (OpenAI, SiliconFlow, Together, most gateways), OpenRouter (`/api/v1/images` — its own path, one key for every image model it fronts), Google Gemini, Replicate, fal, custom HTTP |
| Video | `generate_video` | OpenAI video jobs (Sora), OpenRouter (`/api/v1/videos` — Hailuo, Veo, Kling, Wan… on one key), Google Veo, Replicate, fal, MiniMax (Hailuo), custom HTTP |
| Speech | `text_to_speech` | OpenAI-compatible `/v1/audio/speech` (OpenAI, SiliconFlow, Groq, **local** Kokoro-FastAPI …), ElevenLabs, Fish Audio, MiniMax, custom HTTP |
| Transcription | `transcribe_audio` | OpenAI-compatible `/v1/audio/transcriptions` (OpenAI, Groq, **local** Whisper servers), custom HTTP |

Results are written to `$DSH_HOME/media/` with a JSON sidecar (provider, model, prompt, byte length, time)
and announced in the transcript as `[[dsh-media:<id>]]`; the browser half swaps that marker for a
real `<img>` / `<video>` / `<audio>` pointing at `/dsh-media-lab/file/<id>`. (The core has no image
content block — see the core's *drop-image-content-block* Agent Note — so the transcript stays text
and the page draws the media.)

A video request may also carry a **first frame** — `{"kind":"video","image":"<absolute path | data:
URL | https: URL>"}` — for image-to-video. A local path is read through the same filesystem seam as
everything else and sent as a `data:` URL, because the provider cannot see this disk; it reaches
OpenRouter as `frame_images` with `frame_type: "first_frame"`, and a provider that has no such
field ignores it. This is how `dsh-desktop-pet-cws` turns one drawing into a frame animation.

A local server (`127.0.0.1`) may be used without an API key.

## Settings

dsh Settings → **多媒体 API**: per kind, enable it, pick the provider, base URL, model, size / voice /
language, save the key, and press 试生成 for a live round trip. `文件保留天数` sweeps old files
(0 keeps everything); the tool switches decide what the model may call.

Every section may carry only its own provider's credential or `MEDIA_LAB_CUSTOM_KEY` — whether or
not it names a `baseURL` of its own. Switching provider drops the
credential and the base URL the old one was using — what the panel merely echoed back, that is; a
value you actually change in the same save is kept and then judged by the same rule. A provider's own
documented host always counts as home, so a gateway you point `baseURL` at can hand back a download
URL on that host and have its key sent there: use `MEDIA_LAB_CUSTOM_KEY` for a gateway you do not
fully trust. A poll or download URL that came out of a
provider's response is refused when it points at this machine or this network (loopback, link-local,
RFC1918, CGNAT, ULA, `.local`), unless that origin is the one you configured — a locally hosted
endpoint therefore still works, and a provider cannot use this plugin to read your network. What such
a URL served is never echoed back into an error.

A custom endpoint may only use `MEDIA_LAB_CUSTOM_KEY`: its URL is
free-form, so it is never allowed to carry another provider's key. Credentials are also stripped
from any request whose URL did not come from the configuration — a poll or download URL out of a
provider response, and every redirect hop — and a redirect that would replay the request body to
another host is refused.

The custom adapter takes a URL, headers (`{{key}}` is substituted), a JSON body template
(`{{prompt}}`, `{{text}}`, `{{model}}`, `{{voice}}`, `{{size}}`, `{{seconds}}`), a `resultPath`
(`data.0.b64_json`) and a `resultType` (`base64` / `url` / `hex` / `binary` / `text`) — enough for a
local ComfyUI wrapper, an in-house gateway, or anything with an HTTP endpoint.

> `transcribe_audio` reads a file off this machine and uploads it to the configured speech
> provider, and the model chooses the path. It is registered with a `tools/pre-execute` hook that
> answers `ask`, so a deployment with an approval flow puts every transcription to you first.

## Routes

| Route | Purpose |
|---|---|
| `GET /dsh-media-lab/status` | config + providers + which keys are configured |
| `POST /dsh-media-lab/config` | write `$DSH_HOME/media-lab.json` (validated, hot-loaded) |
| `POST /dsh-media-lab/key` | store or clear one credential (`{env, value}`) |
| `POST /dsh-media-lab/generate` | one generation: `{kind, prompt | text | path, …}`. Images may add `resolution` (512 / 1K / 2K / 4K, case folded, anything else → 400), `seed` (non-negative safe integer, else 400) and `references[]` (`data:image/png|jpeg|webp;base64,…` or http(s) URLs; at most four, each under 4 MB, the rest dropped) — forwarded by the OpenRouter image adapter as `input_references`, ignored by every other provider, and not exposed to the `generate_image` tool. This route alone reads up to 6 MB of body; the others stop at 256 KB |
| `GET /dsh-media-lab/files` · `GET /dsh-media-lab/file/<id>` · `POST /dsh-media-lab/delete` | list, serve, remove |

All routes are behind the same loopback + same-origin fence the other suite plugins use.

## Wire shapes (sources)

Every adapter is written against the provider's own documentation, and pinned by an offline test:

- OpenAI images / speech / transcriptions / videos — <https://github.com/openai/openai-openapi>
- Google Gemini images — <https://ai.google.dev/gemini-api/docs/image-generation>
- Google Veo — <https://ai.google.dev/gemini-api/docs/veo>
- Replicate predictions — <https://replicate.com/docs/topics/predictions/create-a-prediction>
- fal queue — <https://fal.ai/docs/model-endpoints/queue>
- ElevenLabs TTS — <https://elevenlabs.io/docs/api-reference/text-to-speech/convert>
- Fish Audio TTS — <https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech>
- MiniMax speech — <https://platform.minimax.io/docs/api-reference/speech-t2a-http>
- MiniMax video — <https://platform.minimax.io/docs/api-reference/video-generation-v2-create>
- OpenRouter video (`frame_images`, `resolution`) — <https://openrouter.ai/docs/features/multimodal/video-generation>
- OpenRouter images (`input_references`, `resolution`, `seed`) — <https://openrouter.ai/docs/features/multimodal/image-generation>
