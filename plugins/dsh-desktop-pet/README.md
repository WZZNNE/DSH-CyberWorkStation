# dsh-desktop-pet

A desktop companion for DeepSeek Harness. It has its own persona, its own (multimodal) API, its own
lorebook and its own conversations; it knows what the harness is working on, can talk first, can
remind you, can speak and listen, and — only with permission — can look at the screen or drive the
mouse and keyboard.

Zero core rewrites: a system-prompt section, an `agent/status` listener, a `session/event` listener
and its own HTTP routes. The desktop window is a small C# host compiled on demand with the .NET
Framework compiler that ships with Windows (no SDK, no NuGet).

## Three windows, pick one

| Variant | What it is | Needs |
|---|---|---|
| `in-app` (default) | a floating pet inside the dsh page itself — drag it anywhere, chat, permission cards | nothing |
| `winforms` | a transparent always-on-top desktop sprite with a speech bubble, tray icon, drag-to-move, right-click menu | Windows .NET Framework 4 (`csc.exe`, preinstalled) |
| `webview` | the pet page in a Microsoft Edge **app window**, styled frameless + always-on-top; HTML animation, audio playback, microphone | Microsoft Edge |

`设置 → 桌宠 → 桌面窗口` starts and stops them; the window position is written back to the pet. A window that is open when dsh goes down comes back by itself after the next boot (a marker under `~/.dsh/pets/_host/` lives while the window runs and goes away when you stop the window or close it from the tray), so a dsh restart does not make the pet vanish.

## The pet

- **Persona** — a system prompt, an appearance description (reused as the character reference for
  image generation, so its self-portraits stay on model), a greeting, and a scope switch:
  pet-only, or **global**, which colours the harness's own assistant too.
- **Which model** — either **the one dsh already uses** (pick one of the harness's own providers
  and a model from its list; the host and the key come with it, so there is nothing else to type) or
  **its own**: `openai-compatible` (OpenAI, OpenRouter, DeepSeek, SiliconFlow, LM Studio, Ollama
  `/v1`, …), `anthropic`, or `gemini`, with its own key stored in dsh's credential store. All of
  them carry images, so the pet can look at a screenshot or at material you upload. Keeping it
  separate is the point of the second option: the pet chats a lot, so give it something cheap.
- **Lorebook** — plain key/content entries; uploaded `.txt/.md/.json/.csv` material becomes entries
  automatically. Images land in `$DSH_HOME/pets/<id>/assets/` and can be used as expression sprites.
