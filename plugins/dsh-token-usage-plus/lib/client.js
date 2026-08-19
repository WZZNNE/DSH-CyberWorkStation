window.__ModuleLoader__.load({ id: "dsh-token-usage-plus", factory: (require) => {
"use strict";
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
// rc.8 起 @deepseek-ai/dsh-client-web-react 不在平台种子表(seed 只剩 react 系/
// cordis/ui-slots/ui-primitives,platform.ts),require 会 miss 导致整个 loader
// entry 失败。本插件只用其 bindSnapshotSelector(5 行 uSES-with-selector 包装,
// 见本体 packages/client/web-react lib/types/bind.js),用种子词 react 的
// useSyncExternalStore 等价内联:equal 时返回缓存引用保证 getSnapshot 稳定。
const __deepseek_ai_dsh_client_web_react = { bindSnapshotSelector: (w) => {
	const subscribe = (fn) => w.subscribe(fn);
	return function useSelector(sel, eq) {
		const equal = eq ?? Object.is;
		const cache = react.useRef(null);
		const getSel = () => {
			const next = sel(w.getSnapshot());
			if (cache.current !== null && equal(cache.current.value, next)) return cache.current.value;
			cache.current = { value: next };
			return next;
		};
		return react.useSyncExternalStore(subscribe, getSel, getSel);
	};
} };
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));
const __deepseek_ai_dsh_client_runtime_client = __toESM(require("@deepseek-ai/dsh-client-runtime/client"));

//#region src/client/Heatmap.tsx
const DAY_MS = 864e5;
const formatTokens$1 = (value) => {
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
	return String(value);
};
const pad = (n) => String(n).padStart(2, "0");
/** Local calendar date key, 'YYYY-MM-DD' (mirrors the host aggregation). */
const dayKey = (ms) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Local midnight of an instant. */
const dayStart = (ms) => {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};
/** 1..4 relative quartile level, or 0 for no usage. */
function levelOf(total, max) {
	if (total <= 0 || max <= 0) return 0;
	const ratio = total / max;
	if (ratio > .75) return 4;
	if (ratio > .5) return 3;
	if (ratio > .25) return 2;
	return 1;
}
const WEEK_LABELS = [
	"一",
	"二",
	"三",
	"四",
	"五",
	"六",
	"日"
];
function Heatmap({ buckets, to, t }) {
	const [hovered, setHovered] = (0, react.useState)(null);
	const now = new Date(to);
	const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
	const firstMs = dayStart(start.getTime());
	const lastMs = dayStart(now.getTime());
	const totalDays = Math.round((lastMs - firstMs) / DAY_MS) + 1;
	const firstWeekday = (start.getDay() + 6) % 7;
	const weeks = Math.ceil((firstWeekday + totalDays) / 7);
	const byDate = new Map(buckets.map((b) => [b.date, b]));
	const todayKey = dayKey(now.getTime());
	const max = Math.max(0, ...[...byDate.values()].map((b) => b.tokens.total));
	const months = [
		0,
		1,
		2
	].map((offset) => {
		const monthStart = new Date(now.getFullYear(), now.getMonth() - 2 + offset, 1);
		const y = monthStart.getFullYear();
		const m = monthStart.getMonth();
		const daysInMonth = new Date(y, m + 1, 0).getDate();
		const firstDayIndex = Math.round((monthStart.getTime() - firstMs) / DAY_MS);
		const lastDayIndex = Math.min(firstDayIndex + daysInMonth - 1, totalDays - 1);
		return {
			label: `${y}-${pad(m + 1)}`,
			colStart: Math.floor((firstWeekday + firstDayIndex) / 7),
			colEnd: Math.floor((firstWeekday + lastDayIndex) / 7)
		};
	});
	const cells = [];
	for (let d = 0; d < totalDays; d++) {
		const ms = firstMs + d * DAY_MS;
		const key = dayKey(ms);
		const bucket = byDate.get(key);
		const total = bucket?.tokens.total ?? 0;
		const level = levelOf(total, max);
		const weekday = (firstWeekday + d) % 7;
		const col = Math.floor((firstWeekday + d) / 7);
		const cellProps = bucket === void 0 ? {} : {
			onMouseEnter: (event) => setHovered(bucket),
			onMouseLeave: () => setHovered(null)
		};
		cells.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(
			"div",
			// Mon=0
			{
				className: `hm-cell hm-l${level}${key === todayKey ? " hm-today" : ""}`,
				"data-date": key,
				style: {
					gridRow: weekday + 2,
					gridColumn: col + 2
				},
				...cellProps
			},
			key
));
	}
	const hitRate = (b) => {
		const prompt = b.tokens.input + b.tokens.cacheRead + b.tokens.cacheWrite;
		return prompt > 0 ? b.tokens.cacheRead / prompt : 0;
	};
	const money = (b) => `${b.amountCny === null ? "—" : `¥${b.amountCny.toFixed(2)}`} / ${b.amountUsd === null ? "—" : `$${b.amountUsd.toFixed(2)}`}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "heatmap-wrap",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "heatmap-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "heatmap-title",
					children: t("heatmapTitle")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "heatmap-legend",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("heatmapLess") }),
						[
							1,
							2,
							3,
							4
						].map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `hm-swatch hm-l${l}` }, l)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("heatmapMore") })
					]
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "heatmap-grid",
				style: { gridTemplateColumns: `14px repeat(${weeks}, 1fr)` },
				children: [
					months.map((m, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "hm-month-label",
						style: {
							gridRow: 1,
							gridColumn: `${m.colStart + 2} / ${m.colEnd + 3}`
						},
						children: m.label
					}, m.label)),
					WEEK_LABELS.map((label, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "hm-weekday",
						style: {
							gridRow: i + 2,
							gridColumn: 1
						},
						children: label
					}, label)),
					cells
				]
			}),
			hovered !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "hm-tooltip",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "hm-tooltip-title",
						children: hovered.date
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmTotal"),
							": ",
							formatTokens$1(hovered.tokens.total)
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmInputMiss"),
							": ",
							formatTokens$1(hovered.tokens.input)
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmInputHit"),
							": ",
							formatTokens$1(hovered.tokens.cacheRead)
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmOutput"),
							": ",
							formatTokens$1(hovered.tokens.output)
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmHitRate"),
							": ",
							(hitRate(hovered) * 100).toFixed(1),
							"%"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "hm-tooltip-row",
						children: [
							t("hmAmount"),
							": ",
							money(hovered)
						]
					})
				]
			})
		]
	});
}

//#endregion
//#region src/client/PriceTable.tsx
const SYMBOL = {
	CNY: "¥",
	USD: "$"
};
const CURRENCIES = ["CNY", "USD"];
const TIERS = ["peak", "offPeak"];
const ZERO = {
	inputPerM: 0,
	cacheReadPerM: 0,
	outputPerM: 0,
	cacheWritePerM: 0
};
/** Shown/edited placeholder while a model has no configured price in the selected currency. */
const EMPTY_TIERED = {
	peak: { ...ZERO },
	offPeak: { ...ZERO }
};
/** Turn a price row's number cell into an editable input. */
function PriceInput({ value, onChange, saving }) {
	const [text, setText] = (0, react.useState)(value === null ? "" : String(value));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
		className: "price-input",
		type: "number",
		min: 0,
		step: "any",
		disabled: saving,
		value: text,
		placeholder: "—",
		onChange: (event) => {
			setText(event.target.value);
			const parsed = Number(event.target.value);
			if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
		}
	});
}
/** Render one row per catalog model with a per-currency × per-period editor. */
function PriceTable({ models, unpricedModels, currency, t, onSavePrices }) {
	const [editCurrency, setEditCurrency] = (0, react.useState)(currency);
	const [editTier, setEditTier] = (0, react.useState)("offPeak");
	const [drafts, setDrafts] = (0, react.useState)({
		CNY: {},
		USD: {}
	});
	const [saving, setSaving] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(null);
	const tieredOf = (row) => editCurrency === "CNY" ? row.cny : row.usd;
	/** Complete tiered price as edited (or resolved, or empty when unconfigured). */
	const draftOf = (row) => drafts[editCurrency][row.model] ?? tieredOf(row) ?? EMPTY_TIERED;
	const setDraft = (row, patch) => {
		setDrafts((d) => {
			const currencyDrafts = d[editCurrency] ?? {};
			const base = currencyDrafts[row.model] ?? tieredOf(row) ?? EMPTY_TIERED;
			return {
				...d,
				[editCurrency]: {
					...currencyDrafts,
					[row.model]: {
						...base,
						[editTier]: {
							...base[editTier],
							...patch
						}
					}
				}
			};
		});
	};
	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await onSavePrices(editCurrency, drafts[editCurrency]);
			setDrafts((d) => ({
				...d,
				[editCurrency]: {}
			}));
		} catch {
			setError(String(t("priceSaveFailed")));
		} finally {
			setSaving(false);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "price-table-wrap",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "price-table-head",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "price-table-title",
					children: t("priceTableTitle")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "price-currency-toggle",
					children: [CURRENCIES.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: editCurrency === c ? "currency-btn active" : "currency-btn",
						onClick: () => setEditCurrency(c),
						children: [
							SYMBOL[c],
							" ",
							c
						]
					}, c))]
				})]
			}),

			models.length === 0 && unpricedModels.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "price-empty",
				children: t("empty")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
				className: "price-table",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("priceModel") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("priceCacheRead") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("priceInput") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("priceOutput") })
				] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [models.map((row) => {
					const draft = draftOf(row);
					const tier = draft[editTier];
					const hasDraft = drafts[editCurrency][row.model] !== void 0;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
						className: hasDraft ? "price-row-editing" : void 0,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row.name }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PriceInput, {
								value: tieredOf(row) !== null ? tier.cacheReadPerM : null,
								saving,
								onChange: (v) => setDraft(row, { cacheReadPerM: v })
							}, `${editCurrency}/${editTier}/cacheRead`) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PriceInput, {
								value: tieredOf(row) !== null ? tier.inputPerM : null,
								saving,
								onChange: (v) => setDraft(row, { inputPerM: v })
							}, `${editCurrency}/${editTier}/input`) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PriceInput, {
								value: tieredOf(row) !== null ? tier.outputPerM : null,
								saving,
								onChange: (v) => setDraft(row, { outputPerM: v })
							}, `${editCurrency}/${editTier}/output`) })
						]
					}, `${row.provider}/${row.model}`);
				}), unpricedModels.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row.model }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: t("priceNotConfigured") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: t("priceNotConfigured") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: t("priceNotConfigured") })
				] }, `used/${row.provider}/${row.model}`))] })]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "price-actions",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						className: "price-save",
						disabled: saving,
						onClick: () => void save(),
						children: saving ? t("priceSaving") : t("priceSave")
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "price-error",
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "price-edit-hint",
						children: t("priceEditHint")
					})
				]
			}),
			unpricedModels.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "price-hint",
				children: t("unpricedHint")(unpricedModels.length)
			})
		]
	});
}

//#endregion
//#region src/client/TokenUsageSection.tsx
const PERIODS = [
	"today",
	"week",
	"month"
];
const formatTokens = (value) => {
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
	return String(value);
};
const formatPercent = (value) => `${(value * 100).toFixed(1)}%`;
const formatMoney = (value, symbol) => value === null ? "—" : `${symbol}${value.toFixed(2)}`;
function Cards({ summary, t }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "stats-summary",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "summary-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-label",
					children: t("summaryTokens")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-value",
					children: formatTokens(summary.tokens.total)
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "summary-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-label",
					children: t("summaryDailyAvg")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-value",
					children: formatTokens(summary.avgDailyTokens)
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "summary-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-label",
					children: t("summaryCacheHit")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-value",
					children: formatPercent(summary.cacheHitRate)
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "summary-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "summary-label",
					children: t("summaryAmount")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "summary-value",
					children: [
						formatMoney(summary.amountCny, "¥"),
						" / ",
						formatMoney(summary.amountUsd, "$")
					]
				})]
			})
		]
	});
}
/** The full token-usage page body. */
function TokenUsageSection({ controller, useSnapshot, t, onSavePrices }) {
	const snapshot = useSnapshot();
	const [period, setPeriod] = (0, react.useState)("today");
	if (snapshot.status === "loading" || snapshot.status === "idle") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("loading") });
	if (snapshot.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "stats-error",
		children: [
			t("error"),
			": ",
			snapshot.error
		]
	});
	const data = snapshot.data;
	const hasUsage = data.buckets.some((b) => b.tokens.total > 0);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "token-usage",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "stats-toolbar",
				children: [PERIODS.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: period === p ? "range-btn active" : "range-btn",
					onClick: () => setPeriod(p),
					children: t(`period${p[0].toUpperCase()}${p.slice(1)}`)
				}, p)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "range-btn",
					onClick: () => void controller.refresh(),
					children: t("refresh")
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Cards, {
				summary: data.windows[period],
				t
			}),
			!hasUsage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "stats-empty",
				children: t("empty")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Heatmap, {
				buckets: data.buckets,
				to: data.to,
				t
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PriceTable, {
				models: data.models,
				unpricedModels: data.unpricedModels,
				currency: data.currency,
				t,
				onSavePrices
			})
		]
	});
}

//#endregion
//#region src/client/store.ts
/** Default fetcher: same-origin GET of the single stats endpoint. */
async function defaultFetcher() {
	const response = await fetch("/dsh-token-usage/stats", { credentials: "same-origin" });
	if (!response.ok) throw new Error(`token usage fetch failed: HTTP ${response.status}`);
	return response.json();
}
/** How long a cached payload stays fresh before the next load re-fetches it. */
const CACHE_TTL_MS = 3e4;
/** The page controller (one per settings surface). */
var TokenUsageStore = class {
	store = (0, __deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
		status: "idle",
		error: null,
		data: null
	});
	/** Latest load wins; an older response never overwrites a newer one. */
	generation = 0;
	inflight = null;
	cachedEntry = null;
	constructor(fetcher = defaultFetcher) {
		this.fetcher = fetcher;
	}
	/** Load the page payload; a fresh cache entry serves it without a network round. */
	async load() {
		const generation = ++this.generation;
		const cached = this.cached();
		if (cached !== void 0) {
			this.store.update((s) => {
				s.status = "ready";
				s.error = null;
				s.data = cached;
			});
			return;
		}
		this.store.update((s) => {
			s.status = "loading";
			s.error = null;
		});
		try {
			const data = await this.fetch();
			if (generation !== this.generation) return;
			this.cachedEntry = {
				at: Date.now(),
				data
			};
			this.store.update((s) => {
				s.status = "ready";
				s.error = null;
				s.data = data;
			});
		} catch (error) {
			if (generation !== this.generation) return;
			this.store.update((s) => {
				s.status = "error";
				s.error = error instanceof Error ? error.message : String(error);
			});
		}
	}
	/** Re-fetch, bypassing the cache. */
	refresh() {
		this.cachedEntry = null;
		return this.load();
	}
	/** Drop the cached payload (after a price save, so edits are never served stale). */
	clearCache() {
		this.cachedEntry = null;
	}
	async fetch() {
		if (this.inflight !== null) return this.inflight;
		const request = this.fetcher().finally(() => {
			this.inflight = null;
		});
		this.inflight = request;
		return request;
	}
	cached() {
		const entry = this.cachedEntry;
		if (entry === null) return void 0;
		if (Date.now() - entry.at >= CACHE_TTL_MS) {
			this.cachedEntry = null;
			return void 0;
		}
		return entry.data;
	}
};

//#endregion
//#region src/client/locales.ts
/** Copy dictionaries for the token-usage settings section. */
const zh = {
	nav: "用量统计",
	summaryTokens: "Token 总量",
	summaryDailyAvg: "日均 Token",
	summaryCacheHit: "平均缓存命中率",
	summaryAmount: "估算金额 (CNY / USD)",
	periodToday: "当日",
	periodWeek: "本周",
	periodMonth: "本月",
	heatmapTitle: "最近 3 个月 Token 用量",
	heatmapLess: "少",
	heatmapMore: "多",
	hmTotal: "Token 总量",
	hmInputMiss: "输入（未命中缓存）",
	hmInputHit: "输入缓存（命中）",
	hmOutput: "输出",
	hmHitRate: "缓存命中率",
	hmAmount: "金额",
	priceTableTitle: "模型单价（M tokens）",
	priceModel: "模型",
	priceInput: "输入未命中缓存",
	priceCacheRead: "输入命中缓存",
	priceOutput: "输出",
	priceTierPeak: "高峰时段",
	priceTierOffPeak: "空闲时段",
	peakHint: "高峰时段为北京时间 9:00–12:00、14:00–18:00（其余为空闲时段，价格减半）",
	priceNotConfigured: "未配置",
	priceSave: "保存单价",
	priceSaving: "保存中…",
	priceSaveFailed: "保存失败，请重试",
	priceEditHint: "编辑输入框后点击保存；币种与时段分别保存",
	unpricedHint: (n) => `${n} 个已使用模型未配置单价，其金额未计入`,
	empty: "该时间段无用量数据",
	loading: "加载中…",
	refresh: "刷新",
	error: "加载失败"
};
const en = {
	nav: "Usage Stats",
	summaryTokens: "Total tokens",
	summaryDailyAvg: "Daily average",
	summaryCacheHit: "Avg cache hit rate",
	summaryAmount: "Estimated (CNY / USD)",
	periodToday: "Today",
	periodWeek: "This week",
	periodMonth: "This month",
	heatmapTitle: "Token usage (last 3 months)",
	heatmapLess: "Less",
	heatmapMore: "More",
	hmTotal: "Total tokens",
	hmInputMiss: "Input (cache miss)",
	hmInputHit: "Input (cache hit)",
	hmOutput: "Output",
	hmHitRate: "Cache hit rate",
	hmAmount: "Amount",
	priceTableTitle: "Model prices (per 1M tokens)",
	priceModel: "Model",
	priceInput: "Input (cache miss)",
	priceCacheRead: "Input (cache hit)",
	priceOutput: "Output",
	priceTierPeak: "Peak",
	priceTierOffPeak: "Off-peak",
	peakHint: "Peak hours: 09:00–12:00 & 14:00–18:00 Beijing time; off-peak rates are half",
	priceNotConfigured: "Not configured",
	priceSave: "Save prices",
	priceSaving: "Saving…",
	priceSaveFailed: "Save failed, please retry",
	priceEditHint: "Edit a field, then save; each currency and period saves separately",
	unpricedHint: (n) => `${n} used model(s) have no price; their spend is not included`,
	empty: "No usage data in this period",
	loading: "Loading…",
	refresh: "Refresh",
	error: "Failed to load"
};

//#endregion
//#region src/client/token-usage.css.ts
/**
* Token-usage page styles as a self-contained module: exported CSS text plus
* an idempotent injector, so the client bundle carries its own stylesheet
* without any build-plugin magic. (A plain `import './token-usage.css'`
* builds, but rolldown emits the sheet as a sibling `lib/client.css` that no
* loader/host ever serves — the runtime bundle would be unstyled.)
*/
const css = `
.token-usage { display: flex; flex-direction: column; gap: 16px; padding: 16px 0; }
.stats-toolbar { display: flex; gap: 8px; align-items: center; }
.range-btn, .currency-btn { padding: 4px 10px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); cursor: pointer; }
.range-btn.active, .currency-btn.active { background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); border-color: var(--dsw-color-accent, #2563eb); }
.stats-summary { display: flex; gap: 16px; flex-wrap: wrap; }
.summary-card { flex: 1; min-width: 130px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.summary-label { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.summary-value { font-size: 20px; font-weight: 600; margin-top: 4px; }
.heatmap-wrap { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; position: relative; }
.heatmap-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.heatmap-title { font-size: 13px; font-weight: 600; }
.heatmap-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--dsw-color-text-muted, #6e7781); }
.hm-swatch { width: 10px; height: 10px; border-radius: 2px; }
.heatmap-grid { display: grid; gap: 3px; }
.hm-month-label { font-size: 11px; font-weight: 600; color: var(--dsw-color-text-muted, #6e7781); align-self: end; padding: 0 2px 1px; }
.hm-weekday { font-size: 10px; color: var(--dsw-color-text-muted, #6e7781); text-align: center; align-self: center; }
.hm-cell { aspect-ratio: 1; border-radius: 3px; background: var(--dsw-color-border-faint, #ebecf0); }
.hm-l1 { background: rgba(37, 99, 235, 0.18); }
.hm-l2 { background: rgba(37, 99, 235, 0.38); }
.hm-l3 { background: rgba(37, 99, 235, 0.62); }
.hm-l4 { background: rgba(37, 99, 235, 0.9); }
.hm-today { outline: 1.5px solid var(--dsw-color-accent, #2563eb); outline-offset: 1px; }
.hm-tooltip { position: absolute; left: 8px; top: 40px; pointer-events: none; background: var(--dsw-surface-overlay, #ffffff); border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 6px; padding: 8px 10px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); white-space: nowrap; z-index: 20; display: flex; flex-direction: column; gap: 2px; }
.hm-tooltip-title { font-weight: 600; margin-bottom: 2px; }
.hm-tooltip-row { color: var(--dsw-color-text, #1f2328); }
.price-table-wrap { border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 8px; padding: 12px; }
.price-table-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.price-table-title { font-size: 13px; font-weight: 600; }
.price-currency-toggle { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.price-peak-hint { font-size: 11px; color: var(--dsw-color-text-muted, #6e7781); margin: -2px 0 6px; }
.price-table { border-collapse: collapse; width: 100%; }
.price-table th, .price-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--dsw-color-border, #d0d7de); font-size: 13px; }
.price-input { width: 88px; padding: 3px 6px; border: 1px solid var(--dsw-color-border, #d0d7de); border-radius: 4px; font-size: 12px; background: var(--dsw-surface-bg, #ffffff); color: var(--dsw-color-text, #1f2328); }
.price-row-editing td { background: var(--dsw-color-accent-faint, rgba(37, 99, 235, 0.06)); }
.price-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.price-save { padding: 4px 12px; border: 1px solid var(--dsw-color-accent, #2563eb); border-radius: 6px; background: var(--dsw-color-accent, #2563eb); color: var(--dsw-color-text-inverse, #ffffff); cursor: pointer; }
.price-save:disabled { opacity: 0.6; cursor: default; }
.price-error { font-size: 12px; color: var(--dsw-color-danger, #cf222e); }
.price-edit-hint { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); }
.price-hint { font-size: 12px; color: var(--dsw-color-text-muted, #6e7781); margin-top: 8px; }
.stats-empty, .stats-error, .price-empty { color: var(--dsw-color-text-muted, #6e7781); padding: 24px 0; text-align: center; }
`;
/** Style-tag identity (mirrors the harness loader's `data-plugin` convention). */
const TAG_ID = "dsh-token-usage";
/** Append the stylesheet once; no-ops when the tag is already present. */
function injectTokenUsageCss() {
	if (typeof document === "undefined") return;
	if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = TAG_ID;
	tag.dataset.pluginCss = TAG_ID;
	tag.textContent = css;
	document.head.appendChild(tag);
}

//#endregion
//#region src/client/index.ts
/** Dictionary namespace owned by this plugin. */
const NS = "settings.tokenUsage";
const inject = ["slots", "locale"];
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-token-usage: copy dictionaries");
	ctx.effect(() => {
		injectTokenUsageCss();
		return () => {};
	}, "dsh-token-usage: inject styles");
	const controller = new TokenUsageStore();
	const bound = (0, __deepseek_ai_dsh_client_web_react.bindSnapshotSelector)(controller.store);
	const selectAll = (s) => s;
	const useSnapshot = () => bound(selectAll);
	const t = ctx.locale.bind(NS);
	const savePrices = async (currency, prices) => {
		const response = await fetch("/dsh-token-usage/prices", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				currency,
				prices
			})
		});
		const body = await response.json().catch(() => null);
		if (!response.ok || body?.ok !== true) throw new Error("price save rejected");
		controller.clearCache();
		await controller.refresh();
	};
	const injected = () => ({
		controller,
		useSnapshot,
		t,
		onSavePrices: savePrices
	});
	ctx.effect(() => {
		controller.load();
		return () => {};
	}, "dsh-token-usage: initial stats load");
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "token-usage",
		order: 20,
		label: () => t("nav"),
		inject: injected
	}, TokenUsageSection));
}

//#endregion
exports.apply = apply
exports.inject = inject
return module.exports; } });
//# sourceMappingURL=client.js.map