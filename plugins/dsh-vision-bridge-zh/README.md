> **dsh-vision-bridge-zh** — fork of [@goodandready/dsh-vision-bridge](https://www.npmjs.com/package/@goodandready/dsh-vision-bridge) 0.4.5 (MIT) with a Chinese UI and local reliability fixes. Existing routes (`/dsh-vision-bridge/*`) and configuration keys are retained.

Local fixes: `vision_compare` and `vision_pixel_diff` send every input image in one request through a configured supported channel or the core catalog. `vision_pixel_diff` returns a visual assessment, without a numerical pixel-difference guarantee. OpenAI-compatible/Ollama and catalog channels support joint images; custom/webhook channels need their own multi-image protocol and currently report unsupported. Parallel-race waits for the first successful channel and cancels remaining requests.

When `allowedImageDirs` is non-empty, direct local image, HTML, video and PDF inputs must resolve inside its directories. The filesystem provider resolves links and applies platform path rules before containment is checked. Browser URL tools accept HTTP(S) only; this does not constitute a sandbox for every subresource a permitted HTML page may load.

# dsh-vision-bridge

**Universal vision bridge** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — a self-contained replacement for `dsh-vision-router`.

When the chat model has **no vision** (e.g. `deepseek-v4-flash`) and a message contains an image, the image never reaches the text-only model. Instead, the plugin picks **how** to handle it — depending on the configured **mode**:

- **`hybrid`** (default) — auto-rewrite image blocks into text descriptions using a vision model; tools stay available for explicit follow-ups.
- **`llm`** — auto-rewrite via vision model only (the text-only model never sees raw images); tools remain callable.
- **`tools`** — auto-rewrite is **off**. The text model must call `describe_image` (or another tool) explicitly, otherwise the adapter fails on the raw image.

Plus, **multi-channel endpoints**: chain `dsh-catalog`, `openai-compatible`, `ollama`, `custom`, and `webhook` endpoints — sequential or parallel-race fallback, per-channel cooldown, optional placeholder on total failure, zero-config Ollama discovery, and LM Studio preset.

## Install

```bash
# this fork is installed by the launcher (Plugins page) or by hand as a link dependency;
# do NOT add the upstream package beside it: both register the same plugin id.
dsh plugin --profile web add link:<repo>/plugins/dsh-vision-bridge-zh
```

Restart the Web UI, open **Plugins → Settings → vision-bridge** (collapsible card).

## Tools (26)

### Core
| Tool | What it does |
|---|---|
| `describe_image` | Ask the vision model about an image (attachment id, local path, or **http(s) URL**) |
| `read_image` | Native-shape alias — read local files (or **http(s) URLs**) through the bridge when the current model can't accept images |
| `inspect_image` | Inspect one image from an **attachment id, local path, or http(s) URL** — for follow-ups on images not attached to the conversation |

### Grounding / geometry
| Tool | Result |
|---|---|
| `vision_ground(image, target)` | bbox `[x1,y1,x2,y2]` in 0–1000 coords |
| `vision_crop(image, region)` | crop bbox (phrase or coords) |
| `vision_detect(image, kind)` | numbered inventory `[{label,bbox}]` |
| `vision_compare(images[], q)` | joint multi-image deltas (all images sent simultaneously) |
| `vision_present(path)` | publish local file as chat attachment |

### OCR & analysis
| Tool | Result |
|---|---|
| `vision_ocr(image)` | transcribe all visible text |
| `vision_ocr_local(image, psm)` | **local Tesseract OCR** (no network); PSM 3/4/6/11 |
| `vision_long_ocr(image)` | long screenshot OCR, stitched Markdown (120s budget, 40-chunk cap) |
| `vision_trace(image)` | SVG vectorization |
| `vision_colors(image, top)` | dominant colors palette |
| `vision_extract_foreground(image)` | foreground bbox (SAM3 upgrade path) |

### Structured / Q&A
| Tool | Result |
|---|---|
| `vision_describe_structured(image)` | JSON: `{summary, ocr, layout[], entities[], uncertainty[]}` |
| `vision_vqa(image, question)` | short answer to a visual question (token-efficient, maxTokens=100) |
| `vision_ui_layout(image)` | structured UI breakdown: header/main/sidebar/footer with sizes and contents |
| `vision_translate_image(image)` | extract text verbatim (ready for translation by main model) |

### Pixel loop & rendering
| Tool | Result |
|---|---|
| `vision_pixel_diff(A, B)` | diff ratio + worst regions |
| `vision_html_screenshot(html, w, h)` | render HTML → PNG (headless Chrome) |
| `vision_materialize(id, filename)` | copy attachment to workspace path |
| `vision_pdf_pages(path, pages[])` | PDF pages → PNG → vision per page (requires poppler-utils) |

### Video / browser
| Tool | Result |
|---|---|
| `vision_video_describe(path, question, frames)` | ffmpeg frame extraction → vision per frame → summary |
| `vision_page_persist(url, width)` | URL screenshot → attachment (headless Chrome) |
| `vision_browser_snapshot(url)` | fetch URL → rendered text content |
| `vision_batch(images[], prompt)` | process N images in parallel |

### Binary requirements
`html_screenshot` and `page_persist` need Chrome (`/usr/bin/google-chrome` or `CHROME_PATH`). `video_describe` needs `ffmpeg`. `pdf_pages` needs `pdftoppm`. `ocr_local` needs `tesseract`. Each degrades to a clear note when absent.

## Settings

**Plugins → Settings → vision-bridge** (collapsible card):

- **Mode** — hybrid / llm / tools
- **Describe strategy** — auto / llm / ocr-local / cache-only
- **Focus hint** — pass latest user message as context to vision model
- **Task mode** — glance / ocr / region / compare
- **Escalation** — simple-only / auto-escalate
- **Vision provider / model** — explicit override; empty = auto-pick
- **Channels editor** — add/remove/reorder endpoints with status-dot per key
- **Presets** — Local / Cloud / LM Studio (one click)
- **Bench** — probe every channel, show latency
- **Test vision** — single end-to-end call

In `settings.yaml`:

```yaml
dsh-vision-bridge:
  mode: hybrid
  describeStrategy: auto
  focusHint: true                    # task-aware prompts
  taskMode: glance                   # glance | ocr | region | compare
  escalation: simple-only            # simple-only | auto-escalate
  nativePassthrough: prefer          # prefer | always | never
  visionProvider: ""
  visionModel: ""
  channels: []
  channelFallback: sequential        # sequential | parallel-race
  channelTimeoutMs: 30000
  channelCooldownMs: 60000
  channelFailureMode: placeholder    # placeholder | error
  autoLocalOllama: true
  keysFromEnv: [VISION_API_KEY, DASHSCOPE_API_KEY, OPENAI_API_KEY, ZHIPUAI_API_KEY]
  detail: auto                     # auto | low | high — resolution hint for token economy
  stream: false                    # stream openai-compatible responses (SSE) for faster first token (#106)
  maxImagePixels: 4000000          # 4MP pixel guard; 0 disables (reject oversized with clear error)
  sanitizeImages: true
  cacheEnabled: true
  cacheMaxEntries: 256
  evidencePersist: false             # persist descriptions across restarts
  evidenceDir: ""                    # default = cwd
  evidenceMaxEntries: 2000
  allowedImageDirs: []               # empty = any path allowed
  auditLog: off                      # off | errors | all
  maskSecrets: true
  maxImageBytes: 20971520
  timeoutMs: 120000
```

### Channel types

```yaml
channels:
  - type: dsh-catalog         # DSH catalog model
    provider: <provider>
    model: <model>
    tier: 0                    # higher tier = tried first (prioritized failover)
  - type: openai-compatible   # any OpenAI-format endpoint
    baseURL: https://<HOST>/v1
    apiKey: ""                 # single key, or comma-separated list (rotated on auth/rate-limit)
    model: <MODEL_ID>
    protocol: openai-chat     # openai-chat | openai-responses
  - type: ollama              # local Ollama
    baseURL: http://localhost:11434/v1
    model: <OLLAMA_MODEL>
  - type: lmstudio            # LM Studio (localhost:1234)
    baseURL: http://localhost:1234/v1
    model: <LMSTUDIO_MODEL>
  - type: webhook             # your own HTTP endpoint
    baseURL: https://<YOUR_SERVICE>/vision
    apiKey: ""
  - type: custom              # template-based
    baseURL: https://<CUSTOM_HOST>/vision
    requestTemplate: |
      {"model":{{model}},"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":{{dataUrl}}}}, {"type":"text","text":{{prompt}}}]}]}
    responsePath: choices.0.message.content
```

**Keys & failover:** a channel's `apiKey` (or each env var in `keysFromEnv`) may
hold a **comma-separated list of keys**; on `401/402/403/429` the driver rotates
to the next key and honors `Retry-After` (degrading to a short backoff when the
header is absent). Channel `tier` orders failover — higher numbers are preferred.

Content-safety rejections (provider-side moderation) are mapped to an explicit
`VISION_CONTENT_FILTERED` error instead of a generic backend failure.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/dsh-vision-bridge/config` | GET/POST | read/write plugin config |
| `/dsh-vision-bridge/channels` | GET/POST | list/edit channels |
| `/dsh-vision-bridge/models` | GET | list all models + vision flag |
| `/dsh-vision-bridge/test` | POST | single end-to-end call |
| `/dsh-vision-bridge/stats` | GET | per-channel usage stats + per-key quota label (#98) + real tokens (#107) |
| `/dsh-vision-bridge/bench` | POST | benchmark suite — 3 prompts per channel, latency + tokens (#109) |
| `/dsh-vision-bridge/doctor` | GET | vision doctor — human-readable diagnostics: channels, keys present, per-channel probe |
| `/dsh-vision-bridge/costs` | GET | token estimate per channel (real tokens when provider reports them) |
| `/dsh-vision-bridge/cache` | GET/DELETE | cache inspector / clear |
| `/dsh-vision-bridge/journal` | GET/DELETE | vision journal — audit trail of every call, filterable (#108) |
| `/dsh-vision-bridge/batch` | POST/GET | batch with progress + cancel: POST start, GET /batch/:id poll, POST /batch/:id/cancel (#110) |

## Skill

The bundled `vision-skills` Skill (5 playbooks: long-screenshot OCR, restore UI/graphic/structure, GUI ops) is registered via `ctx.skills.registerProvider` — the model loads the matching playbook when a visual task starts.

## Structure

```
dsh-vision-bridge/
├── package.json
├── cordis.patch.yml
├── lib/index.js            # host: sanitizer + tools + channels + routes + skill
├── lib/channels.js         # multi-channel driver (6 types) — stdlib
├── lib/cache.js            # LRU cache + composite key
├── lib/evidence.js         # persistent description store
├── lib/journal.js          # vision journal — audit trail (#108)
├── lib/client.js           # browser: Plugins-tab collapsible card
├── skills/vision-skills/   # bundled Skill (5 playbooks)
├── test/regression.test.js # 32 regression tests
├── test/eval.test.js       # 6 eval tests
├── README.md
└── LICENSE                 # MIT
```

## Compatibility notes

- **Default behavior is identical to v0.1.x.**
- Settings live in a **collapsible card on Plugins tab**, fallback to sidebar if slot absent.
- No new peer dependencies. Chrome/ffmpeg/pdftoppm/tesseract used only when present; each degrades gracefully.

## License

MIT