- **What it knows about you** — opt-in. It reads **only what you typed** in this machine's dsh
  sessions (never the assistant's replies, never tool output), distils one paragraph with the pet's
  own model, and shows it in an editable box you can rewrite or empty.
- **Expressions / actions** — unlimited, `name → image file → when to use it`. The pet switches them
  by writing `[expr:happy]` / `[action:wave]`, which never reaches the screen. Each one is either a
  still drawing with a named CSS motion over it, or a real **frame animation** — see below.
- **Task awareness** — `agent/status` transitions make it say one short line when a run starts and
  when it finishes; the current session title and last tool are part of its prompt.
- **Talks first** — four bands: 低 30–60 min, 中 15–30, 高 5–15, 繁 1–5, mixing work context and
  small talk; optionally taking a screenshot first (through the same permission gate as any other capture), and staying
  quiet while the harness is busy.
- **Reminders** — "1小时后提醒我喝水", "in 30 minutes stand up", "20:30 开会"; parsed, stored per pet
  and fired by a 20-second timer.
- **Voice** — replies spoken through `dsh-media-lab` TTS; the pet window records with the microphone
  and transcribes through `dsh-media-lab` STT. Hold the 🎤 button for one utterance (half duplex),
  double-click it for always-on listening.
- **Conversations** — its own store, separate from dsh sessions: a fresh conversation each time dsh
  restarts, older ones resumable, and every message viewable, editable and deletable.

## Permissions (three levels, per capability)

| Level | Screen | Computer control |
|---|---|---|
| `none` | never | never — **the default for control** |
| `ask` | every request raises an Allow / Deny card in dsh, in the pet page, and a Yes/No dialog on the desktop sprite | same |
| `full` | it can capture the screen on its own (**`ask` is the default**) | it can move, click, type, scroll on its own — but see the taint rule below |

The pet has no tool-calling loop; it asks by writing tags, and every tag is checked against these
levels before it runs:

`[screen]` · `[click:x,y]` · `[type:…]` · `[key:ctrl+s]` · `[scroll:3]` · `[image:prompt]` ·
`[search:query]` · `[remind:1小时后 …]` · `[speak]`

A conversation is **clean** only while everything in the prompt is the owner's own typed words.
The moment anything else is in there — a screenshot, a search result, a tool result, uploaded
material, the stored profile, a reminder the pet wrote itself, the harness task block (when task
awareness is on, which is the only way it enters a prompt), or a `/say` posted by a program rather
than typed in the panel — the conversation is marked, on disk, so resuming it later cannot undo it.
A control request is then put to the user **even at full access**. Starting a new conversation
starts clean again — with one exception that is deliberate: a persona, appearance line or expression
description written by a program is marked on the pet itself, on disk, so a restart does not clear it
(a restart is exactly what an owner does when the pet starts asking about things they did not write).
Saving that pet from the panel clears the mark.

**What this rule does and does not cover.** It governs what reaches the *model*: content the owner
did not type cannot become a mouse action without a card. It is not a lock on the port. Anything
running on this machine can reach `127.0.0.1` and call `/control` or `/screenshot` directly — as it
could move the mouse itself without this plugin. What the panel signal (`sec-fetch-site`, which a
browser sets and page script cannot) buys is that content arriving the documented programmatic way —
`/say`, a planted reminder, a persona written through `/pet` — is treated as content the owner did
not type. A persona, an appearance line and every expression's `when` description go into the system
prompt verbatim, so a persona written by a program marks every later turn of that pet.

Screen capture and control are PowerShell one-liners (`System.Drawing` for a downscaled PNG,
`SendKeys` / `mouse_event` for input). Nothing the model writes is quoted into a script: text is
carried as base64 and decoded inside PowerShell, because PowerShell 5.1 ends a single-quoted string
on the Unicode quote family as well as on `'` — and U+2019 is the ordinary curly apostrophe.
A pending request times out after two minutes as a refusal. Tool output — a screenshot, a search
result — is fed back with its tags stripped, and a control request that appears only *after* the pet
read something is put to the user even at **full access**: text the pet read must not be able to
drive the mouse on its own.

## Files

```
$DSH_HOME/desktop-pet.json          the pets and the switches
$DSH_HOME/pets/<id>/lorebook.json   world info
$DSH_HOME/pets/<id>/schedules.json  reminders
$DSH_HOME/pets/<id>/chats/*.json    conversations
$DSH_HOME/pets/<id>/assets/         sprites and uploaded material
$DSH_HOME/pets/_host/PetHost.exe    the compiled desktop host
```

**One pet, one window.** 🐾 in the sidebar wakes the pet in whichever form `window.variant` names
and ends whatever other form was up; the floating panel's ×, the settings panel's 启动 / 关闭 and the
desktop window's own 退出 all mean the same thing. The host is **per-monitor DPI aware**, so on a scaled display the pet is drawn at the size it is
shown rather than rendered small and stretched — which is what made both the sprite and the bubble
text soft. Only one host runs at a time: a window left behind by an earlier dsh run is ended by the
one starting.

## Conversations

The pet's conversations are its own store, not dsh sessions — a fresh one each time dsh restarts,
older ones resumable. They open from **💬** in the sidebar into a workspace of their own: the list on the
left (pet picker, a heading you can rename, 新建对话), the conversation on the right — title
editable, every message editable or deletable, resume or delete the lot. The pet's whole footprint
in that footer is two icon buttons, because the row is shared with every other plugin that puts
something there.

## Look

Each pet carries a `theme`: bubble fill, text colour, accent (your side of the conversation),
opacity, frost, corner radius and text size. All three surfaces draw from it — the desktop bubble and
its input box, the pet page, and the floating pet in dsh — so a pet looks like itself everywhere and
two pets can look nothing alike. Settings → 桌宠 → 外观 edits it over a chequerboard (what you are
choosing is how much of the desktop shows through) and ships Glass / Solid / Warm-paper presets.

On the desktop that is a real frosted backdrop: `SetWindowCompositionAttribute` with the acrylic
accent state on Windows 10+, falling back to plain blur-behind, and to a merely translucent window
where neither is available. On the web surfaces it is `backdrop-filter`. **The box you type into is
never translucent** on any surface — text being typed has to stay readable over whatever is behind
the window.

The furniture is managed as a **library of named sets**, like skins: save what a pet is wearing
under a name, apply any saved set to any pet (the files are copied, so deleting a library set never
undresses a pet), delete what you no longer want. Sets live in `$DSH_HOME/pets/_ui-skins/<name>/`.

Or bring the furniture in ready-made. **外观** takes three pieces — a bubble plaque, an input bar
and a send key — either **imported** (your own PNGs, transparent background) or **drawn on the spot**
by the image model, which is asked for `background: "transparent"` with `output_format: "png"` so
the alpha comes from the provider; a provider that ignores that gets its backdrop keyed out here
instead (`--key=auto` takes the key colour from the four corners, because a plaque drawn to order
comes back on whatever ground the model chose). Every surface then draws them
as a **nine-slice**: corners kept at their own size, edges stretched one way, middle stretched both,
so one drawing is a bubble around any sentence. `/dsh-desktop-pet/ui?pet=<id>&part=bubble|input|button`
serves them; the switch back to colour-and-blur is the same dropdown.

## Size

The desktop window is resizable anywhere between 90 and 1400 px: drag its **bottom-right corner**
(the handle appears when the cursor is over it), Ctrl + wheel over it, or use the slider in the panel. Both sides always move together — a pet
stretched to a different aspect than its drawings is the one thing that always looks wrong — and
where you leave it is remembered (`/window-position` carries the size as well as the position).

## Frames

An expression can be one drawing or a run of them. Set **帧数 / Frames** to how many the sprite has
(1 is a still image, 8–24 is an animation) and **帧率 / FPS** to how fast they play. Frame 1 is the
sprite's own file and the rest sit beside it under a two-digit suffix:

```
assets/rest.png      frame 1        ← this is what "图片文件名 / Image file" names
assets/rest-02.png   frame 2
assets/rest-16.png   frame 16
```

They are served by `/dsh-desktop-pet/sprite?pet=<id>&name=<expression>&frame=<n>`, fetched once and
kept, and played **forwards and then back** so a drawn run that does not end where it began still
loops without a jump (`loop: "forward"` on the sprite plays it one way instead). All three windows
animate: the WinForms host on a timer, the pet page and the in-app pet by swapping preloaded images.
A sprite left at one drawing keeps its CSS `motion`, and `prefers-reduced-motion` stops both.

The frames themselves are ordinary PNGs — draw them, or generate them: `dsh-media-lab` will take a
still and an instruction and hand back a clip (`{ "kind": "video", "image": "<absolute path>" }`),
which `tools/SpriteCutout.cs` cuts into transparent frames. Measure every frame with `--bounds`,
take the union, and cut them all again with `--crop=x,y,w,h`: one rectangle for the whole run, or
the pet jitters as it plays.

## Voice

Speech goes through `dsh-media-lab`'s TTS section, so the pet speaks with whatever provider is
configured there. One provider changes what the pet is told: when that section is **Fish Audio**,
the system prompt gains the `[tag]` vocabulary from
[docs.fish.audio's emotion reference](https://docs.fish.audio/api-reference/emotion-reference) — the
S2 line (`s2-pro`, `s2.1-pro`, `drama3`) performs those markers instead of reading them. What the
pet writes then reaches the voice with its markers intact and the bubble without them, so the
conversation stays clean. Any other provider gets no vocabulary, because it would read the brackets
out loud.

## Routes

`status` · `config` · `pet` · `pet/delete` · `key` · `say` · `chats` · `chat` · `chat/new` ·
`chat/resume` · `chat/delete` · `chat/message` · `chat/rename` · `lore` · `profile` · `profile/refresh` · `asset` ·
`assets` · `sprite` · `ui` · `ui-skin` · `ui-skins` · `ui-skin/save` · `ui-skin/apply` · `ui-skin/delete` · `ui-skin/part` · `providers` · `permission` · `screenshot` · `control` · `listen` · `speak` · `schedule` ·
`schedule/delete` · `schedule/run` · `schedules` · `proactive/now` · `window` · `window-state` ·
`window-position` · `window/start` · `window/stop`
— all behind the loopback + same-origin fence.

## Making a pet

The companion dsh skill (`dsh-skills/desktop-pet`, installed to `~/.dsh/skills/desktop-pet`) walks
the model through it: what to ask, how to write the persona, what artwork is needed (sizes,
transparency, naming), prompts for generating that artwork in-chat with `generate_image`, and the
routes to write the result.

## Windows 11 and the glass

The context menu and the status panel ask `Acrylic.Enable` for their backdrop.
`SetWindowCompositionAttribute` with `ACCENT_ENABLE_ACRYLICBLURBEHIND` is the Windows 10 way to blur a
Win32 popup; on Windows 11 it renders the window **fully transparent** instead — dark text over the
desktop — while screen capture composites it the old way, so the bug never shows up in a screenshot.
The host therefore reads the real build from the registry (`Environment.OSVersion` lies without a
supportedOS manifest) and, from build 22000 up, asks DWM for `DWMWA_SYSTEMBACKDROP_TYPE`
(TRANSIENTWINDOW) instead; the legacy call is only made on Windows 10. Both callers paint an opaque
plate of their own, so a refused effect still leaves a readable menu.
