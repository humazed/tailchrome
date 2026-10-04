import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createSocket } from "node:dgram";
import puppeteer from "puppeteer";
import { createNativeHost } from "./native-host.mjs";
import { makeControl, makeRunningState, makeStoppedState } from "./fixtures.mjs";
import { createRoutingNetwork, createRoutingTLS, proxyCredentials, routingTestHost } from "./network-fixture.mjs";

const hits = [];
const errors = [];
const stun = createSocket("udp4");
let stunPackets = 0;
stun.on("message", (packet, remote) => {
  if (packet.length < 20 || packet.readUInt16BE(0) !== 1) return;
  stunPackets++;
  const reply = Buffer.alloc(32);
  reply.writeUInt16BE(0x0101, 0); reply.writeUInt16BE(12, 2);
  packet.copy(reply, 4, 4, 20);
  reply.writeUInt16BE(0x0020, 20); reply.writeUInt16BE(8, 22);
  reply[25] = 1; reply.writeUInt16BE(remote.port ^ 0x2112, 26);
  const octets = remote.address.split(".").map(Number);
  for (let index = 0; index < 4; index++) reply[28 + index] = octets[index] ^ packet[4 + index];
  stun.send(reply, remote.port, remote.address);
});
await new Promise((resolveListen, reject) => {
  stun.once("error", reject); stun.bind(0, "127.0.0.1", resolveListen);
});
const network = await createRoutingNetwork({ tls: createRoutingTLS(), handleRequest(req, res) {
  const url = new URL(req.url, "https://" + routingTestHost);
  hits.push({ path: url.pathname, host: url.hostname, headers: req.headers });
  res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store",
    "Accept-CH": "Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version" });
  res.end("<!doctype html><title>Privacy fixture</title><script>" +
    "window.early={zone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language,agent:navigator.userAgent};" +
    "</script><h1>Local privacy test</h1>");
} });
const egypt = { id: "privacy-exit", hostname: "Egypt fixture", dnsName: "", online: true,
  location: { countryCode: "EG" } };
