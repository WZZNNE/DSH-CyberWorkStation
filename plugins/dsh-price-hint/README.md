# dsh-price-hint

Hover price hints on the dsh model picker: every model entry gets a native tooltip with its input and
output price in USD per 1M tokens.

## How it works

- The host half exposes `GET /dsh-price-hint/prices.json`, a map from the model's display name to its price
  hint. Names come from the `llm-pi-ai` `providers.<route>.models` settings (id + name); prices come from the
  cost-meter ledger's `config.prices.providers` (`cacheMiss` = input, `output` = output). The file is read on
  every request, so a refreshed price table applies at once.
- The browser half fetches that map at boot and every 30 s, and re-annotates the picker's entries (a `title`
  attribute) whenever the picker's DOM changes.

The route is GET-only and refuses a foreign `Host` (DNS rebinding) through `@dsh-suite/kit/fence`.

## Requirements

`dsh-cost-meter-plus` provides the price table (`~/.dsh/storages/cost-meter/ledger.json`); without it the
map is empty and no tooltip appears.
