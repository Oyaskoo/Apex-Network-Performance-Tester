const ENDPOINT = "https://speed.cloudflare.com";
const DOWNLOAD_SIZES = [1_000_000, 4_000_000, 8_000_000];
const UPLOAD_SIZES = [1_000_000, 3_000_000, 5_000_000];
const HISTORY_KEY = "apex-speedtest-history-v1";

const $ = (id) => document.getElementById(id);
const gaugeTicks = $("gauge-ticks");
const gaugeLabels = $("gauge-labels");
const needle = $("needle");
const progressArc = $("gauge-progress");
const startButton = $("start-button");
const buttonLabel = $("button-label");
const toast = $("toast");
let running = false;
let currentController = null;
let toastTimeout = null;
const ARC_LENGTH = 479.862;
const AUX_DIAL_CONFIG = {
  upload: { max: 300, unit: "Mbps" },
  ping: { max: 300, unit: "ms" },
  jitter: { max: 250, unit: "ms" },
};

function polar(cx, cy, radius, angle) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function buildGauge() {
  for (let i = 0; i <= 40; i += 1) {
    const angle = -135 + (270 * i) / 40;
    const major = i % 5 === 0;
    const redline = i >= 34;
    const inner = polar(180, 218, major ? 120 : 125, angle);
    const outer = polar(180, 218, major ? 133 : 130, angle);
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", inner.x.toFixed(2));
    tick.setAttribute("y1", inner.y.toFixed(2));
    tick.setAttribute("x2", outer.x.toFixed(2));
    tick.setAttribute("y2", outer.y.toFixed(2));
    tick.setAttribute("class", `tick${major ? " major" : ""}${redline ? " redline" : ""}`);
    tick.dataset.index = String(i);
    gaugeTicks.append(tick);

    if (i % 8 === 0) {
      const position = polar(180, 218, 119, angle);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", position.x.toFixed(2));
      label.setAttribute("y", position.y.toFixed(2));
      label.setAttribute("class", `gauge-number${redline ? " red" : ""}`);
      label.textContent = String(Math.round((i / 40) * 500));
      gaugeLabels.append(label);
    }
  }
}

function buildAuxGauges() {
  document.querySelectorAll(".aux-gauge").forEach((dial) => {
    const config = AUX_DIAL_CONFIG[dial.dataset.gauge];
    if (!config) return;
    const ticks = dial.querySelector(".dial-ticks");
    const labels = dial.querySelector(".dial-labels");

    for (let index = 0; index <= 36; index += 1) {
      const angle = -135 + (270 * index) / 36;
      const major = index % 3 === 0;
      const redline = index >= 30;
      const inner = polar(80, 80, major ? 54 : 57, angle);
      const outer = polar(80, 80, 63, angle);
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", inner.x.toFixed(2));
      tick.setAttribute("y1", inner.y.toFixed(2));
      tick.setAttribute("x2", outer.x.toFixed(2));
      tick.setAttribute("y2", outer.y.toFixed(2));
      tick.setAttribute("class", `dial-tick${major ? " major" : ""}${redline ? " redline" : ""}`);
      tick.dataset.index = String(index);
      ticks.append(tick);

      if (index % 12 === 0) {
        const point = polar(80, 80, 44, angle);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", point.x.toFixed(2));
        label.setAttribute("y", point.y.toFixed(2));
        label.setAttribute("class", `dial-label${redline ? " red" : ""}`);
        label.textContent = String(Math.round((index / 36) * config.max));
        labels.append(label);
      }
    }
  });
}

function setAuxGauge(name, value) {
  const config = AUX_DIAL_CONFIG[name];
  const dial = document.querySelector(`.aux-gauge[data-gauge="${name}"]`);
  if (!dial || !config) return;
  const hasValue = Number.isFinite(value);
  const ratio = hasValue ? Math.max(0, Math.min(value / config.max, 1)) : 0;
  const angle = -135 + ratio * 270;
  dial.querySelector(".dial-needle").style.transform = `rotate(${angle}deg)`;
  dial.querySelectorAll(".dial-tick").forEach((tick) => {
    tick.classList.toggle("active", hasValue && Number(tick.dataset.index) <= Math.round(ratio * 36));
  });
  $(`${name}-result`).innerHTML = `${hasValue ? formatReading(value) : "—"}<span> ${config.unit}</span>`;
}

