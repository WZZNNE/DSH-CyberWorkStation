import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value$1) => is(type, value$1);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary$1) {
	Binary$1.is = isArrayBufferLike;
	Binary$1.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary$1.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary$1.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary$1.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary$1.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary$1.fromHex = fromHex;
})(Binary || (Binary = {}));
/** Decode a base64 string into binary data. */
const base64ToArrayBuffer = Binary.fromBase64;
/** Encode binary data as base64. */
const arrayBufferToBase64 = Binary.toBase64;
/** Decode a hex string into binary data. */
const hexToArrayBuffer = Binary.fromHex;
/** Encode binary data as hex. */
const arrayBufferToHex = Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result$1 = [];
		refs.set(source, result$1);
		source.forEach((value, index) => {
			result$1[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result$1;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a$1, b$1) => a$1.length === b$1.length && a$1.every((item, index) => deepEqual(item, b$1[index]))) ?? check(is("Date"), (a$1, b$1) => a$1.valueOf() === b$1.valueOf()) ?? check(is("RegExp"), (a$1, b$1) => a$1.source === b$1.source && a$1.flags === b$1.flags) ?? check(isArrayBufferLike, (a$1, b$1) => {
		if (a$1.byteLength !== b$1.byteLength) return false;
		const viewA = new Uint8Array(a$1);
		const viewB = new Uint8Array(b$1);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time$1) {
	Time$1.millisecond = 1;
	Time$1.second = 1e3;
	Time$1.minute = Time$1.second * 60;
	Time$1.hour = Time$1.minute * 60;
	Time$1.day = Time$1.hour * 24;
	Time$1.week = Time$1.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time$1.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time$1.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time$1.minute - offset) / 1440);
	}
	Time$1.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time$1.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time$1.minute);
	}
	Time$1.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time$1.week || 0) + (parseFloat(capture[2]) * Time$1.day || 0) + (parseFloat(capture[3]) * Time$1.hour || 0) + (parseFloat(capture[4]) * Time$1.minute || 0) + (parseFloat(capture[5]) * Time$1.second || 0);
	}
	Time$1.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time$1.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time$1.day - Time$1.hour / 2) return Math.round(ms / Time$1.day) + "d";
		else if (abs >= Time$1.hour - Time$1.minute / 2) return Math.round(ms / Time$1.hour) + "h";
		else if (abs >= Time$1.minute - Time$1.second / 2) return Math.round(ms / Time$1.minute) + "m";
		else if (abs >= Time$1.second) return Math.round(ms / Time$1.second) + "s";
		return ms + "ms";
	}
	Time$1.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time$1.toDigits = toDigits;
	function template(template$1, time = /* @__PURE__ */ new Date()) {
		return template$1.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time$1.template = template;
})(Time || (Time = {}));

