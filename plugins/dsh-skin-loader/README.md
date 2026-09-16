# dsh-skin-loader

Loads the active frontend skin into the dsh Web UI as a token-override style tag. The launcher manages the
skins; this plugin only serves the one that is active.

## How it works

- The host half serves `GET` / `HEAD /dsh-skin-loader/active.css` from `~/.dsh/frontend-skin.css`: the file's
  size and mtime form an ETag, so an unchanged skin answers 304 without a read and a changed one is read
  afresh. The launcher switches skins by writing that one file (a copy of `launcher/skins/frontend/<name>.css`);
  a page refresh applies it. An empty file means the stock look.
- The browser half injects a `<style>` tag with that CSS after the core's own styles, so a skin can override
  the design tokens without touching the core's bundles.

The route is read-only and refuses a foreign `Host` (DNS rebinding) through `dsh-cyberworkstation-kit/fence`.

## Related

- **Launcher → 外观皮肤 / Skins**: switch, import, delete, install community skins from npm.
- `dsh-skin-studio-cws` lets a model design and install a skin from inside a conversation.