function setGauge(speed, phase) {
  const capped = Math.max(0, Math.min(speed, 500));
  const ratio = capped / 500;
  const angle = -135 + ratio * 270;
  needle.style.transform = `rotate(${angle}deg)`;
  progressArc.style.strokeDashoffset = String(ARC_LENGTH * (1 - ratio));
  const litTicks = Math.round(ratio * 40);
  gaugeTicks.querySelectorAll(".tick").forEach((tick) => {
    tick.classList.toggle("active", Number(tick.dataset.index) <= litTicks);
  });
  const suffix = phase === "download" ? " Mbps" : phase === "upload" ? " Mbps" : "";
  $("speed-value").innerHTML = `${formatSpeed(speed)}<span>${suffix}</span>`;
}

function formatSpeed(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatLatency(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function formatReading(value) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function setPhase(phase, label) {
  $("phase-label").textContent = label;
  $("phase-dot").classList.toggle("busy", running);
  $("phase-dot").classList.toggle("error", phase === "error");
  $("header-status").textContent = running ? "TEST IN PROGRESS" : phase === "error" ? "TEST INTERRUPTED" : phase === "done" ? "TEST COMPLETE" : "SYSTEM READY";
  $("header-status").previousElementSibling.classList.toggle("busy", running);
  $("header-status").previousElementSibling.classList.toggle("error", phase === "error");

  const activeIndex = { ping: 0, download: 1, upload: 2, done: 3, error: -1 }[phase] ?? 0;
  ["ping", "download", "upload"].forEach((name, index) => {
    const step = $(`step-${name}`);
    step.classList.toggle("active", index === activeIndex);
    step.classList.toggle("complete", index < activeIndex || phase === "done");
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 5200);
}

function saveHistory(result) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    history.unshift(result);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  } catch (error) {
    console.error("Could not save speed test history.", error);
    showToast("The test finished, but browser storage is unavailable; this result was not saved.");
  }
  renderHistory();
}

function renderHistory() {
  const list = $("history-list");
  let history;
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(history)) throw new TypeError("Saved history is not a list.");
  } catch (error) {
    console.error("Could not read speed test history.", error);
    history = [];
    showToast("Saved test history could not be read.");
  }
  if (!history.length) {
    list.innerHTML = '<div class="history-empty">No runs recorded yet. Start a test to log your first run.</div>';
    return;
  }
  list.innerHTML = history.map((entry) => {
    const date = new Date(entry.time);
    const dateText = Number.isNaN(date.getTime()) ? "Previous run" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="history-item">
      <div class="history-date">${dateText}</div>
      <div class="history-stat">${formatSpeed(entry.download)}<span>DOWNLOAD Mbps</span></div>
      <div class="history-stat">${formatSpeed(entry.upload)}<span>UPLOAD Mbps</span></div>
      <div class="history-stat">${formatLatency(entry.ping)}<span>PING ms</span></div>
      <div class="history-stat">${formatLatency(entry.jitter)}<span>JITTER ms</span></div>
    </div>`;
  }).join("");
}

async function fetchMeasuredTransfer(url, options, onProgress, signal) {
  const start = performance.now();
  const response = await fetch(url, { ...options, cache: "no-store", signal });
  if (!response.ok) throw new Error(`Speed-test server returned HTTP ${response.status}.`);
  if (!response.body) throw new Error("Your browser cannot stream the test response.");
  const reader = response.body.getReader();
  let transferred = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      transferred += value.byteLength;
      const elapsed = (performance.now() - start) / 1000;
      if (elapsed > 0) onProgress((transferred * 8) / elapsed / 1_000_000, transferred);
    }
  } finally {
    reader.releaseLock();
  }
  const seconds = (performance.now() - start) / 1000;
  if (transferred === 0 || seconds <= 0) throw new Error("The speed-test server returned no measurable data.");
  return { bytes: transferred, seconds };
}

function measureUpload(url, payload, onProgress, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The test was cancelled.", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const started = performance.now();
    const cleanUp = () => signal.removeEventListener("abort", abortRequest);
    const abortRequest = () => request.abort();
    request.open("POST", url);
    request.timeout = 120_000;
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed > 0) onProgress((event.loaded * 8) / elapsed / 1_000_000, event.loaded);
    });
    request.addEventListener("load", () => {
      cleanUp();
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`Speed-test server returned HTTP ${request.status}.`));
        return;
      }
      const seconds = (performance.now() - started) / 1000;
      if (seconds <= 0) {
        reject(new Error("The upload completed too quickly to measure."));
        return;
      }
      resolve({ bytes: payload.byteLength, seconds });
    });
    request.addEventListener("error", () => {
      cleanUp();
      reject(new TypeError("A network error interrupted the upload test."));
    });
    request.addEventListener("timeout", () => {
      cleanUp();
      reject(new Error("The upload test timed out."));
    });
    request.addEventListener("abort", () => {
      cleanUp();
      reject(new DOMException("The test was cancelled.", "AbortError"));
    });
    signal.addEventListener("abort", abortRequest, { once: true });
    request.send(payload);
  });
}

async function measurePing(signal) {
  const samples = [];
  for (let index = 0; index < 8; index += 1) {
    const started = performance.now();
    const response = await fetch(`${ENDPOINT}/__down?bytes=0&cacheBust=${Date.now()}-${index}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`Ping request failed with HTTP ${response.status}.`);
    await response.arrayBuffer();
    samples.push(performance.now() - started);
    const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    $("ping-result").innerHTML = `${formatLatency(average)}<span> ms</span>`;
    if (samples.length > 1) {
      const variation = samples.slice(1).reduce((sum, sample, i) => sum + Math.abs(sample - samples[i]), 0) / (samples.length - 1);
      $("jitter-result").innerHTML = `${formatLatency(variation)}<span> ms</span>`;
      setAuxGauge("jitter", variation);
    }
    setAuxGauge("ping", average);
  }
  const ping = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const jitter = samples.slice(1).reduce((sum, sample, index) => sum + Math.abs(sample - samples[index]), 0) / (samples.length - 1);
  setAuxGauge("ping", ping);
  setAuxGauge("jitter", jitter);
  return { ping, jitter };
}