//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options$1 = {}) {
		return Schema.resolve(data, schema, options$1)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options$1) => new Schema(options$1));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options$1 = refs[key];
			options$1.sKey = getRef(options$1.sKey);
			options$1.inner = getRef(options$1.inner);
			options$1.list = options$1.list && options$1.list.map(getRef);
			options$1.dict = options$1.dict && mapValues(options$1.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern$1 = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern: pattern$1
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value$1, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value$1) : value$1;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role$1, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role: role$1,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date$1 = new Date(value);
		if (isNaN(+date$1)) throw new ValidationError(`invalid date "${value}"`, options);
		return date$1;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name$1, keys, format) {
	formatters[name$1] = format;
	Object.assign(Schema, { [name$1](...args) {
		const schema = new Schema({ type: name$1 });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key$1 in args[index]) {
						if (typeof args[index][key$1] !== "number") continue;
						schema.bits[key$1] = args[index][key$1];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name$1 === "object" || name$1 === "dict") schema.meta.default = {};
		else if (name$1 === "array" || name$1 === "tuple") schema.meta.default = [];
		else if (name$1 === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));

//#endregion
//#region src/shared/types.ts
/** Cross-process JSON contract between the host aggregation and the browser page. */
/** Settings-namespace name of this plugin (host applies the settingsNamespace brand). */
const SETTINGS_NAMESPACE = "dsh-token-usage";

//#endregion
//#region src/host/config.ts
/** Settings namespace of this plugin (the string value is shared with the client). */
const NS = settingsNamespace(SETTINGS_NAMESPACE);
/** Default display currency. */
const DEFAULT_CURRENCY = "CNY";
/** Zero cache-write price: the official v4 pricing has no cache-write bucket. */
const NO_CACHE_WRITE = 0;
/**
* Default prices in CNY, keyed by the exact ids the official llm-deepseek
* catalog advertises (CNY per 1M tokens, cache hit / miss / output).
* Verified against the official DeepSeek API pricing page
* (api-docs.deepseek.com, fetched 2026-08-18): peak hours are Beijing time
* 09:00–12:00 and 14:00–18:00; off-peak is half of peak.
*   deepseek-v4-flash 空闲 0.05/1.5/4.5  高峰 0.10/3.0/9.0
*   deepseek-v4-pro   空闲 0.15/4.5/13.5 高峰 0.30/9.0/27.0
*/
const DEFAULT_PRICES_CNY = {
	"deepseek-v4-flash": {
		peak: {
			inputPerM: 3,
			cacheReadPerM: .1,
			outputPerM: 9,
			cacheWritePerM: NO_CACHE_WRITE
		},
		offPeak: {
			inputPerM: 1.5,
			cacheReadPerM: .05,
			outputPerM: 4.5,
			cacheWritePerM: NO_CACHE_WRITE
		}
	},
	"deepseek-v4-pro": {
		peak: {
			inputPerM: 9,
			cacheReadPerM: .3,
			outputPerM: 27,
			cacheWritePerM: NO_CACHE_WRITE
		},
		offPeak: {
			inputPerM: 4.5,
			cacheReadPerM: .15,
			outputPerM: 13.5,
			cacheWritePerM: NO_CACHE_WRITE
		}
	}
};
/**
* Default prices in USD, verified against the official DeepSeek API pricing
* page (2026-08): flash 空闲 $0.007/$0.22/$0.66 高峰 $0.014/$0.44/$1.32；
* pro 空闲 $0.022/$0.66/$1.98 高峰 $0.044/$1.32/$3.96。
*/
const DEFAULT_PRICES_USD = {
	"deepseek-v4-flash": {
		peak: {
			inputPerM: .44,
			cacheReadPerM: .014,
			outputPerM: 1.32,
			cacheWritePerM: NO_CACHE_WRITE
		},
		offPeak: {
			inputPerM: .22,
			cacheReadPerM: .007,
			outputPerM: .66,
			cacheWritePerM: NO_CACHE_WRITE
		}
	},
	"deepseek-v4-pro": {
		peak: {
			inputPerM: 1.32,
			cacheReadPerM: .044,
			outputPerM: 3.96,
			cacheWritePerM: NO_CACHE_WRITE
		},
		offPeak: {
			inputPerM: .66,
			cacheReadPerM: .022,
			outputPerM: 1.98,
			cacheWritePerM: NO_CACHE_WRITE
		}
	}
};
/**
* Default alias map from harness-specific model ids to canonical catalog ids.
* ARK's coding endpoints advertise `ark-code-latest` (the physical model
* behind it can change; today it is DeepSeek V4 Flash). Users override or
* extend via the `aliases` config.
*/
const DEFAULT_MODEL_ALIASES = { "ark-code-latest": "deepseek-v4-flash" };
const priceSchema = Schema.object({
	inputPerM: Schema.number().min(0).required(),
	cacheReadPerM: Schema.number().min(0).required(),
	outputPerM: Schema.number().min(0).required(),
	cacheWritePerM: Schema.number().min(0).required()
});
/** New official form: one price per peak/off-peak period. */
const tieredPriceSchema = Schema.object({
	peak: priceSchema.required(),
	offPeak: priceSchema.required()
});
/** Accept the tiered form and the legacy flat form; resolution normalizes flat → equal tiers. */
const currencyPriceSchema = Schema.union([tieredPriceSchema, priceSchema]);
const currencyPricesSchema = Schema.object({
	cny: currencyPriceSchema.default(void 0),
	usd: currencyPriceSchema.default(void 0)
});
/** Schemastery schema doubling as the settings-section shape. */
const ConfigSchema = Schema.object({
	currency: Schema.union([Schema.const("CNY"), Schema.const("USD")]).default(DEFAULT_CURRENCY),
	models: Schema.dict(currencyPricesSchema).default({}),
	aliases: Schema.dict(Schema.string()).default({})
});
/** True for the tiered {peak, offPeak} shape; a bare ModelPrice is legacy flat. */
function isTieredPrice(value) {
	return value !== void 0 && typeof value === "object" && typeof value.peak === "object" && value.peak !== null && typeof value.offPeak === "object" && value.offPeak !== null;
}
/** Normalize any config price to the downstream tiered shape: flat = both tiers equal. */
function normalizeTiered(price) {
	return isTieredPrice(price) ? price : {
		peak: price,
		offPeak: price
	};
}
/**
* Resolved per-currency price tables: configured entries win, defaults fill
* the rest, and every alias id is injected pointing at its canonical price
* (an alias with its own explicit config entry keeps that price).
*/
function resolvePriceTables(config) {
	const cny = { ...DEFAULT_PRICES_CNY };
	const usd = { ...DEFAULT_PRICES_USD };
	for (const [id, entry] of Object.entries(config?.models ?? {})) {
		if (entry.cny !== void 0) cny[id] = normalizeTiered(entry.cny);
		if (entry.usd !== void 0) usd[id] = normalizeTiered(entry.usd);
	}
	const aliases = {
		...DEFAULT_MODEL_ALIASES,
		...config?.aliases ?? {}
	};
	for (const [alias, canonical] of Object.entries(aliases)) {
		if (cny[alias] === void 0 && cny[canonical] !== void 0) cny[alias] = cny[canonical];
		if (usd[alias] === void 0 && usd[canonical] !== void 0) usd[alias] = usd[canonical];
	}
	return {
		cny,
		usd
	};
}
/** Resolve the preferred display currency. */
function resolveCurrency(config) {
	return config?.currency ?? DEFAULT_CURRENCY;
}

//#endregion
//#region src/host/prices.ts
/** Beijing (UTC+8) hour of an instant; the official peak windows are Beijing-time. */
function beijingHour(ms) {
	return (new Date(ms).getUTCHours() + 8) % 24;
}
/** Official peak windows: 09:00–12:00 and 14:00–18:00 Beijing time (start-inclusive). */
function tierOf(ms) {
	const hour = beijingHour(ms);
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18 ? "peak" : "offPeak";
}
/**
* Total estimated amount from aggregated per-tier token totals. The caller
* picks the tier's ModelPrice; amounts scale linearly, so summing tokens
* first and multiplying once is equivalent to per-event billing.
*/
function amountOfTotals(tokens, price) {
	return tokens.input / 1e6 * price.inputPerM + tokens.cacheRead / 1e6 * price.cacheReadPerM + tokens.cacheWrite / 1e6 * price.cacheWritePerM + tokens.output / 1e6 * price.outputPerM;
}

//#endregion
//#region src/host/aggregate.ts
const EMPTY_TOTALS = () => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	reasoning: 0,
	total: 0
});
/** Local calendar date key, 'YYYY-MM-DD'. */
function localDayKey(ms) {
	const d = new Date(ms);
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${month}-${day}`;
}
/** Local midnight of an instant. */
function dayStartMs(ms) {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
/** Local midnight of the current ISO week's Monday (Mon=0). */
function weekStartMs(now) {
	const d = new Date(dayStartMs(now));
	d.setDate(d.getDate() - (d.getDay() + 6) % 7);
	return d.getTime();
}
/** Local midnight of the first day of the current month. */
function monthStartMs(now) {
	const d = new Date(dayStartMs(now));
	d.setDate(1);
	return d.getTime();
}
/**
* Inclusive range start for the whole page: the first day of the current
* calendar month two months back (3 calendar months: current, previous,
* previous-previous), or this week's Monday when that falls earlier. JS
* Date rolls negative months across the year boundary automatically.
*/
function rangeFromMs(now) {
	const d = new Date(dayStartMs(now));
	const threeMonthsBack = new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime();
	return Math.min(threeMonthsBack, weekStartMs(now));
}
/** Days elapsed inside the current ISO week (Mon..today), 1..7. */
function elapsedWeekDays(now) {
	return (new Date(now).getDay() + 6) % 7 + 1;
}
/** Days elapsed inside the current month (1st..today), 1..31. */
function elapsedMonthDays(now) {
	return new Date(now).getDate();
}
/** Split a provider\u0000model composite key back into its parts. */
function splitModelKey(key) {
	const sep = key.indexOf("\0");
	return sep >= 0 ? {
		provider: key.slice(0, sep),
		model: key.slice(sep + 1)
	} : {
		provider: "unknown",
		model: key
	};
}
function addTotalsInto(target, source) {
	target.input += source.input;
	target.output += source.output;
	target.cacheRead += source.cacheRead;
	target.cacheWrite += source.cacheWrite;
	target.reasoning += source.reasoning;
	target.total += source.total;
}
/** Sum buckets whose date is >= fromKey (bucket list is date-ascending). */
function sumFrom(buckets, fromKey, elapsedDays) {
	const tokens = EMPTY_TOTALS();
	let amountCny = 0;
	let amountUsd = 0;
	let cnySeen = false;
	let usdSeen = false;
	for (const bucket of buckets) {
		if (bucket.date < fromKey) continue;
		addTotalsInto(tokens, bucket.tokens);
		if (bucket.amountCny !== null) {
			amountCny += bucket.amountCny;
			cnySeen = true;
		}
		if (bucket.amountUsd !== null) {
			amountUsd += bucket.amountUsd;
			usdSeen = true;
		}
	}
	const promptInput = tokens.input + tokens.cacheRead + tokens.cacheWrite;
	return {
		tokens,
		amountCny: cnySeen ? amountCny : null,
		amountUsd: usdSeen ? amountUsd : null,
		cacheHitRate: promptInput > 0 ? tokens.cacheRead / promptInput : 0,
		avgDailyTokens: tokens.total / Math.max(1, elapsedDays)
	};
}
/**
* Aggregate pre-folded index entries into [from..to] day buckets and the
* today/week/month window summaries. Amounts are recomputed from the current
* price tables at query time, so price edits never require an index rebuild.
*/
function aggregateEntries(entries, prices, fromMs, toMs, now) {
	const dateKeys = [];
	const end = new Date(toMs);
	end.setHours(0, 0, 0, 0);
	for (let d = new Date(fromMs); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) dateKeys.push(localDayKey(d.getTime()));
	const indexByDate = new Map(dateKeys.map((date, index) => [date, index]));
	const buckets = dateKeys.map((date) => ({
		date,
		tokens: EMPTY_TOTALS(),
		amountCny: null,
		amountUsd: null
	}));
	const unpriced = new Map();
	for (const entry of entries.values()) for (const [date, cell] of entry.days) {
		const bucketIndex = indexByDate.get(date);
		if (bucketIndex === void 0) continue;
		const bucket = buckets[bucketIndex];
		for (const tier of ["peak", "offPeak"]) for (const [key, totals] of cell[tier]) {
			addTotalsInto(bucket.tokens, totals);
			const { provider, model } = splitModelKey(key);
			const cnyPrice = prices.cny[model];
			const usdPrice = prices.usd[model];
			if (cnyPrice !== void 0) bucket.amountCny = (bucket.amountCny ?? 0) + amountOfTotals(totals, cnyPrice[tier]);
			if (usdPrice !== void 0) bucket.amountUsd = (bucket.amountUsd ?? 0) + amountOfTotals(totals, usdPrice[tier]);
			if (cnyPrice === void 0 && usdPrice === void 0) unpriced.set(key, {
				provider,
				model
			});
		}
	}
	const todayKey = localDayKey(toMs);
	return {
		buckets,
		windows: {
			today: sumFrom(buckets, todayKey, 1),
			week: sumFrom(buckets, localDayKey(weekStartMs(now)), elapsedWeekDays(now)),
			month: sumFrom(buckets, localDayKey(monthStartMs(now)), elapsedMonthDays(now))
		},
		unpricedModels: [...unpriced.values()]
	};
}

//#endregion
//#region src/host/samples.ts
/** Extract in-window model-call samples from one session's raw event log. */
function usageSamplesOf(events) {
	const samples = [];
	for (const event of events) {
		if (event.type !== "assistant/message") continue;
		const data = event.data;
		if (data.usage === void 0) continue;
		const source = data.message?.source;
		if (source === void 0 || source.kind !== "model") continue;
		if (typeof source.provider !== "string" || typeof source.model !== "string") continue;
		samples.push({
			time: event.time,
			provider: source.provider,
			model: source.model,
			usage: data.usage
		});
	}
	return samples;
}

//#endregion
//#region src/host/indexer.ts
/** Composite key: `provider\u0000model`. */
function modelKey(provider, model) {
	return `${provider}\u0000${model}`;
}
function emptyTotals() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		reasoning: 0,
		total: 0
	};
}
function rowTarget(cell, tier, key) {
	const map = tier === "peak" ? cell.peak : cell.offPeak;
	let totals = map.get(key);
	if (totals === void 0) {
		totals = emptyTotals();
		map.set(key, totals);
	}
	return totals;
}
/** Fold one model-call sample into its day × tier × model cell. */
function foldSample(entry, sample) {
	const date = localDayKey(sample.time);
	let cell = entry.days.get(date);
	if (cell === void 0) {
		cell = {
			peak: new Map(),
			offPeak: new Map()
		};
		entry.days.set(date, cell);
	}
	const usage = sample.usage;
	const t = rowTarget(cell, tierOf(sample.time), modelKey(sample.provider, sample.model));
	t.input += usage.inputTokens;
	t.output += usage.outputTokens;
	t.cacheRead += usage.cacheReadTokens ?? 0;
	t.cacheWrite += usage.cacheWriteTokens ?? 0;
	t.reasoning += usage.reasoningTokens ?? 0;
	t.total += usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}
/** Fold a batch of samples into an existing entry (mutating, returns it). */
function foldSamples(entry, samples) {
	for (const sample of samples) foldSample(entry, sample);
	return entry;
}
/** Fold raw session events (usage-bearing assistant/message only) into a fresh entry. */
function indexFromEvents(events) {
	return foldSamples({
		mtimeMs: void 0,
		days: new Map()
	}, usageSamplesOf(events));
}
const INDEX_VERSION = 1;
function serializeEntries(entries, writtenAt) {
	const sessions = {};
	for (const [id, entry] of entries) {
		const days = {};
		for (const [date, cell] of entry.days) days[date] = {
			peak: Object.fromEntries(cell.peak),
			offPeak: Object.fromEntries(cell.offPeak)
		};
		sessions[id] = {
			mtimeMs: entry.mtimeMs ?? null,
			days
		};
	}
	return {
		version: INDEX_VERSION,
		writtenAt,
		sessions
	};
}
/** Parse a snapshot; throws on wrong version or malformed JSON. */
function parseIndexFile(text) {
	const raw = JSON.parse(text);
	if (raw.version !== INDEX_VERSION) throw new Error(`index version mismatch: ${raw.version}`);
	const entries = new Map();
	for (const [id, session] of Object.entries(raw.sessions ?? {})) {
		const days = new Map();
		for (const [date, cell] of Object.entries(session.days ?? {})) days.set(date, {
			peak: new Map(Object.entries(cell.peak ?? {})),
			offPeak: new Map(Object.entries(cell.offPeak ?? {}))
		});
		entries.set(id, {
			mtimeMs: session.mtimeMs ?? void 0,
			days
		});
	}
	return entries;
}
/** Load a snapshot; missing or unreadable file yields an empty index (never throws). */
async function loadIndexFile(filePath) {
	try {
		return parseIndexFile(await readFile(filePath, "utf8"));
	} catch {
		return new Map();
	}
}
/** Atomic write: mkdir -p, temp file, rename over the target. */
async function saveIndexFile(filePath, entries) {
	await mkdir(dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(tmp, JSON.stringify(serializeEntries(entries, Date.now())));
		await rename(tmp, filePath);
	} catch (error) {
		await unlink(tmp).catch(() => {});
		throw error;
	}
}
/** Run fn over items with at most `limit` in flight, preserving order. */
function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let cursor = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	const workers = Array.from({ length: workerCount }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= items.length) return;
			results[index] = await fn(items[index]);
		}
	});
	return Promise.all(workers).then(() => results);
}
/**
* Incremental session index: reconciles the in-memory entries against
* listSessions() + log mtimes, reloading only changed/new/live sessions,
* pruning stale sessions and old days, and snapshotting to disk (throttled).
*/
var UsageIndexer = class {
	entries = new Map();
	initialized = null;
	persistTimer = null;
	constructor(deps) {
		this.deps = deps;
	}
	/** Load the persisted snapshot once (idempotent); failures yield an empty index. */
	async init() {
		this.initialized ??= loadIndexFile(this.deps.indexPath()).then((restored) => {
			for (const [id, entry] of restored) this.entries.set(id, entry);
		}).catch(() => {});
		await this.initialized;
	}
	/** Bring entries in sync with the current session list and log mtimes. */
	async reconcile() {
		await this.init();
		const now = this.deps.now?.() ?? Date.now();
		const horizonMs = rangeFromMs(now) - (this.deps.horizonDays?.() ?? 45) * 864e5;
		const sources = await this.deps.listSessions();
		const seen = new Set();
		await mapLimit(sources, this.deps.concurrency?.() ?? 8, async (source) => {
			seen.add(source.id);
			if (source.live) {
				try {
					this.entries.set(source.id, indexFromEvents(await this.deps.loadEvents(source)));
				} catch {}
				return;
			}
			const entry = this.entries.get(source.id);
			if (entry !== void 0 && source.mtimeMs !== void 0 && entry.mtimeMs === source.mtimeMs) return;
			try {
				const next = indexFromEvents(await this.deps.loadEvents(source));
				next.mtimeMs = source.mtimeMs;
				this.entries.set(source.id, next);
			} catch {}
		});
		for (const id of this.entries.keys()) if (!seen.has(id)) this.entries.delete(id);
		const floorKey = localDayKey(horizonMs);
		for (const entry of this.entries.values()) for (const key of entry.days.keys()) if (key < floorKey) entry.days.delete(key);
	}
	/** Schedule a throttled atomic snapshot; safe to call after every request. */
	persist() {
		if (this.persistTimer !== null) return;
		this.persistTimer = setTimeout(async () => {
			this.persistTimer = null;
			try {
				await saveIndexFile(this.deps.indexPath(), this.entries);
			} catch (error) {
				console.error("[dsh-token-usage] index persist failed", error);
			}
		}, this.deps.persistThrottleMs?.() ?? 5e3);
	}
	dispose() {
		if (this.persistTimer !== null) clearTimeout(this.persistTimer);
	}
};

//#endregion
//#region src/host/stats-route.ts
const RESPONSE_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store"
};
/** Join the llm catalog with both currency price tables into display rows. */
function modelRows(providers, listModels, pricesCny, pricesUsd) {
	return Promise.all(providers.map(async (provider) => {
		let models;
		try {
			models = await listModels(provider.id);
		} catch {
			models = [];
		}
		return models.map((model) => ({
			provider: provider.id,
			model: model.id,
			name: model.name,
			cny: pricesCny[model.id] ?? null,
			usd: pricesUsd[model.id] ?? null
		}));
	})).then((rows) => rows.flat());
}
/** Build the handler bound to one deps snapshot. */
function createStatsHandler(deps) {
	return async (req, res) => {
		if (req.method !== "GET") {
			res.writeHead(405, {
				allow: "GET",
				"content-type": "text/plain; charset=utf-8"
			});
			res.end();
			return;
		}
		const cached = deps.cache?.get();
		if (cached !== void 0) {
			res.writeHead(200, RESPONSE_HEADERS);
			res.end(cached);
			return;
		}
		const now = deps.now?.() ?? Date.now();
		const fromMs = rangeFromMs(now);
		let entries = deps.indexer.entries;
		try {
			await deps.indexer.reconcile();
		} catch {
			entries = new Map();
		}
		const pricesCny = deps.pricesCny();
		const pricesUsd = deps.pricesUsd();
		const aggregation = aggregateEntries(entries, {
			cny: pricesCny,
			usd: pricesUsd
		}, fromMs, now, now);
		const models = await modelRows(deps.listProviders(), deps.listModels, pricesCny, pricesUsd);
		const body = {
			from: fromMs,
			to: now,
			generatedAt: now,
			currency: deps.currency(),
			buckets: aggregation.buckets,
			windows: aggregation.windows,
			models,
			unpricedModels: aggregation.unpricedModels
		};
		const payload = JSON.stringify(body);
		deps.cache?.set(payload);
		deps.indexer.persist();
		res.writeHead(200, RESPONSE_HEADERS);
		res.end(payload);
	};
}

//#endregion
//#region src/host/prices-route.ts
const CURRENCIES = new Set(["CNY", "USD"]);
const PRICE_KEYS = [
	"inputPerM",
	"cacheReadPerM",
	"outputPerM",
	"cacheWritePerM"
];
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
/** Overlay one currency's edits onto the resolved models dict, preserving every other entry. */
function mergePrices(base, currency, prices) {
	const models = { ...base ?? {} };
	for (const [id, price] of Object.entries(prices)) models[id] = {
		...models[id] ?? {},
		[currency === "CNY" ? "cny" : "usd"]: price
	};
	return models;
}
function isModelPrice(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return PRICE_KEYS.every((key) => {
		const number = record[key];
		return typeof number === "number" && Number.isFinite(number) && number >= 0;
	});
}
/** Accept the tiered {peak, offPeak} write and the flat (legacy) form, normalized. */
function isTieredModelPrice(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value;
	return isModelPrice(record.peak) && isModelPrice(record.offPeak);
}
/** Parse the {currency, prices} body; one discriminated outcome, no throws. */
function parseBody(raw) {
	let body;
	try {
		body = JSON.parse(raw);
	} catch {
		return { error: "body must be valid JSON" };
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) return { error: "body must be an object" };
	const record = body;
	if (typeof record.currency !== "string" || !CURRENCIES.has(record.currency)) return { error: "currency must be \"CNY\" or \"USD\"" };
	if (typeof record.prices !== "object" || record.prices === null || Array.isArray(record.prices)) return { error: "prices must be an object of model id → price" };
	const prices = {};
	for (const [id, price] of Object.entries(record.prices)) if (isTieredModelPrice(price)) prices[id] = price;
	else if (isModelPrice(price)) prices[id] = normalizeTiered(price);
	else return { error: `invalid price for model "${id}": expected {peak, offPeak} or a flat price` };
	return {
		currency: record.currency,
		prices
	};
}
/** Build the handler bound to one deps snapshot. */
function createPricesHandler(deps) {
	return async (req, res) => {
		if (req.method !== "POST") {
			res.writeHead(405, {
				allow: "POST",
				"content-type": "text/plain; charset=utf-8"
			});
			res.end();
			return;
		}
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const parsed = parseBody(raw);
		if ("error" in parsed) {
			res.writeHead(400, JSON_HEADERS);
			res.end(JSON.stringify({
				ok: false,
				error: parsed.error
			}));
			return;
		}
		try {
			await deps.writePrices(parsed.currency, parsed.prices);
		} catch (error) {
			res.writeHead(400, JSON_HEADERS);
			res.end(JSON.stringify({
				ok: false,
				error: error instanceof Error ? error.message : String(error)
			}));
			return;
		}
		res.writeHead(200, JSON_HEADERS);
		res.end(JSON.stringify({ ok: true }));
	};
}

//#endregion
//#region src/host/index.ts
const name = "dsh-token-usage";
/** Host services this plugin depends on (sessions rides sessionQuery's own inject). */
const inject = [
	"llm",
	"sessionQuery",
	"webServer",
	"sessions"
];
function apply(ctx, config) {
	let current = () => config;
	installSettingsSection(ctx, NS, ConfigSchema, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {}
	});
	const llm = ctx.llm;
	const sessionQuery = ctx.sessionQuery;
	const priceTables = () => resolvePriceTables(current());
	const CACHE_TTL_MS = 3e4;
	let cacheLatest;
	ctx.on("settings/updated", (ns) => {
		if (ns === NS) cacheLatest = void 0;
	});
	const writePrices = async (currency, prices) => {
		const settings = ctx.get("settings");
		if (settings === void 0) throw new Error("settings service is unavailable");
		const models = mergePrices(current().models, currency, prices);
		const op = {
			op: "set",
			path: ["models"],
			value: models
		};
		await settings.mutate(NS, [op]);
		cacheLatest = void 0;
	};
	const dshHomePath = ctx.get("dshHomePath");
	const indexFile = () => dshHomePath !== void 0 ? join(dshHomePath("dsh-token-usage"), "index.json") : join(homedir(), ".dsh", "dsh-token-usage", "index.json");
	const listSessions = async () => {
		const records = await sessionQuery.listSessions();
		const persistence = ctx.get("sessionPersistence");
		const sources = [];
		for (const record of records) {
			let mtimeMs;
			if (!record.live && persistence !== void 0) try {
				const location = persistence.locate(record.header);
				if (location !== void 0) {
					const identity = await stat(location.path);
					mtimeMs = identity.mtimeMs;
				}
			} catch {}
			sources.push({
				id: record.header.id,
				createdAt: record.header.createdAt,
				live: record.live,
				mtimeMs
			});
		}
		return sources;
	};
	const loadEvents = async (source) => {
		const live = ctx.sessions.get(source.id);
		if (live !== void 0) return live.events;
		const persistence = ctx.get("sessionPersistence");
		if (persistence !== void 0) return (await persistence.inspect(source.id)).events;
		return (await sessionQuery.readSession(source.id)).events;
	};
	const indexer = new UsageIndexer({
		listSessions,
		loadEvents,
		indexPath: indexFile
	});
	ctx.effect(() => () => indexer.dispose(), "dsh-token-usage: indexer dispose");
	const statsHandler = createStatsHandler({
		indexer,
		listProviders: () => llm.listProviders(),
		listModels: (provider) => llm.listModels(provider),
		pricesCny: () => priceTables().cny,
		pricesUsd: () => priceTables().usd,
		currency: () => resolveCurrency(current()),
		cache: {
			get: () => {
				if (cacheLatest === void 0 || Date.now() - cacheLatest.at >= CACHE_TTL_MS) return void 0;
				return cacheLatest.payload;
			},
			set: (payload) => {
				cacheLatest = {
					at: Date.now(),
					payload
				};
			}
		}
	});
	const pricesHandler = createPricesHandler({ writePrices });
	const route = async (req, res) => {
		let url;
		try {
			url = new URL(req.url ?? "/", "http://dsh.internal");
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}
		if (req.method === "GET" && url.pathname === "/dsh-token-usage/stats") return statsHandler(req, res);
		if (req.method === "POST" && url.pathname === "/dsh-token-usage/prices") return pricesHandler(req, res);
		res.writeHead(404);
		res.end();
	};
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/dsh-token-usage",
		handler: route
	}), "dsh-token-usage: stats and prices routes");
	ctx.logger.info("dsh-token-usage: host half loaded");
	// fork:启动后把 cost-meter 已同步的 OpenRouter USD 价格自动填入本插件价格表(只补缺,峰谷同值)。
	setTimeout(async () => {
		try {
			const { readFileSync: rf } = await import("node:fs");
			const { homedir: hd } = await import("node:os");
			const { join: jn } = await import("node:path");
			const ledger = JSON.parse(rf(jn(hd(), ".dsh", "storages", "cost-meter", "ledger.json"), "utf8"));
			const or = ledger.config?.prices?.providers?.openrouter?.models ?? {};
			const cur = current().models ?? {};
			const missing = {};
			for (const [id, e] of Object.entries(or)) {
				if (cur[id] !== void 0) continue;
				if (typeof e?.cacheMiss !== "number" || typeof e?.output !== "number") continue;
				const flat = { inputPerM: e.cacheMiss, cacheReadPerM: e.cacheHit ?? e.cacheMiss, outputPerM: e.output, cacheWritePerM: 0 };
				missing[id] = { peak: flat, offPeak: flat };
			}
			const n = Object.keys(missing).length;
			if (n > 0) { await writePrices("USD", missing); console.log("[dsh-token-usage] fork: auto-filled " + n + " OpenRouter USD prices from cost-meter"); }
		} catch (error) { console.warn("[dsh-token-usage] fork price sync skipped: " + String(error).slice(0, 100)); }
	}, 8000);
}

//#endregion
export { apply, inject, name };