function running(node) {
  const state = makeRunningState({ exitNode: node });
  state.prefs.exitNodeID = node.id;
  return state;
}
let browser;
let native;
const deadline = setTimeout(() => {
  errors.push("The privacy browser test exceeded its 90-second deadline.");
  void browser?.close();
}, 90_000);
try {
  native = createNativeHost("chrome", makeControl({
    allowRuntimeUpdates: true, proxyPort: network.proxyPort, proxyAuth: proxyCredentials, status: running(egypt),
  }));
  const extensionDir = await native.prepareExtension(resolve("packages/extension/.output/chrome-mv3"));
  const { chromeExtensionId: id } = JSON.parse(readFileSync("config/extension-ids.json", "utf8"));
  browser = await puppeteer.launch({
    headless: true, enableExtensions: [extensionDir], acceptInsecureCerts: true,
    args: ["--ignore-certificate-errors", ...(process.env.CI === "true" ? ["--no-sandbox"] : [])],
  });
  browser.on("targetcreated", async target => {
    if (target.type() !== "service_worker") return;
    const worker = await target.worker();
    worker?.on("error", error => errors.push(String(error)));
  });
  const settings = await browser.newPage();
  settings.on("pageerror", error => errors.push(String(error)));
  settings.setDefaultTimeout(10_000);
  await settings.goto(("chrome-extension://" + id) + "/privacy.html", { waitUntil: "domcontentloaded" });
  const request = (action, value) => settings.evaluate(async ({ action, value }) =>
    chrome.runtime.sendMessage({ feature: "privacy", action, settings: value }), { action, value });
  try {
    await settings.waitForFunction(() => document.getElementById("status-kind")?.textContent !== "Checking");
  } catch (error) {
    throw new Error("Settings did not initialize: " + JSON.stringify({
      text: await settings.evaluate(() => document.body.innerText), errors,
      storage: await settings.evaluate(() => chrome.storage.local.get(null)),
    }), { cause: error });
  }
  let snapshot = await request("get");
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  await settings.waitForFunction(async () => {
    const result = await chrome.runtime.sendMessage({ feature: "privacy", action: "get" });
    return result.currentNodeId === "privacy-exit" && result.status.kind === "ready";
  });
  snapshot = await request("get");
  assert.equal(snapshot.status.kind, "ready", JSON.stringify(snapshot.status));
  assert.equal(await settings.evaluate(() => chrome.runtime.getManifest().permissions.includes("userScripts")), false);
  const nativeZone = await settings.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const nativeLanguage = await settings.evaluate(() => navigator.language);
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(String(error)));
  page.setDefaultTimeout(10_000);
  await page.goto(network.baseURL + "/first");
  const observed = await page.evaluate(async () => {
    const location = await new Promise((resolveLocation, reject) => navigator.geolocation.getCurrentPosition(
      position => resolveLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }), reject));
    return {
      early: window.early, location, language: navigator.language, languages: navigator.languages,
      locale: Intl.NumberFormat().resolvedOptions().locale,
      temporal: typeof Temporal === "undefined" ? null : {
        zone: Temporal.Now.timeZoneId(),
        defaultZone: Temporal.Now.zonedDateTimeISO().timeZoneId,
        explicitZone: Temporal.Now.zonedDateTimeISO("Asia/Tokyo").timeZoneId,
        string: Temporal.Instant.from("2026-07-15T12:00:00Z").toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }),
      },
      winter: new Date("2026-01-15T12:00:00Z").getTimezoneOffset(),
      summer: new Date("2026-07-15T12:00:00Z").getTimezoneOffset(),
      localConstructor: new Date(2026, 6, 15, 12).toISOString(),
      localParse: new Date("2026-07-15T12:00:00").toISOString(),
      dateOnly: new Date("2026-07-15").toISOString(),
      yearOnly: new Date("2026").toISOString(),
      explicitZone: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo" }).resolvedOptions().timeZone,
      inheritedZone: new Intl.DateTimeFormat("en", Object.create({ timeZone: "Asia/Tokyo" })).resolvedOptions().timeZone,
      undefinedZone: new Intl.DateTimeFormat("en", { timeZone: undefined }).resolvedOptions().timeZone,
      gap: new Date(2026, 3, 24, 0, 30).toISOString(),
      fold: new Date(2026, 9, 29, 23, 30).toISOString(),
      invalid: new Date(NaN).toString(),
      parseUTC: Date.parse("2026-07-15T12:00:00Z"),
      now: Math.abs(Date.now() - new Date().getTime()),
      string: new Date("2026-07-15T12:00:00Z").toString(),
      setter: (() => { const date = new Date("2026-07-15T12:00:00Z"); date.setHours(16); return date.toISOString(); })(),
    };
  });
  assert.equal(observed.early.zone, "Africa/Cairo", JSON.stringify({ observed, errors }));
  assert.equal(observed.early.language, "ar-EG");
  assert.equal(observed.language, "ar-EG");
  assert.deepEqual(observed.languages, ["ar-EG"]);
  assert.equal(observed.locale, "ar-EG");
  assert.deepEqual(observed.temporal, { zone: "Africa/Cairo", defaultZone: "Africa/Cairo",
    explicitZone: "Asia/Tokyo", string: "15/07/2026, 15:00" });
  assert.deepEqual(observed.location, { latitude: 26.8206, longitude: 30.8025, accuracy: 600000 });
  assert.equal(observed.winter, -120);
  assert.equal(observed.summer, -180);
  assert.equal(observed.localConstructor, "2026-07-15T09:00:00.000Z");
  assert.equal(observed.localParse, "2026-07-15T09:00:00.000Z");
  assert.equal(observed.dateOnly, "2026-07-15T00:00:00.000Z");
  assert.equal(observed.yearOnly, "2026-01-01T00:00:00.000Z");
  assert.equal(observed.explicitZone, "Asia/Tokyo");
  assert.equal(observed.inheritedZone, "Asia/Tokyo");
  assert.equal(observed.undefinedZone, "Africa/Cairo");
  assert.equal(observed.gap, "2026-04-23T22:30:00.000Z");
  assert.equal(observed.fold, "2026-10-29T20:30:00.000Z");
  assert.equal(observed.invalid, "Invalid Date");
  assert.ok(observed.now < 100);
  assert.equal(observed.setter, "2026-07-15T13:00:00.000Z");
  assert.match(observed.string, /15:00:00 GMT\+0300/);
  const first = hits.find(hit => hit.path === "/first");
  assert.equal(first.headers["accept-language"], observed.language);
  assert.equal(first.headers["user-agent"], observed.early.agent);
  await page.evaluate(() => fetch("/client-hints"));
  const hinted = hits.find(hit => hit.path === "/client-hints");
  assert.equal(hinted.headers["sec-ch-ua-full-version-list"], undefined);
  assert.equal(hinted.headers["sec-ch-ua-platform-version"], undefined);
  const entropy = await page.evaluate(() => navigator.userAgentData.getHighEntropyValues(["platformVersion", "fullVersionList"]));
  assert.equal(entropy.platformVersion, "");
  assert.deepEqual(entropy.fullVersionList, []);
  console.log("PASS: first page script, headers, location, Date/Intl/Temporal, DST gaps/folds and explicit zones");

  const gather = () => page.evaluate(async port => {
    const connection = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:" + port }] });
    const candidates = [];
    try {
      const complete = new Promise((resolveGather, reject) => {
        const timer = setTimeout(() => reject(new Error("ICE gathering timed out")), 8000);
        connection.onicecandidate = event => {
          if (event.candidate) candidates.push(event.candidate.candidate);
          else { clearTimeout(timer); resolveGather(); }
        };
      });
      connection.createDataChannel("privacy-check");
      await connection.setLocalDescription(await connection.createOffer());
      await complete;
      return candidates;
    } finally { connection.close(); }
  }, stun.address().port);
  snapshot.settings.webRTC = false;
  await request("save", snapshot.settings);
  const baselineCandidates = await gather();
  assert.ok(stunPackets > 0, "Positive control must reach the local STUN server.");
  assert.ok(baselineCandidates.some(candidate => / udp /i.test(candidate)), "Positive control must gather a UDP candidate.");
  snapshot.settings.webRTC = true;
  await request("save", snapshot.settings);
  const beforeProtected = stunPackets;
  const protectedCandidates = await gather();
  assert.equal(stunPackets, beforeProtected, "Protected WebRTC must not send direct STUN traffic.");
  assert.ok(protectedCandidates.every(candidate => !/ udp /i.test(candidate)), JSON.stringify(protectedCandidates));
  console.log("PASS: WebRTC sends UDP to local STUN when disabled and blocks it when protection is enabled");

  const fingerprint = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 24;
    const context = canvas.getContext("2d"); context.fillStyle = "#345678"; context.fillRect(0, 0, 24, 24);
    const first = canvas.toDataURL();
    const second = canvas.toDataURL();
    const pixels = Array.from(context.getImageData(0, 0, 24, 24).data);
    const glCanvas = document.createElement("canvas"); glCanvas.width = 4; glCanvas.height = 4;
    const gl = glCanvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable in the test browser.");
    gl.clearColor(0.25, 0.5, 0.75, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const glPixels = new Uint8Array(64); const glAgain = new Uint8Array(64);
    gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, glPixels);
    gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, glAgain);
    const sound = new AudioBuffer({ length: 128, sampleRate: 44100 });
    const a = Array.from(sound.getChannelData(0));
    const b = Array.from(sound.getChannelData(0));
    const copied = new Float32Array(128); sound.copyFromChannel(copied, 0);
    const child = document.createElement("iframe"); child.src = "/child";
    document.body.append(child);
    await new Promise(resolveLoad => { child.onload = resolveLoad; });
    const childCanvas = child.contentDocument.createElement("canvas"); childCanvas.width = 24; childCanvas.height = 24;
    const childContext = childCanvas.getContext("2d"); childContext.fillStyle = "#345678"; childContext.fillRect(0, 0, 24, 24);
    return { first, second, childImage: childCanvas.toDataURL(), pixels, a, b, copied: Array.from(copied),
      glPixels: Array.from(glPixels), glAgain: Array.from(glAgain), childZone: child.contentWindow.early.zone };
  });
  assert.equal(fingerprint.first, fingerprint.second);
  assert.equal(fingerprint.first, fingerprint.childImage, "The per-origin session seed must agree between documents.");
  assert.ok(fingerprint.pixels.some((value, index) => value !== [0x34, 0x56, 0x78, 255][index % 4]));
  assert.deepEqual(fingerprint.glPixels, fingerprint.glAgain);
  assert.equal(new Set(fingerprint.glPixels.filter((_, index) => index % 4 === 0)).size, 2);
  assert.deepEqual(fingerprint.a, fingerprint.b);
  assert.deepEqual(fingerprint.a, fingerprint.copied);
  assert.ok(fingerprint.a.some(value => value !== 0));
  assert.equal(fingerprint.childZone, "Africa/Cairo");
  console.log("PASS: stable graphics/audio output and document-start frame coverage");

  // Exercise the actual form, not just the controller's message interface.
  await settings.bringToFront();
  await settings.locator("#language").setTimeout(10_000).click();
  await settings.locator("#save").setTimeout(10_000).click();
  await settings.waitForFunction(() => document.getElementById("feedback").textContent.startsWith("Saved."));
  assert.equal((await request("get")).settings.language, false);
  await page.goto(network.baseURL + "/language-off");
  assert.equal(await page.evaluate(() => navigator.language), nativeLanguage);
  assert.equal(hits.find(hit => hit.path === "/language-off").headers["accept-language"].split(",")[0], nativeLanguage);
  await settings.locator("#language").setTimeout(10_000).click();
  await settings.locator("#save").setTimeout(10_000).click();
  await settings.waitForFunction(() => document.getElementById("feedback").textContent.startsWith("Saved."));
  await page.goto(network.baseURL + "/language-on");
  assert.equal(await page.evaluate(() => window.early.language), "ar-EG");
  assert.equal(hits.find(hit => hit.path === "/language-on").headers["accept-language"], "ar-EG");
  console.log("PASS: settings form changes page and header language together");

  snapshot.settings.enabled = false;
  assert.equal((await request("save", snapshot.settings)).status.kind, "inactive");
  assert.equal(await settings.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length), 0);
  assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), nativeZone);
  snapshot.settings.enabled = true;
  assert.equal((await request("save", snapshot.settings)).status.kind, "ready");
  console.log("PASS: disabling restores open pages and removes request rules; re-enabling needs no extra permission");

  snapshot.settings.blockWorkers = true;
  assert.equal((await request("save", snapshot.settings)).status.kind, "ready");
  assert.equal(await page.evaluate(() => {
    try { new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }))); return "allowed"; }
    catch (error) { return error.name; }
  }), "SecurityError");
  console.log("PASS: worker blocking");

  snapshot.settings.excludedDomains = [routingTestHost];
  assert.equal((await request("save", snapshot.settings)).status.kind, "ready");
  await page.goto(network.baseURL + "/excluded");
  assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), nativeZone);
  assert.equal(hits.find(hit => hit.path === "/excluded").headers["accept-language"].split(",")[0], nativeLanguage);
  snapshot.settings.excludedDomains = [];
  snapshot.settings.cookies = "visited";
  await request("save", snapshot.settings);
  await page.goto(network.baseURL + "/cookies");
  await page.evaluate(() => { document.cookie = "privacy_fixture=1; path=/"; });
  const other = await browser.newPage(); await other.goto(network.baseURL + "/second-tab");
  await page.close();
  assert.match(await other.evaluate(() => document.cookie), /privacy_fixture=1/);
  await other.close();
  await settings.waitForFunction(async host => !(await chrome.cookies.getAll({ domain: host, name: "privacy_fixture" })).length, {}, routingTestHost);
  console.log("PASS: exclusions, cookie preservation while another tab is open, cleanup after last tab");

  await settings.evaluate(status => chrome.runtime.sendMessage({
    tailchromeE2ENative: { reply: { cmd: "status", status } },
  }), running({ ...egypt, id: "private-egypt", location: null }));
  await settings.waitForFunction(async () => {
    const result = await chrome.runtime.sendMessage({ feature: "privacy", action: "get" });
    return result.currentNodeId === "private-egypt" && result.status.kind === "ready";
  });
  const connected = await browser.newPage(); await connected.goto(network.baseURL + "/private-egypt");
  assert.equal(await connected.evaluate(() => window.early.zone), "Africa/Cairo");
  assert.equal(hits.find(hit => hit.path === "/private-egypt").headers["accept-language"], "ar-EG");
  await settings.evaluate(status => chrome.runtime.sendMessage({
    tailchromeE2ENative: { reply: { cmd: "status", status } },
  }), running({ ...egypt, id: "mismatched-exit", location: { countryCode: "JP" } }));
  await settings.waitForFunction(async () => {
    const result = await chrome.runtime.sendMessage({ feature: "privacy", action: "get" });
    return result.currentNodeId === "mismatched-exit" && result.status.kind === "attention";
  });
  assert.equal(await settings.evaluate(async () => (await chrome.declarativeNetRequest.getSessionRules()).length), 0);
  assert.equal(await connected.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), nativeZone);
  assert.equal(await connected.evaluate(() => Temporal.Now.timeZoneId()), nativeZone);
  await settings.evaluate(status => chrome.runtime.sendMessage({
    tailchromeE2ENative: { reply: { cmd: "status", status } },
  }), running(egypt));
  await settings.waitForFunction(async () => (await chrome.runtime.sendMessage({ feature: "privacy", action: "get" })).status.kind === "ready");
  assert.equal(await connected.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "Africa/Cairo");
  console.log("PASS: Egypt works without node coordinates; other countries are flagged and stale overrides cleared");
  await settings.evaluate(status => chrome.runtime.sendMessage({
    tailchromeE2ENative: { reply: { cmd: "status", status } },
  }), makeStoppedState());
  await settings.waitForFunction(async () => (await chrome.runtime.sendMessage({ feature: "privacy", action: "get" })).status.kind === "inactive");
  assert.equal(await connected.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), nativeZone);
  const restored = await settings.evaluate(async () => ({
    rules: await chrome.declarativeNetRequest.getSessionRules(),
    scripts: await chrome.scripting.getRegisteredContentScripts(),
    webRTC: await chrome.privacy.network.webRTCIPHandlingPolicy.get({}),
  }));
  assert.equal(restored.rules.length, 0);
  assert.equal(restored.scripts.length, 0);
  assert.notEqual(restored.webRTC.levelOfControl, "controlled_by_this_extension");
  assert.deepEqual(errors, []);
  console.log("PASS: exit-node changes, disconnect restoration, rule cleanup and WebRTC setting release");
  mkdirSync("evidence", { recursive: true });
  await settings.screenshot({ path: "evidence/privacy-settings-chrome-" + Date.now() + ".png", fullPage: true });
} finally {
  clearTimeout(deadline);
  await browser?.close();
  native?.cleanup();
  await network.close();
  await new Promise(resolveClose => stun.close(resolveClose));
}