async function runDownload(signal) {
  setPhase("download", "MEASURING DOWNLOAD");
  $("readout-label").textContent = "DOWNLOAD";
  $("readout-caption").textContent = "RECEIVING LIVE DATA";
  let totalBytes = 0;
  let totalSeconds = 0;
  for (const [index, bytes] of DOWNLOAD_SIZES.entries()) {
    const result = await fetchMeasuredTransfer(
      `${ENDPOINT}/__down?bytes=${bytes}&cacheBust=${Date.now()}-${index}`,
      {},
      (liveSpeed) => {
        setGauge(liveSpeed, "download");
      },
      signal,
    );
    totalBytes += result.bytes;
    totalSeconds += result.seconds;
  }
  const speed = (totalBytes * 8) / totalSeconds / 1_000_000;
  setGauge(speed, "download");
  return speed;
}

async function runUpload(signal) {
  setPhase("upload", "MEASURING UPLOAD");
  $("readout-label").textContent = "UPLOAD";
  $("readout-caption").textContent = "SENDING LIVE DATA";
  let totalBytes = 0;
  let totalSeconds = 0;
  setAuxGauge("upload", null);
  for (const [index, bytes] of UPLOAD_SIZES.entries()) {
    const payload = new Uint8Array(bytes);
    for (let offset = 0; offset < payload.length; offset += 65_536) {
      crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, payload.length)));
    }
    const result = await measureUpload(
      `${ENDPOINT}/__up?cacheBust=${Date.now()}-${index}`,
      payload,
      (liveSpeed) => {
        setGauge(liveSpeed, "upload");
        setAuxGauge("upload", liveSpeed);
      },
      signal,
    );
    totalBytes += result.bytes;
    totalSeconds += result.seconds;
  }
  const speed = (totalBytes * 8) / totalSeconds / 1_000_000;
  setAuxGauge("upload", speed);
  setGauge(speed, "upload");
  return speed;
}

