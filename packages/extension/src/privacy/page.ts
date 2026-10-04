import type { PagePolicy, Scope } from "./model";

// Serialized into the page world. All runtime dependencies must be arguments or
// declared inside this function; extension APIs are never exposed to the page.
export function installPagePrivacy(
  initial: PagePolicy | null,
  matches: (hostname: string, scope: Scope) => boolean,
): void {
  const marker = Symbol.for("tailchrome.privacy.update");
  const realm = globalThis as typeof globalThis & { [marker]?: (policy: PagePolicy | null) => void };
  if (realm[marker]) {
    realm[marker](initial);
    return;
  }
  if (!initial || !matches(location.hostname, initial.scope)) return;
  let policy: PagePolicy | null = initial;
  const updates = new Set<() => void>();
  Object.defineProperty(realm, marker, { value: (next: PagePolicy | null) => {
    policy = next;
    for (const update of updates) setTimeout(update, 0);
  } });
  const active = () => policy && matches(location.hostname, policy.scope) ? policy : null;
  const NativeDate = Date;
  const NativeFormat = Intl.DateTimeFormat;
  const nativeParse = NativeDate.parse;
  const nativeGetTime = NativeDate.prototype.getTime;
  const nativeSetTime = NativeDate.prototype.setTime;
  const timeZone = () => { const p = active(); return p?.timeZone ? p.profile?.timeZone : undefined; };
  const language = () => { const p = active(); return p?.language ? p.profile?.language : undefined; };
  const formatterCache = new Map<string, Intl.DateTimeFormat>();
  const nativeGet = {
    year: NativeDate.prototype.getFullYear, month: NativeDate.prototype.getMonth,
    date: NativeDate.prototype.getDate, hours: NativeDate.prototype.getHours,
    minutes: NativeDate.prototype.getMinutes, seconds: NativeDate.prototype.getSeconds,
    milliseconds: NativeDate.prototype.getMilliseconds,
  };

  function withTimeZone(options: unknown, zone: string | undefined): unknown {
    if (!zone || options === null) return options;
    const base: object = Object(options);
    const requested: unknown = Reflect.get(base, "timeZone");
    return Object.create(base, { timeZone: {
      value: requested === undefined ? zone : requested, configurable: true, enumerable: true, writable: true,
    } });
  }

  function formatFor(zone: string): Intl.DateTimeFormat {
    let result = formatterCache.get(zone);
    if (!result) {
      result = new NativeFormat("en-US-u-ca-gregory-nu-latn", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      });
      formatterCache.set(zone, result);
    }
    return result;
  }

  function wallTime(epoch: number, zone: string): number {
    if (!Number.isFinite(epoch)) return NaN;
    const parts: Record<string, number> = {};
    for (const part of formatFor(zone).formatToParts(epoch)) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    const result = new NativeDate(0);
    result.setUTCFullYear(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1);
    result.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, ((epoch % 1000) + 1000) % 1000);
    return nativeGetTime.call(result);
  }

  function fromWall(wall: number, zone: string): number {
    if (!Number.isFinite(wall)) return NaN;
    const offsets = [wall - 86_400_000, wall, wall + 86_400_000].map(t => wallTime(t, zone) - t);
    const candidates = offsets.map(offset => wall - offset);
    const exact = candidates.filter(t => wallTime(t, zone) === wall);
    // Like native Date, choose the earlier occurrence in a fold and advance
    // through a spring gap instead of producing a nonexistent local time.
    return exact.length ? Math.min(...exact) : Math.max(...candidates);
  }

  function localEpoch(date: Date): number {
    const zone = timeZone();
    return zone ? wallTime(nativeGetTime.call(date), zone) : nativeGetTime.call(date);
  }

  function patchMethod(target: object, key: PropertyKey, replacement: (...args: never[]) => unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && descriptor.configurable !== false) {
      Object.defineProperty(target, key, { ...descriptor, value: replacement });
    }
  }

  const getters = [
    ["getFullYear", "getUTCFullYear"], ["getMonth", "getUTCMonth"],
    ["getDate", "getUTCDate"], ["getDay", "getUTCDay"], ["getHours", "getUTCHours"],
    ["getMinutes", "getUTCMinutes"], ["getSeconds", "getUTCSeconds"],
    ["getMilliseconds", "getUTCMilliseconds"],
  ] as const;
  for (const [local, utc] of getters) {
    const original = NativeDate.prototype[local];
    patchMethod(NativeDate.prototype, local, function(this: Date) {
      return timeZone() ? NativeDate.prototype[utc].call(new NativeDate(localEpoch(this))) : original.call(this);
    });
  }
  const oldYear: (this: Date) => number = Object.getOwnPropertyDescriptor(NativeDate.prototype, "getYear")?.value;
  patchMethod(NativeDate.prototype, "getYear", function(this: Date) {
    return timeZone() ? this.getFullYear() - 1900 : oldYear.call(this);
  });
  const oldOffset = NativeDate.prototype.getTimezoneOffset;
  patchMethod(NativeDate.prototype, "getTimezoneOffset", function(this: Date) {
    const epoch = nativeGetTime.call(this);
    return timeZone() ? (epoch - localEpoch(this)) / 60_000 : oldOffset.call(this);
  });

  const setters = [
    ["setFullYear", "setUTCFullYear"], ["setMonth", "setUTCMonth"],
    ["setDate", "setUTCDate"], ["setHours", "setUTCHours"], ["setMinutes", "setUTCMinutes"],
    ["setSeconds", "setUTCSeconds"], ["setMilliseconds", "setUTCMilliseconds"],
  ] as const;
  for (const [local, utc] of setters) {
    const original = NativeDate.prototype[local];
    const universal = NativeDate.prototype[utc];
    patchMethod(NativeDate.prototype, local, function(this: Date, ...args: number[]) {
      const zone = timeZone();
      if (!zone) return Reflect.apply(original, this, args);
      const epoch = nativeGetTime.call(this);
      const wall = new NativeDate(Number.isNaN(epoch) && local === "setFullYear" ? wallTime(0, zone) : localEpoch(this));
      Reflect.apply(universal, wall, args);
      return nativeSetTime.call(this, fromWall(nativeGetTime.call(wall), zone));
    });
  }
  const oldSetYear: (this: Date, year: number) => number = Object.getOwnPropertyDescriptor(NativeDate.prototype, "setYear")?.value;
  patchMethod(NativeDate.prototype, "setYear", function(this: Date, value: number) {
    if (!timeZone()) return oldSetYear.call(this, value);
    const year = Number(value);
    return this.setFullYear(year >= 0 && year <= 99 ? 1900 + Math.trunc(year) : year);
  });

  function localString(date: Date, dateOnly: boolean, timeOnly: boolean): string {
    const epoch = nativeGetTime.call(date);
    if (Number.isNaN(epoch)) return "Invalid Date";
    const zone = timeZone();
    if (!zone) return "";
    const wall = new NativeDate(wallTime(epoch, zone));
    const pad = (n: number) => String(n).padStart(2, "0");
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const datePart = days[wall.getUTCDay()] + " " + months[wall.getUTCMonth()] + " " +
      pad(wall.getUTCDate()) + " " + String(wall.getUTCFullYear()).padStart(4, "0");
    if (dateOnly) return datePart;
    const offset = (nativeGetTime.call(wall) - epoch) / 60_000;
    const name = new NativeFormat("en-US", { timeZone: zone, timeZoneName: "long" })
      .formatToParts(epoch).find(part => part.type === "timeZoneName")?.value ?? zone;
    const timePart = pad(wall.getUTCHours()) + ":" + pad(wall.getUTCMinutes()) + ":" +
      pad(wall.getUTCSeconds()) + " GMT" + (offset < 0 ? "-" : "+") +
      pad(Math.floor(Math.abs(offset) / 60)) + pad(Math.abs(offset) % 60) + " (" + name + ")";
    return timeOnly ? timePart : datePart + " " + timePart;
  }
  for (const method of ["toString", "toDateString", "toTimeString"] as const) {
    const original = NativeDate.prototype[method];
    patchMethod(NativeDate.prototype, method, function(this: Date) {
      return timeZone() ? localString(this, method === "toDateString", method === "toTimeString") : original.call(this);
    });
  }
  for (const method of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
    const original = NativeDate.prototype[method];
    patchMethod(NativeDate.prototype, method, function(this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      const zone = timeZone();
      return Reflect.apply(original, this, [locales === undefined ? language() : locales, withTimeZone(options, zone)]);
    });
  }

  function parseLocal(text: string): number {
    const result = nativeParse(text);
    const zone = timeZone();
    // Date-only ISO strings denote midnight UTC, not local time.
    if (!zone || !Number.isFinite(result) || /^(?:[+-]\d{6}|\d{4})(?:-\d\d(?:-\d\d)?)?$/.test(text) ||
        /(?:z|[+-]\d\d(?::?\d\d)?|gmt|utc)\s*(?:\([^)]*\))?$/i.test(text)) return result;
    const date = new NativeDate(result);
    const wall = new NativeDate(0);
    wall.setUTCFullYear(nativeGet.year.call(date), nativeGet.month.call(date), nativeGet.date.call(date));
    wall.setUTCHours(nativeGet.hours.call(date), nativeGet.minutes.call(date), nativeGet.seconds.call(date), nativeGet.milliseconds.call(date));
    return fromWall(nativeGetTime.call(wall), zone);
  }
  const DateProxy = new Proxy(NativeDate, {
    apply() { return new NativeDate().toString(); },
    construct(target, args: unknown[], newTarget) {
      const zone = timeZone();
      if (zone && args.length > 1) {
        const wall = NativeDate.UTC(...args as [number, number]);
        return Reflect.construct(target, [fromWall(wall, zone)], newTarget);
      }
      if (zone && args.length === 1 && typeof args[0] === "string") {
        return Reflect.construct(target, [parseLocal(args[0])], newTarget);
      }
      return Reflect.construct(target, args, newTarget);
    },
  });
  patchMethod(NativeDate, "parse", (text: string) => parseLocal(String(text)));
  Object.defineProperty(NativeDate.prototype, "constructor", { value: DateProxy, configurable: true, writable: true });
  globalThis.Date = DateProxy;

  for (const key of ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter"] as const) {
    const constructor = Intl[key];
    if (!constructor) continue;
    const argsFor = (args: unknown[]) => {
      const [locales, options, ...rest] = args;
      const zone = timeZone();
      return [locales === undefined ? language() : locales,
        key === "DateTimeFormat" ? withTimeZone(options, zone) : options, ...rest];
    };
    Object.defineProperty(Intl, key, {
      configurable: true, writable: true, value: new Proxy(constructor, {
        apply(target, receiver, args) { return Reflect.apply(target, receiver, argsFor(args)); },
        construct(target, args, newTarget) { return Reflect.construct(target, argsFor(args), newTarget); },
      }),
    });
  }

  for (const prototype of [Number.prototype, BigInt.prototype]) {
    const original = prototype.toLocaleString;
    patchMethod(prototype, "toLocaleString", function(this: number | bigint, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      return Reflect.apply(original, this, [locales === undefined ? language() : locales, options]);
    });
  }
  // Modern Chrome exposes a second clock API. Its default zone must agree with
  // Date/Intl, while absolute instants and explicit zones keep native semantics.
  const temporal: unknown = Reflect.get(globalThis, "Temporal");
  if (typeof temporal === "object" && temporal !== null) {
    const now: unknown = Reflect.get(temporal, "Now");
    if (typeof now === "object" && now !== null) {
      for (const method of ["timeZoneId", "zonedDateTimeISO", "plainDateTimeISO", "plainDateISO", "plainTimeISO"]) {
        const original: unknown = Reflect.get(now, method);
        if (typeof original !== "function") continue;
        patchMethod(now, method, function(this: unknown, ...args: unknown[]) {
          if (method === "timeZoneId") return timeZone() ?? Reflect.apply(original, this, args);
          return Reflect.apply(original, this, [args[0] === undefined ? timeZone() : args[0]]);
        });
      }
    }
    for (const name of ["Instant", "ZonedDateTime", "PlainDate", "PlainDateTime", "PlainTime", "PlainMonthDay", "PlainYearMonth", "Duration"]) {
      const constructor: unknown = Reflect.get(temporal, name);
      if (typeof constructor !== "function") continue;
      const proto: unknown = Reflect.get(constructor, "prototype");
      if (typeof proto !== "object" || proto === null) continue;
      const original: unknown = Reflect.get(proto, "toLocaleString");
      if (typeof original !== "function") continue;
      patchMethod(proto, "toLocaleString", function(this: unknown, locales?: unknown, options?: unknown) {
        return Reflect.apply(original, this, [locales === undefined ? language() : locales,
          name === "Instant" ? withTimeZone(options, timeZone()) : options]);
      });
    }
  }
  const compare = String.prototype.localeCompare;
  patchMethod(String.prototype, "localeCompare", function(this: string, that: string, locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
    return compare.call(this, that, locales === undefined ? language() : locales, options);
  });

  const nav = Object.getPrototypeOf(navigator);
  for (const key of ["language", "languages", "userAgent", "appVersion"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(nav, key);
    if (!descriptor?.get) continue;
    const get = descriptor.get;
    Object.defineProperty(nav, key, { ...descriptor, get() {
      const original = get.call(this);
      const p = active();
      if (key === "language") return language() ?? original;
      if (key === "languages") return language() ? Object.freeze([language()]) : original;
      if (!p?.reduceAgent) return original;
      return key === "userAgent" ? p.userAgent : p.userAgent.replace(/^Mozilla\//, "");
    } });
  }
  const hints = (navigator as Navigator & { userAgentData?: {
    getHighEntropyValues(keys: string[]): Promise<Record<string, unknown>>;
  } }).userAgentData;
  if (hints) {
    const proto = Object.getPrototypeOf(hints);
    const original = hints.getHighEntropyValues;
    patchMethod(proto, "getHighEntropyValues", async function(this: typeof hints, keys: string[]) {
      const result = await original.call(this, keys);
      if (active()?.reduceAgent) {
        for (const key of ["architecture", "bitness", "model", "platformVersion", "uaFullVersion", "fullVersionList"]) {
          if (key in result) result[key] = key === "fullVersionList" ? [] : "";
        }
      }
      return result;
    });
  }

  if (navigator.geolocation) {
    const proto = Object.getPrototypeOf(navigator.geolocation);
    const get = proto.getCurrentPosition;
    const watch = proto.watchPosition;
    const clear = proto.clearWatch;
    let nextId = -1;
    const watches = new Map<number, { timer: ReturnType<typeof setTimeout>; notify: () => void }>();
    const position = (): GeolocationPosition => {
      const profile = active()?.profile;
      if (!profile) throw new Error("No location profile.");
      const coords = { latitude: profile.latitude, longitude: profile.longitude,
        accuracy: profile.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null };
      const value = { coords: { ...coords, toJSON: () => ({ ...coords }) }, timestamp: NativeDate.now() };
      return { ...value, toJSON: () => ({ coords: { ...coords }, timestamp: value.timestamp }) };
    };
    patchMethod(proto, "getCurrentPosition", function(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback, options?: PositionOptions) {
      if (typeof success !== "function") throw new TypeError("A location callback is required.");
      const p = active();
      if (!p?.location || !p.profile) return get.call(this, (value: GeolocationPosition) => {
        success(active()?.location && active()?.profile ? position() : value);
      }, error, options);
      setTimeout(() => {
        const current = active();
        if (current?.location && current.profile) success(position());
        else error?.({ code: 1, message: "Location privacy settings changed.", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      }, 0);
    });
    patchMethod(proto, "watchPosition", function(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback, options?: PositionOptions) {
      if (typeof success !== "function") throw new TypeError("A location callback is required.");
      const p = active();
      if (!p?.location || !p.profile) return watch.call(this, (value: GeolocationPosition) => {
        success(active()?.location && active()?.profile ? position() : value);
      }, error, options);
      const id = nextId--;
      const notify = () => {
        if (!watches.has(id)) return;
        const current = active();
        if (current?.location && current.profile) success(position());
        else {
          error?.({ code: 2, message: "No private location is currently available.", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        }
      };
      watches.set(id, { timer: setTimeout(notify, 0), notify });
      updates.add(notify);
      return id;
    });
    patchMethod(proto, "clearWatch", function(this: Geolocation, id: number) {
      if (id < 0) {
        const watcher = watches.get(id);
        if (watcher) { clearTimeout(watcher.timer); updates.delete(watcher.notify); watches.delete(id); }
      }
      else clear.call(this, id);
    });
  }

  function seed(): number {
    let value = active()?.seed ?? 0;
    for (const char of location.origin) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
  }
  function noise(data: Uint8Array | Uint8ClampedArray): void {
    if (!active()?.fingerprint || data.length < 4) return;
    const index = (seed() % Math.floor(data.length / 4)) * 4;
    data[index] = (data[index] ?? 0) ^ 1;
  }
  if (typeof CanvasRenderingContext2D !== "undefined") {
    const get = CanvasRenderingContext2D.prototype.getImageData;
    const put = CanvasRenderingContext2D.prototype.putImageData;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    patchMethod(CanvasRenderingContext2D.prototype, "getImageData", function(this: CanvasRenderingContext2D, ...args: Parameters<typeof get>) {
      const result = Reflect.apply(get, this, args) as ImageData;
      noise(result.data);
      return result;
    });
    function noisyCopy(canvas: HTMLCanvasElement): HTMLCanvasElement {
      if (!active()?.fingerprint || !canvas.width || !canvas.height) return canvas;
      const copy = document.createElement("canvas");
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext("2d");
      if (!context) return canvas;
      Reflect.apply(draw, context, [canvas, 0, 0]);
      const pixels = get.call(context, 0, 0, copy.width, copy.height);
      noise(pixels.data);
      Reflect.apply(put, context, [pixels, 0, 0]);
      return copy;
    }
    for (const method of ["toDataURL", "toBlob"] as const) {
      const original = HTMLCanvasElement.prototype[method];
      patchMethod(HTMLCanvasElement.prototype, method, function(this: HTMLCanvasElement, ...args: unknown[]) {
        return Reflect.apply(original, noisyCopy(this), args);
      });
    }
  }
  for (const ctor of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!ctor) continue;
    const original = ctor.prototype.readPixels;
    patchMethod(ctor.prototype, "readPixels", function(this: WebGLRenderingContext, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      const pixels = args[6];
      if (pixels instanceof Uint8Array) noise(pixels);
      return result;
    });
  }
  if (typeof AudioBuffer !== "undefined") {
    const get = AudioBuffer.prototype.getChannelData;
    const copy = AudioBuffer.prototype.copyFromChannel;
    const last = new WeakMap<Float32Array, number>();
    function perturb(data: Float32Array): void {
      if (!active()?.fingerprint || !data.length) return;
      const index = seed() % data.length;
      const sample = data[index] ?? 0;
      if (last.get(data) === sample) return;
      data[index] = sample + 0.0000001;
      last.set(data, data[index] ?? 0);
    }
    patchMethod(AudioBuffer.prototype, "getChannelData", function(this: AudioBuffer, channel: number) {
      const data = get.call(this, channel);
      perturb(data);
      return data;
    });
    patchMethod(AudioBuffer.prototype, "copyFromChannel", function(this: AudioBuffer, destination: Float32Array<ArrayBuffer>, channel: number, start?: number) {
      perturb(get.call(this, channel));
      return copy.call(this, destination, channel, start);
    });
  }
  for (const name of ["Worker", "SharedWorker"] as const) {
    const original = globalThis[name];
    if (!original) continue;
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: new Proxy(original, {
      construct(target, args, newTarget) {
        if (active()?.blockWorkers) throw new DOMException("Background workers are disabled in Tailchrome privacy settings.", "SecurityError");
        return Reflect.construct(target, args, newTarget);
      },
    }) });
  }
  if (typeof ServiceWorkerContainer !== "undefined") {
    const original = ServiceWorkerContainer.prototype.register;
    patchMethod(ServiceWorkerContainer.prototype, "register", function(this: ServiceWorkerContainer, ...args: Parameters<typeof original>) {
      if (active()?.blockWorkers) return Promise.reject(new DOMException("New service workers are disabled in Tailchrome privacy settings.", "SecurityError"));
      return Reflect.apply(original, this, args);
    });
  }
}

export function clearPagePrivacy(): void {
  const marker = Symbol.for("tailchrome.privacy.update");
  const realm = globalThis as typeof globalThis & { [marker]?: (policy: null) => void };
  realm[marker]?.(null);
}
