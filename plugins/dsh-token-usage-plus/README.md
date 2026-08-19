# dsh-token-usage

English | [中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/npm/v/dsh-token-usage?style=flat-square" alt="npm version">
  &nbsp;
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License">
  &nbsp;
  <img src="https://img.shields.io/badge/plugin-dsh%20web-blue?style=flat-square" alt="dsh web plugin">
</p>

<p align="center">
  <strong>Turn every real token spend into a bill priced at the official peak/off-peak rates.</strong><br>
  Summary cards + GitHub-style heatmap · real token cost estimates · auto-converted official prices
</p>

<div align="center">

[What it is](#-what-it-is) · [Screenshots](#-screenshots) · [Features](#-features) · [How it works](#-how-it-works) · [Install](#-install) · [Configuration](#-configuration) · [Limitations](#-known-limitations--disclaimer) · [Development](#-development)

</div>

---

## 🎯 What it is

**dsh-token-usage** is a **token-usage statistics plugin** for [DeepSeek Harness](https://github.com/anywhere-labs/deepseek-harness) (`dsh`). It adds a **Usage Stats** page to the Web settings panel: **summary cards** (total tokens / daily average / cache hit rate / estimated spend, switchable in one click between today / this week / this month) plus a **3-month GitHub-style heatmap** — quantifying your real token consumption from past sessions and, crucially, **converting it automatically to what it actually costs you at the official peak/off-peak prices** (shown in CNY and USD side by side).

It's not a reskin of a native page — it shows your budget from the level that matters: **which model is burning money, which hours are the most expensive, and how much the cache-hit rate saves you** — all visible at a glance and priced precisely against the official rates.

| Native `dsh web` | With this plugin |
| --- | --- |
| No token-usage stats entry | Settings → Usage Stats: summary cards + 3-month heatmap |
| No spend estimates | Real tokens × official peak/off-peak prices → estimated CNY & USD |
| No price management | Per-model price table: CNY / USD × peak / off-peak, edit inline |
| Hard-coded prices | Official defaults built in; `ark-code-latest` and other aliases auto-mapped |

All data comes from the `usage` field carried by `assistant/message` events in persisted session logs — the plugin is a **pure observer**: it never touches the agent loop and never reports anything to an external service. Everything stays on your machine.

## 📸 Screenshots

![Usage stats page: heatmap + summary cards](docs/screenshots/img-0.png)

## ⭐ Features

### 📊 Summary cards

Four cards at the top: **total tokens, daily average, average cache hit rate, and estimated spend (CNY & USD together)**. Click to switch instantly between **today / this week / this month** (pure client state, no extra requests).

### 🗓️ 3-month heatmap

A GitHub-contribution-style horizontal week strip: one column per week, one row per weekday, with month boundaries annotated. **Hover any day's cell** to see that day's total tokens, input (cache miss), input (cache hit), output, cache hit rate, and spend (CNY / USD) — which day spiked, how much of the budget a week consumed, all at a glance.

### 💰 Model price table

Lists per-model prices for every connected model (from the `ctx.llm` model catalog), in **CNY and USD**, each split into **peak / off-peak** tiers for display and editing; ships official tiered defaults for `deepseek-v4-flash` and `deepseek-v4-pro`.

### ✏️ Price editing

Switch the table's currency *and* period (peak / off-peak), edit prices inline, hit **"Save prices"** to persist — stats refresh instantly with the new prices (no restart).

### 🕘 Precise time-of-day billing

Every call's spend is resolved from its **own event timestamp** — calls during Beijing peak hours (09:00–12:00, 14:00–18:00) are billed at the peak tier, all others at the off-peak tier (half of peak). Billing lands automatically all day, no manual tier picking.

### 🧊 Pure observer · zero interference

Never modifies the agent loop, never uploads to any external service; the index is incremental and memory-bounded, answering hot requests in tens of milliseconds — install and forget it in the background.

## ⚙️ How it works

- **Single endpoint + incremental index**: the server maintains a **day × peak/off-peak × model incremental persistent index**; hot requests against the ready in-memory index answer in tens of ms, and a session log whose mtime changed is re-read individually and merged incrementally.
- **Disk reconciliation**: the index is periodically written atomically (temp file + rename) to `$DSH_HOME/dsh-token-usage/index.json`, restored from disk on restart with near-zero rescan, and memory is bounded to the 3-month stats window plus 45 days of slack. A 30s whole-page response cache covers the rest.

## 🚀 Install

This plugin installs directly into the **native Web profile** of DeepSeek Harness (`web` is a built-in profile shipped with the distribution; `dsh web` is a hardcoded alias for `--profile web`). Once installed, **no profile flag is needed at launch** — run `pnpm dsh web` from the harness checkout and the plugin is loaded.

### npm (prebuilt · zero permissions · recommended)

```sh
dsh plugin --profile web add dsh-token-usage
```

### GitHub direct install (source + prepare self-build, allowlisted once)

```sh
dsh plugin --profile web add github:Tastelessor/dsh-usage-stats#<commit-sha>
# If the first add fails, add the package key pnpm printed to the web
# profile's pnpm-workspace.yaml:
#   $DSH_HOME/profiles/web/pnpm-workspace.yaml
#   allowBuilds:
#     dsh-token-usage: true
# then re-add.
```

### Local path

```sh
dsh plugin --profile web add /path/to/dsh-token-usage
```

> `dsh plugin add ./` uses a pnpm link and does **not** run `prepare` — run `pnpm build` first, then add.

### Launch

```sh
pnpm dsh web        # from the DeepSeek Harness checkout; web is the built-in profile, no --profile
```

## 🛠️ Configuration

### Price table

Override in the web profile's `cordis.patch.yml` (`$DSH_HOME/profiles/web/cordis.patch.yml`, or via a `--patch` overlay); the two currencies are configured independently, each model entry holds a `peak` / `offPeak` pair, and unset entries fall back to the built-in defaults:

```yaml
- patch:
    - id: dsh-token-usage
      config:
        currency: CNY        # preferred currency: CNY (default, ¥) / USD ($)
        models:
          deepseek-v4-flash:
            cny:             # CNY prices (¥ / 1M tokens)
              peak:          # Beijing 09:00–12:00, 14:00–18:00
                inputPerM: 3.0         # input, cache miss
                cacheReadPerM: 0.10    # input, cache hit
                outputPerM: 9.0       # output
                cacheWritePerM: 0      # not billed by the official v4 pricing
              offPeak:       # all other hours (half of peak)
                inputPerM: 1.5
                cacheReadPerM: 0.05
                outputPerM: 4.5
                cacheWritePerM: 0
            usd:             # USD prices ($ / 1M tokens)
              peak:
                inputPerM: 0.44
                cacheReadPerM: 0.014
                outputPerM: 1.32
                cacheWritePerM: 0
              offPeak:
                inputPerM: 0.22
                cacheReadPerM: 0.007
                outputPerM: 0.66
                cacheWritePerM: 0
```

> Legacy flat entries (a bare `inputPerM` / `cacheReadPerM` / `outputPerM` / `cacheWritePerM` block, as in pre-2026-08-17 configs) still parse and are treated as "the same price at all hours" — both tiers equal.
>
> The built-in defaults (`src/host/config.ts`) match the official prices below; the in-page "Save prices" button writes exactly the `models.<id>.cny|usd` shape shown here (both tiers) — no manual config editing needed.

### Model id aliases

Prices and spend match **model ids** exactly. ARK's coding endpoints advertise their model under ids like `ark-code-latest` (whose physical model changes over time; today it is DeepSeek V4 Flash — both the catalog and every usage event carry the alias id, so without a mapping the built-in `deepseek-v4-flash` price never matches). The plugin ships `ark-code-latest → deepseek-v4-flash` by default and lets you override/extend via `aliases`:

```yaml
- patch:
    - id: dsh-token-usage
      config:
        aliases:
          ark-code-latest: deepseek-v4-flash   # built-in; point it at the physical model
          my-other-alias: deepseek-v4-pro
```

### 📋 Official prices (verified against api-docs.deepseek.com, 2026-08-18)

DeepSeek bills time-of-day tiers since 2026-08-17: **peak hours are Beijing time 09:00–12:00 and 14:00–18:00; off-peak is half of peak** (¥ / $ per 1M tokens, **cache hit / miss / output**):

| Model | Off-peak CNY | Peak CNY | Off-peak USD | Peak USD |
| --- | --- | --- | --- | --- |
| deepseek-v4-flash | 0.05 / 1.5 / 4.5 | 0.10 / 3.0 / 9.0 | $0.007 / $0.22 / $0.66 | $0.014 / $0.44 / $1.32 |
| deepseek-v4-pro | 0.15 / 4.5 / 13.5 | 0.30 / 9.0 / 27.0 | $0.022 / $0.66 / $1.98 | $0.044 / $1.32 / $3.96 |

> Spend estimation resolves each usage event's own timestamp against these windows (Beijing time, UTC+8 — independent of the host's timezone), so peak-hour and off-peak calls land on their correct rates automatically.
>
> Implementation note: dsh's web settings API (`settings.mutate`) only exposes a hardcoded allowlist of host namespaces — external plugin namespaces are rejected (`settings-not-exposed`) — so price write-back goes through the plugin's own `POST /dsh-token-usage/prices` route, which calls `ctx.settings` in-process (exactly equivalent to hand-editing the config).

## ⚠️ Known limitations / disclaimer

- Amounts are **estimates** (built-in price table × the four real token buckets), not provider invoices; prices are subject to change — always check the official pricing page.
- Spend is estimated in CNY and USD simultaneously; the two currencies have independent price tables.
- A 30s response cache means an estimate around a peak-window boundary (09:00 / 12:00 / 14:00 / 18:00 Beijing time) can lag the tier switch by at most 30 seconds.
- `reasoningTokens` is a subset of output tokens and is never counted twice.
- Models with no price configured in either currency: tokens are still counted, spend is not, and the page shows "Not configured".
- The index is incremental and memory-bounded (3-month stats window + 45 days of slack), so hot requests run in tens of ms; building the index for the very first time on a huge data volume can still take a while, after which the incremental index plus the 30s response cache keep subsequent requests fast.

## 🔧 Development

```sh
pnpm install     # install deps (peers are provided by the dsh profile at runtime)
pnpm test        # vitest, 85 tests
pnpm typecheck   # tsc --noEmit
pnpm build       # tsdown build into lib/
```

## 📄 License

[MIT](LICENSE)

<div align="center">

**Like this project? Give it a ⭐ Star.**

[Report a Bug](https://github.com/Tastelessor/dsh-usage-stats/issues) · [Request a Feature](https://github.com/Tastelessor/dsh-usage-stats/issues) · [View Releases](https://github.com/Tastelessor/dsh-usage-stats/releases)

</div>