async function runTest() {
  if (running) return;
  running = true;
  const controller = new AbortController();
  currentController = controller;
  startButton.disabled = true;
  buttonLabel.textContent = "TESTING…";
  $("readout-caption").textContent = "INITIALIZING TEST";
  $("engine-note").textContent = "REAL TRANSFER · CLOUDFLARE SPEED TEST";
  setAuxGauge("upload", null);
  setAuxGauge("ping", null);
  setAuxGauge("jitter", null);
  setGauge(0, "download");
  $("speed-value").innerHTML = `—<span> Mbps</span>`;
  try {
    setPhase("ping", "MEASURING LATENCY");
    $("readout-label").textContent = "PING / JITTER";
    $("readout-caption").textContent = "CHECKING ROUND-TRIP TIME";
    const { ping, jitter } = await measurePing(controller.signal);
    const download = await runDownload(controller.signal);
    const upload = await runUpload(controller.signal);
    setGauge(download, "download");
    const result = { time: new Date().toISOString(), download, upload, ping, jitter };
    saveHistory(result);
    running = false;
    currentController = null;
    startButton.disabled = false;
    buttonLabel.textContent = "RUN AGAIN";
    $("readout-label").textContent = "TEST COMPLETE";
    $("readout-caption").textContent = "MEASURED FROM THIS BROWSER";
    $("engine-note").textContent = "COMPLETE · LIVE TRANSFER RESULTS";
    setPhase("done", "TEST COMPLETE");
    return;
  } catch (error) {
    if (currentController !== controller) return;
    if (error.name === "AbortError") {
      $("readout-caption").textContent = "TEST CANCELLED";
      setPhase("error", "TEST CANCELLED");
    } else {
      console.error("Speed test failed.", error);
      const networkError = error instanceof TypeError;
      showToast(networkError
        ? "Could not reach the Cloudflare speed-test server. Check your connection or browser network permissions and retry."
        : error.message || "The speed test failed before it could complete. Please retry.");
      $("readout-caption").textContent = "NO VERIFIED RESULT";
      $("engine-note").textContent = "FAILED · NO COMPLETE RESULTS SAVED";
      setPhase("error", "TEST FAILED");
    }
    running = false;
    currentController = null;
    startButton.disabled = false;
    buttonLabel.textContent = "RETRY TEST";
  }
}

async function loadNetworkInfo() {
  try {
    const response = await fetch(`${ENDPOINT}/meta`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Network metadata request returned HTTP ${response.status}.`);
    const metadata = await response.json();
    $("isp-value").textContent = metadata.asOrganization || metadata.asn || "Unavailable";
    $("ip-value").textContent = metadata.clientIp || "Unavailable";
    const location = [metadata.city, metadata.region, metadata.country].filter(Boolean).join(", ");
    $("location-value").textContent = location || "Unavailable";
    $("edge-value").textContent = metadata.colo || "Cloudflare edge";
    $("server-short").textContent = metadata.colo ? `CLOUDFLARE · ${metadata.colo}` : "CLOUDFLARE NETWORK";
  } catch (error) {
    console.warn("Network metadata is unavailable.", error);
    $("isp-value").textContent = "Unavailable";
    $("ip-value").textContent = "Unavailable";
    $("location-value").textContent = "Unavailable";
    $("edge-value").textContent = "Nearest Cloudflare edge";
    $("server-short").textContent = "CLOUDFLARE NETWORK";
  }
}

function resetTest() {
  if (currentController) currentController.abort();
  running = false;
  currentController = null;
  startButton.disabled = false;
  buttonLabel.textContent = "START TEST";
  $("readout-label").textContent = "DOWNLOAD";
  $("readout-caption").textContent = "PRESS START TO BEGIN";
  $("engine-note").textContent = "REAL TRANSFER · CLOUDFLARE SPEED TEST";
  setAuxGauge("upload", null);
  setAuxGauge("ping", null);
  setAuxGauge("jitter", null);
  setGauge(0, "download");
  $("speed-value").innerHTML = `—<span> Mbps</span>`;
  setPhase("ready", "READY FOR IGNITION");
}

buildGauge();
buildAuxGauges();
renderHistory();
loadNetworkInfo();
startButton.addEventListener("click", runTest);
$("reset-button").addEventListener("click", resetTest);
$("clear-history").addEventListener("click", () => {
  try {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  } catch (error) {
    console.error("Could not clear speed test history.", error);
    showToast("Browser storage could not be cleared.");
  }
});
