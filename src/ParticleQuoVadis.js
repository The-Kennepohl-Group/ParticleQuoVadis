/*
 * Particle, Quo Vadis? — main simulation component
 * Copyright (c) 2026 Pierre Kennepohl, University of Calgary
 * MIT License (see LICENSE)
 *
 * This file contains JSX. It uses the .js extension (not .jsx) so that
 * static web servers — including GitHub Pages — serve it with the correct
 * JavaScript MIME type. Babel-standalone compiles the JSX in the browser
 * at load time; see index.html. No build step required.
 *
 * React is loaded globally from the UMD CDN script tags in index.html, so
 * this file uses the global `React` object directly rather than ES module
 * imports.
 */

const { useState, useEffect, useRef, useMemo } = React;

// =============================================================
// PHYSICS — infinite square well, dimensionless (ħ = 1, 2m = 1, L = 1)
// =============================================================

const L = 1;
const N_EIGEN = 6;
const eigenE = [];
for (let i = 1; i <= N_EIGEN; i++) eigenE.push(i * i * Math.PI * Math.PI);
// E_1 ≈ 9.87, E_2 ≈ 39.5, ..., E_6 ≈ 355.3

const E_SLIDER_MIN = 5;
const E_SLIDER_MAX = 380;
const E_HIST_MAX = 400;
const DT_QM = 0.0016;          // QM-time advance per logical step (16 ms equivalent)
const NBINS_X = 80;
const NBINS_E = 100;
const FLASH_AGE = 30;
const PAUSE_INCREMENT = 10000;

// Box-Muller Gaussian sample (mean 0, std 1)
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function infiniteWellPsi(n, x) {
  if ((x < 0) || (x > L)) return 0;
  return Math.sqrt(2 / L) * Math.sin(n * Math.PI * x / L);
}

// |c_n|² ∝ 1/((E_n - E_set)² + (Γ/2)²), normalized
function computeProbs(E_set, Gamma) {
  const half = Gamma / 2;
  const w = new Float64Array(N_EIGEN);
  let sum = 0;
  for (let i = 0; i < N_EIGEN; i++) {
    const d = eigenE[i] - E_set;
    w[i] = 1 / (d * d + half * half);
    sum += w[i];
  }
  for (let i = 0; i < N_EIGEN; i++) w[i] /= sum;
  return w;
}

function expectedEnergy(probs) {
  let E = 0;
  for (let i = 0; i < N_EIGEN; i++) E += probs[i] * eigenE[i];
  return E;
}

// |ψ(x,t)|² for real c_n: |Σ c_n ψ_n(x) e^{-iE_n t}|²
function densityAt(probs, x, t) {
  let re = 0, im = 0;
  for (let i = 0; i < N_EIGEN; i++) {
    if (probs[i] < 1e-14) continue;
    const c = Math.sqrt(probs[i]);
    const psin = infiniteWellPsi(i + 1, x);
    if (psin === 0) continue;
    const ph = -eigenE[i] * t;
    re += c * psin * Math.cos(ph);
    im += c * psin * Math.sin(ph);
  }
  return re * re + im * im;
}

function densityGrid(probs, t, N) {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = densityAt(probs, i / (N - 1), t);
  return out;
}

function sampleFromGrid(grid) {
  const N = grid.length;
  let cum = 0;
  const cdf = new Float64Array(N);
  for (let i = 0; i < N; i++) { cum += grid[i]; cdf[i] = cum; }
  if (cum === 0) return 0.5;
  const u = Math.random() * cum;
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo / (N - 1);
}

function sampleEnergyIdx(probs) {
  const u = Math.random();
  let cum = 0;
  for (let i = 0; i < N_EIGEN; i++) {
    cum += probs[i];
    if (u < cum) return i;
  }
  return N_EIGEN - 1;
}

// =============================================================
// MAIN COMPONENT
// =============================================================

// localStorage-backed useState: persists a value across reloads under a
// namespaced ("pqv:") key. Falls back to in-memory state if storage is
// unavailable (private browsing, quota, etc.). Mirrors the sibling app so the
// two share the same persistence convention.
function useSavedState(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch (e) { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }, [key, val]);
  return [val, setVal];
}

// Aggregate a probability-density array (length = native bins) down to a
// coarser display resolution. Densities are averaged within each group so the
// curve's overall shape and normalisation are preserved. target >= native is a
// no-op. Drives the "Histogram bins" setting.
function rebinDensity(arr, target) {
  const native = arr.length;
  if (!target || target >= native) return arr;
  const out = new Array(target).fill(0);
  const counts = new Array(target).fill(0);
  for (let i = 0; i < native; i++) {
    const j = Math.min(target - 1, Math.floor((i / native) * target));
    out[j] += arr[i];
    counts[j] += 1;
  }
  for (let j = 0; j < target; j++) out[j] = counts[j] ? out[j] / counts[j] : 0;
  return out;
}

function ParticleQuoVadis() {
  useEffect(() => {
    const link = document.createElement('link');
    link.href =
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  const [energy, setEnergy] = useState(Math.round(eigenE[0])); // start near ground state
  const [gamma, setGamma] = useSavedState('pqv:gamma', 1);
  const [instrSigma, setInstrSigma] = useSavedState('pqv:instrSigma', 0);
  const [classicalMode, setClassicalMode] = useSavedState('pqv:classicalMode', 'ballistic'); // 'ballistic' or 'brownian'
  const [reset, setReset] = useState(0);
  const [running, setRunning] = useState(true);
  const [showEigen, setShowEigen] = useSavedState('pqv:showEigen', false);
  const [showTheory, setShowTheory] = useSavedState('pqv:showTheory', false);
  const [showNotes, setShowNotes] = useSavedState('pqv:showNotes', false);   // "What you're looking at" expanded?
  const [paramsCollapsed, setParamsCollapsed] = useState(false);             // PARAMETERS section collapsed?
  const [settingsOpen, setSettingsOpen] = useState(false);                   // gear → settings modal open?
  const [pauseIncrement, setPauseIncrement] = useSavedState('pqv:pauseIncrement', PAUSE_INCREMENT); // auto-pause cadence
  const [waveTimeMult, setWaveTimeMult] = useSavedState('pqv:waveTimeMult', 1);   // visual ψ time-evolution speed
  const [histBins, setHistBins] = useSavedState('pqv:histBins', NBINS_X);         // position-histogram display bins
  const [showOverlay, setShowOverlay] = useSavedState('pqv:showOverlay', false);  // overlay classical + quantum on shared axes

  // Derived: probability amplitudes squared
  const probs = useMemo(() => computeProbs(energy, gamma), [energy, gamma]);
  const probsRef = useRef(probs);
  useEffect(() => { probsRef.current = probs; }, [probs]);

  const energyRef = useRef(energy);
  useEffect(() => { energyRef.current = energy; }, [energy]);

  const instrSigmaRef = useRef(instrSigma);
  useEffect(() => { instrSigmaRef.current = instrSigma; }, [instrSigma]);

  const classicalModeRef = useRef(classicalMode);
  useEffect(() => { classicalModeRef.current = classicalMode; }, [classicalMode]);

  const pauseIncrementRef = useRef(pauseIncrement);
  useEffect(() => { pauseIncrementRef.current = pauseIncrement; }, [pauseIncrement]);

  const waveTimeMultRef = useRef(waveTimeMult);
  useEffect(() => { waveTimeMultRef.current = waveTimeMult; }, [waveTimeMult]);

  // Simulation state
  const tRef = useRef(0);
  const personRef = useRef({ x: 0.5, dir: 1 });

  const classicalPosHistRef = useRef(new Float64Array(NBINS_X));
  const quantumPosHistRef = useRef(new Float64Array(NBINS_X));
  const classicalEnergyHistRef = useRef(new Float64Array(NBINS_E));
  const quantumEnergyHistRef = useRef(new Float64Array(NBINS_E));

  const classicalStepsRef = useRef(0);
  const classicalPosSumRef = useRef(0);
  const classicalEnergyMeasRef = useRef(0);
  const classicalEnergySumRef = useRef(0);
  const quantumPosMeasRef = useRef(0);
  const quantumPosSumRef = useRef(0);
  const quantumEnergyMeasRef = useRef(0);
  const quantumEnergySumRef = useRef(0);

  const recentPosMeasRef = useRef([]);            // quantum {x, age}
  const recentEnergyMeasRef = useRef([]);         // quantum {idx, age}
  const recentClassicalPosRef = useRef([]);       // classical {x, age}

  const [tick, setTick] = useState(0);

  // Reset on relevant changes
  useEffect(() => {
    classicalPosHistRef.current = new Float64Array(NBINS_X);
    quantumPosHistRef.current = new Float64Array(NBINS_X);
    classicalEnergyHistRef.current = new Float64Array(NBINS_E);
    quantumEnergyHistRef.current = new Float64Array(NBINS_E);
    personRef.current = { x: 0.5, dir: 1 };
    classicalStepsRef.current = 0;
    classicalPosSumRef.current = 0;
    classicalEnergyMeasRef.current = 0;
    classicalEnergySumRef.current = 0;
    quantumPosMeasRef.current = 0;
    quantumPosSumRef.current = 0;
    quantumEnergyMeasRef.current = 0;
    quantumEnergySumRef.current = 0;
    recentPosMeasRef.current = [];
    recentEnergyMeasRef.current = [];
    recentClassicalPosRef.current = [];
    // intentionally do NOT reset tRef so wavefunction view stays continuous
  }, [energy, gamma, instrSigma, classicalMode, reset]);

  // Full reset (button only): also restart QM time and pause briefly so the wipe is visible
  const lastResetRef = useRef(0);
  const nextPauseAtRef = useRef(pauseIncrement);
  useEffect(() => {
    if (reset === 0) return; // skip initial mount
    tRef.current = 0;
    lastResetRef.current = performance.now();
    nextPauseAtRef.current = pauseIncrementRef.current;
    setTick((t) => t + 1); // force one render with empty state
  }, [reset]);

  // Animation loop
  useEffect(() => {
    if (!running) return;
    let raf;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(60, now - last);
      last = now;
      // Brief pause after reset to make the wipe visible
      const sinceReset = now - lastResetRef.current;
      if (sinceReset > 400) {
        const steps = Math.max(1, Math.floor(dt / 16));
        for (let s = 0; s < steps; s++) {
          if (classicalStepsRef.current >= nextPauseAtRef.current) break;
          stepClassical();
          stepQuantum();
        }
      }
      // Pause at each 10,000-measurement checkpoint; user can Play again to continue.
      if (classicalStepsRef.current >= nextPauseAtRef.current) {
        nextPauseAtRef.current += pauseIncrementRef.current;
        setRunning(false);
      }
      // age recent flashes
      recentPosMeasRef.current = recentPosMeasRef.current
        .map((m) => ({ x: m.x, age: m.age + 1 }))
        .filter((m) => m.age < FLASH_AGE);
      recentEnergyMeasRef.current = recentEnergyMeasRef.current
        .map((m) => ({ E: m.E, age: m.age + 1 }))
        .filter((m) => m.age < FLASH_AGE);
      recentClassicalPosRef.current = recentClassicalPosRef.current
        .map((m) => ({ x: m.x, age: m.age + 1 }))
        .filter((m) => m.age < FLASH_AGE);
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  function stepClassical() {
    const p = personRef.current;
    const E = energyRef.current;
    const mode = classicalModeRef.current;

    if (mode === 'brownian') {
      // Overdamped random walk. The slider energy controls the step variance
      // so that the average kinetic-energy-equivalent matches E. In 1D
      // equipartition gives (1/2)<v²> = E (with m = 1/2, ℏ = 1 units),
      // so a step of √(2E)·dt is the velocity scale; we use Gaussian steps
      // of that magnitude per timestep.
      const stepScale = Math.sqrt(2 * E) * DT_QM;
      p.x += stepScale * randn();
      // Reflect at walls
      if (p.x < 0) p.x = -p.x;
      if (p.x > 1) p.x = 2 - p.x;
      // Belt-and-braces clamp in case of large excursions
      if ((p.x < 0) || (p.x > 1)) p.x = Math.random();
    } else {
      // Ballistic with speed jitter (±20%) to break the periodic orbit.
      const speed = Math.sqrt(2 * E) * DT_QM * (1 + (Math.random() - 0.5) * 0.4);
      p.x += p.dir * speed;
      // Wall reflection with a small bounce overshoot so the first/last
      // bins get sampled at the same rate as the interior.
      if ((p.x <= 0) || (p.x >= 1)) {
        const overshoot = Math.random() * 0.015;
        p.x = p.x <= 0 ? overshoot : 1 - overshoot;
        p.dir = -p.dir;
      }
    }

    // record position
    const bin = Math.min(NBINS_X - 1, Math.max(0, Math.floor(p.x * NBINS_X)));
    classicalPosHistRef.current[bin] += 1;
    classicalStepsRef.current += 1;
    classicalPosSumRef.current += p.x;
    // flash marker — every 5th step so individual events are distinguishable
    if (classicalStepsRef.current % 5 === 0) {
      recentClassicalPosRef.current.push({ x: p.x, age: 0 });
      if (recentClassicalPosRef.current.length > 40) recentClassicalPosRef.current.shift();
    }

    // ENERGY measurement: true energy is exactly E (slider), but the
    // instrument reports E + Gaussian noise with std = instrSigma.
    const sigma = instrSigmaRef.current;
    const eReported = E + sigma * randn();
    classicalEnergySumRef.current += eReported;
    classicalEnergyMeasRef.current += 1;
    const eBin = Math.min(NBINS_E - 1, Math.max(0, Math.floor((eReported / E_HIST_MAX) * NBINS_E)));
    if ((eReported >= 0) && (eReported < E_HIST_MAX)) {
      classicalEnergyHistRef.current[eBin] += 1;
    }
  }

  function stepQuantum() {
    const pr = probsRef.current;
    if (!pr) return;
    // advance time
    tRef.current += DT_QM * waveTimeMultRef.current;
    const t = tRef.current;

    // POSITION measurement: sample from |ψ(x,t)|² at current time
    const grid = densityGrid(pr, t, 200);
    const xSamp = sampleFromGrid(grid);
    const bin = Math.min(NBINS_X - 1, Math.max(0, Math.floor(xSamp * NBINS_X)));
    quantumPosHistRef.current[bin] += 1;
    quantumPosMeasRef.current += 1;
    quantumPosSumRef.current += xSamp;
    // flash marker — every 5th measurement, same downsampling as classical
    if (quantumPosMeasRef.current % 5 === 0) {
      recentPosMeasRef.current.push({ x: xSamp, age: 0 });
      if (recentPosMeasRef.current.length > 40) recentPosMeasRef.current.shift();
    }

    // ENERGY measurement: collapse onto eigenstate, then instrument adds noise
    const eIdx = sampleEnergyIdx(pr);
    const sigma = instrSigmaRef.current;
    const eReported = eigenE[eIdx] + sigma * randn();
    quantumEnergyMeasRef.current += 1;
    quantumEnergySumRef.current += eReported;
    const eBin = Math.min(NBINS_E - 1, Math.max(0, Math.floor((eReported / E_HIST_MAX) * NBINS_E)));
    if ((eReported >= 0) && (eReported < E_HIST_MAX)) {
      quantumEnergyHistRef.current[eBin] += 1;
    }
    if (quantumEnergyMeasRef.current % 5 === 0) {
      recentEnergyMeasRef.current.push({ E: eReported, age: 0 });
      if (recentEnergyMeasRef.current.length > 30) recentEnergyMeasRef.current.shift();
    }
  }

  // ---------- derived display data ----------
  const tCurrent = tRef.current;
  const psiDisplayDensity = useMemo(() => {
    const N = 300;
    const arr = new Array(N);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      arr[i] = { x, d: densityAt(probs, x, tCurrent) };
    }
    return arr;
    // intentionally update each tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, probs]);

  const classicalPosDensity = useMemo(() => {
    const total = classicalStepsRef.current;
    if (total === 0) return new Array(NBINS_X).fill(0);
    return Array.from(classicalPosHistRef.current).map((c) => (c / total) * NBINS_X);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const quantumPosDensity = useMemo(() => {
    const total = quantumPosMeasRef.current;
    if (total === 0) return new Array(NBINS_X).fill(0);
    return Array.from(quantumPosHistRef.current).map((c) => (c / total) * NBINS_X);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // time-averaged quantum density for overlay: Σ |c_n|² |ψ_n|²
  const quantumTimeAvg = useMemo(() => {
    const N = 300;
    const arr = new Array(N);
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      let d = 0;
      for (let k = 0; k < N_EIGEN; k++) {
        const psin = infiniteWellPsi(k + 1, x);
        d += probs[k] * psin * psin;
      }
      arr[i] = { x, d };
    }
    return arr;
  }, [probs]);

  const expectedE = useMemo(() => expectedEnergy(probs), [probs]);

  const eBinWidth = E_HIST_MAX / NBINS_E;
  const classicalEnergyDensity = useMemo(() => {
    const total = classicalEnergyMeasRef.current;
    if (total === 0) return new Array(NBINS_E).fill(0);
    return Array.from(classicalEnergyHistRef.current).map((c) => (c / total) / eBinWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, eBinWidth]);

  const quantumEnergyDensity = useMemo(() => {
    const total = quantumEnergyMeasRef.current;
    if (total === 0) return new Array(NBINS_E).fill(0);
    return Array.from(quantumEnergyHistRef.current).map((c) => (c / total) / eBinWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, eBinWidth]);

  // ---------- Data export (CSV & JSON) and load ----------
  function buildSnapshot() {
    const totalCount = classicalStepsRef.current;
    const cEnergyCount = classicalEnergyMeasRef.current;
    const qPosCount = quantumPosMeasRef.current;
    const qEnergyCount = quantumEnergyMeasRef.current;

    const cMeanX = totalCount > 0 ? classicalPosSumRef.current / totalCount : null;
    const qMeanX = qPosCount > 0 ? quantumPosSumRef.current / qPosCount : null;
    const cMeanE = cEnergyCount > 0 ? classicalEnergySumRef.current / cEnergyCount : null;
    const qMeanE = qEnergyCount > 0 ? quantumEnergySumRef.current / qEnergyCount : null;

    const now = new Date().toISOString();
    const meta = {
      exported_at: now,
      energy_setting: energy,
      classical_mode: classicalMode,
      gamma_internal: gamma,
      gamma_displayed: gamma - 1,
      instrument_sigma: instrSigma,
      well_type: 'infinite',
      energy_units: 'hbar^2 / (2 m L^2)',
      position_units: 'L (box length)',
      n_position_bins: NBINS_X,
      n_energy_bins: NBINS_E,
      energy_axis_max: E_HIST_MAX,
      n_eigenstates_included: N_EIGEN,
      hist_bins: histBins,
      show_overlay: showOverlay,
      pause_increment: pauseIncrement,
      wave_time_mult: waveTimeMult,
      classical_measurements: totalCount,
      classical_mean_x: cMeanX,
      classical_mean_E: cMeanE,
      quantum_position_measurements: qPosCount,
      quantum_energy_measurements: qEnergyCount,
      quantum_mean_x: qMeanX,
      quantum_mean_E: qMeanE,
    };

    const eigenvalues = [];
    for (let n = 1; n <= N_EIGEN; n++) {
      const E_n = n * n * Math.PI * Math.PI;
      // parity about the box centre and wavenumber k = √Eₙ = nπ/L, mirroring
      // the sibling app's eigenstate records (the infinite well has no κ).
      eigenvalues.push({ n, parity: (n % 2 === 1) ? 'even' : 'odd', E_n, k: Math.sqrt(E_n) });
    }

    const xBinW = 1 / NBINS_X;
    const eBinW = E_HIST_MAX / NBINS_E;
    const positionBins = [];
    for (let i = 0; i < NBINS_X; i++) {
      positionBins.push({
        bin_index: i,
        bin_center: (i + 0.5) * xBinW,
        classical: classicalPosDensity[i],
        quantum: quantumPosDensity[i],
      });
    }
    const energyBins = [];
    for (let i = 0; i < NBINS_E; i++) {
      energyBins.push({
        bin_index: i,
        bin_center: (i + 0.5) * eBinW,
        classical: classicalEnergyDensity[i],
        quantum: quantumEnergyDensity[i],
      });
    }

    return { meta, eigenvalues, positionBins, energyBins, now };
  }

  function baseFilename(now) {
    const stamp = now.replace(/[:T]/g, '-').slice(0, 19);
    return `pib_E${energy}_${classicalMode}_g${gamma - 1}_s${instrSigma}_${stamp}`;
  }

  function triggerDownload(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const snap = buildSnapshot();
    const fmt = (v) => v === null ? '' : (typeof v === 'number' ? v.toFixed(6) : v);

    const metaRows = [['key', 'value']];
    for (const [k, v] of Object.entries(snap.meta)) metaRows.push([k, fmt(v)]);

    const eigenRows = [['eigenstate_n', 'parity', 'energy_E_n', 'k']];
    for (const e of snap.eigenvalues) eigenRows.push([e.n, e.parity, fmt(e.E_n), fmt(e.k)]);

    const dataRows = [['type', 'panel', 'bin_index', 'bin_center', 'density']];
    for (const b of snap.positionBins) {
      dataRows.push(['position', 'classical', b.bin_index, fmt(b.bin_center), fmt(b.classical)]);
      dataRows.push(['position', 'quantum', b.bin_index, fmt(b.bin_center), fmt(b.quantum)]);
    }
    for (const b of snap.energyBins) {
      dataRows.push(['energy', 'classical', b.bin_index, fmt(b.bin_center), fmt(b.classical)]);
      dataRows.push(['energy', 'quantum', b.bin_index, fmt(b.bin_center), fmt(b.quantum)]);
    }

    function escape(v) {
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }
    const toCSV = (rows) => rows.map(r => r.map(escape).join(',')).join('\n');
    const csv = toCSV(metaRows) + '\n\n' + toCSV(eigenRows) + '\n\n' + toCSV(dataRows) + '\n';
    triggerDownload(csv, 'text/csv;charset=utf-8', `${baseFilename(snap.now)}.csv`);
  }

  function exportJSON() {
    const snap = buildSnapshot();
    const payload = {
      schema: 'particle-in-a-box-export/v1',
      meta: snap.meta,
      eigenvalues: snap.eigenvalues,
      position_histogram: {
        units: { bin_center: 'L', density: '1/L' },
        bins: snap.positionBins,
      },
      energy_histogram: {
        units: { bin_center: 'hbar^2/(2mL^2)', density: '(hbar^2/(2mL^2))^-1' },
        bins: snap.energyBins,
      },
    };
    triggerDownload(JSON.stringify(payload, null, 2), 'application/json', `${baseFilename(snap.now)}.json`);
  }

  // Pending file from a load action; held while we ask user whether to discard current data
  const [pendingLoadFile, setPendingLoadFile] = useState(null);
  const fileInputRef = useRef(null);

  function applyLoadedState(payload) {
    // Schema check — same version only
    if (payload.schema !== 'particle-in-a-box-export/v1') {
      alert(`Unsupported file: schema "${payload.schema || 'unknown'}". This app only loads "particle-in-a-box-export/v1" files.`);
      return false;
    }
    const m = payload.meta || {};
    // Bin-count compatibility (we don't migrate across changes)
    if (m.n_position_bins !== NBINS_X || m.n_energy_bins !== NBINS_E || m.energy_axis_max !== E_HIST_MAX || m.n_eigenstates_included !== N_EIGEN) {
      alert('File was created with different simulation parameters (bin counts or eigenstate range). Load aborted.');
      return false;
    }

    setRunning(false);

    // Restore settings
    if (typeof m.energy_setting === 'number') setEnergy(m.energy_setting);
    if (m.classical_mode === 'ballistic' || m.classical_mode === 'brownian') setClassicalMode(m.classical_mode);
    if (typeof m.gamma_internal === 'number') setGamma(m.gamma_internal);
    if (typeof m.instrument_sigma === 'number') setInstrSigma(m.instrument_sigma);
    // View/config state (added to match the sibling app; older files omit these).
    if (typeof m.hist_bins === 'number') setHistBins(m.hist_bins);
    if (typeof m.show_overlay === 'boolean') setShowOverlay(m.show_overlay);
    if (typeof m.pause_increment === 'number') setPauseIncrement(m.pause_increment);
    if (typeof m.wave_time_mult === 'number') setWaveTimeMult(m.wave_time_mult);

    // Reconstruct counts from density × total × binWidth
    const xBinW = 1 / NBINS_X;
    const eBinW = E_HIST_MAX / NBINS_E;
    const cPosTotal = m.classical_measurements || 0;
    const qPosTotal = m.quantum_position_measurements || 0;
    const cEnTotal = m.classical_measurements || 0;
    const qEnTotal = m.quantum_energy_measurements || 0;

    const cPos = new Float64Array(NBINS_X);
    const qPos = new Float64Array(NBINS_X);
    const cEn = new Float64Array(NBINS_E);
    const qEn = new Float64Array(NBINS_E);

    const posBins = payload.position_histogram?.bins || [];
    for (const b of posBins) {
      if (b.bin_index >= 0 && b.bin_index < NBINS_X) {
        cPos[b.bin_index] = (b.classical || 0) * cPosTotal * xBinW;
        qPos[b.bin_index] = (b.quantum || 0) * qPosTotal * xBinW;
      }
    }
    const eBins = payload.energy_histogram?.bins || [];
    for (const b of eBins) {
      if (b.bin_index >= 0 && b.bin_index < NBINS_E) {
        cEn[b.bin_index] = (b.classical || 0) * cEnTotal * eBinW;
        qEn[b.bin_index] = (b.quantum || 0) * qEnTotal * eBinW;
      }
    }

    classicalPosHistRef.current = cPos;
    quantumPosHistRef.current = qPos;
    classicalEnergyHistRef.current = cEn;
    quantumEnergyHistRef.current = qEn;

    classicalStepsRef.current = cPosTotal;
    quantumPosMeasRef.current = qPosTotal;
    classicalEnergyMeasRef.current = cEnTotal;
    quantumEnergyMeasRef.current = qEnTotal;

    // Restore running means (multiplied to sums)
    classicalPosSumRef.current = (m.classical_mean_x != null) ? m.classical_mean_x * cPosTotal : 0;
    quantumPosSumRef.current = (m.quantum_mean_x != null) ? m.quantum_mean_x * qPosTotal : 0;
    classicalEnergySumRef.current = (m.classical_mean_E != null) ? m.classical_mean_E * cEnTotal : 0;
    quantumEnergySumRef.current = (m.quantum_mean_E != null) ? m.quantum_mean_E * qEnTotal : 0;

    // Clear transient flash markers
    recentPosMeasRef.current = [];
    recentEnergyMeasRef.current = [];
    recentClassicalPosRef.current = [];

    // Advance the next-pause checkpoint past the loaded count so the user can run further immediately
    const inc = pauseIncrementRef.current;
    const ceiled = Math.ceil((cPosTotal + 1) / inc) * inc;
    nextPauseAtRef.current = Math.max(inc, ceiled);

    // Force a re-render
    setTick((t) => t + 1);
    return true;
  }

  function readFileAndLoad(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        applyLoadedState(payload);
      } catch (e) {
        alert(`Could not parse file: ${e.message}`);
      }
    };
    reader.onerror = () => alert('Could not read file.');
    reader.readAsText(file);
  }

  function handleFileChosen(file) {
    if (!file) return;
    if (classicalStepsRef.current > 0) {
      // Hold the file; user confirms via dialog
      setPendingLoadFile(file);
    } else {
      readFileAndLoad(file);
    }
  }

  const [saveMenuOpen, setSaveMenuOpen] = useState(false);

  useEffect(() => {
    if (!saveMenuOpen) return;
    function onKey(e) { if (e.key === 'Escape') setSaveMenuOpen(false); }
    function onClick() { setSaveMenuOpen(false); }
    // delay attaching click so the opening click itself doesn't immediately close it
    const t = setTimeout(() => {
      document.addEventListener('click', onClick);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [saveMenuOpen]);

  // ---------- styles ----------
  const styles = { body: 'DM Sans, ui-sans-serif, system-ui, sans-serif', display: 'Fraunces, ui-serif, Georgia, serif', mono: 'JetBrains Mono, ui-monospace, monospace' };
  const COL_BG = '#0e1320';
  const COL_PANEL = '#161c2e';
  const COL_INK = '#e9e4d4';
  const COL_INK_DIM = '#9aa0b4';
  const COL_RULE = '#232a40';
  const COL_CLASSICAL = '#e0a868';
  const COL_QUANTUM = '#7adfd0';
  const COL_ACCENT = '#c9a0ff';
  const COL_DANGER = '#e8745a';

  return (
    <div style={{ background: COL_BG, color: COL_INK, fontFamily: styles.body, minHeight: '100vh', padding: '20px 24px 32px' }}>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          pauseIncrement={pauseIncrement} setPauseIncrement={setPauseIncrement}
          waveTimeMult={waveTimeMult} setWaveTimeMult={setWaveTimeMult}
          histBins={histBins} setHistBins={setHistBins}
          col={{ panel: COL_PANEL, rule: COL_RULE, bg: COL_BG, ink: COL_INK, inkDim: COL_INK_DIM, accent: COL_ACCENT, quantum: COL_QUANTUM, danger: COL_DANGER }}
          fonts={styles}
        />
      )}
      {pendingLoadFile && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
          onClick={() => setPendingLoadFile(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: COL_PANEL, border: `1px solid ${COL_RULE}`, borderRadius: 6,
              padding: '20px 24px', maxWidth: 460, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              fontFamily: styles.body,
            }}
          >
            <div style={{ fontFamily: styles.display, fontSize: 22, fontStyle: 'italic', marginBottom: 10 }}>
              Discard current data?
            </div>
            <div style={{ color: COL_INK_DIM, fontSize: 14, lineHeight: 1.5, marginBottom: 18 }}>
              Loading <span style={{ color: COL_INK, fontFamily: styles.mono, fontSize: 13 }}>{pendingLoadFile.name}</span> will replace your current simulation state ({classicalStepsRef.current.toLocaleString()} measurements). Save first?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingLoadFile(null)}
                style={{
                  padding: '8px 14px', background: 'transparent', color: COL_INK_DIM,
                  border: `1px solid ${COL_RULE}`, borderRadius: 4, cursor: 'pointer',
                  fontFamily: styles.mono, fontSize: 13, letterSpacing: 0.3,
                }}
              >Cancel</button>
              <button
                onClick={() => {
                  const f = pendingLoadFile;
                  setPendingLoadFile(null);
                  readFileAndLoad(f);
                }}
                style={{
                  padding: '8px 14px', background: 'transparent', color: COL_DANGER,
                  border: `1px solid ${COL_DANGER}`, borderRadius: 4, cursor: 'pointer',
                  fontFamily: styles.mono, fontSize: 13, letterSpacing: 0.3,
                }}
              >Discard and load</button>
              <button
                onClick={() => {
                  exportJSON();
                  const f = pendingLoadFile;
                  setPendingLoadFile(null);
                  readFileAndLoad(f);
                }}
                style={{
                  padding: '8px 14px', background: COL_QUANTUM, color: '#0e1320',
                  border: `1px solid ${COL_QUANTUM}`, borderRadius: 4, cursor: 'pointer',
                  fontFamily: styles.mono, fontSize: 13, letterSpacing: 0.3, fontWeight: 600,
                }}
              >Save first, then load</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        {/* TITLE + TOP BAR */}
        <header style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: styles.display, fontWeight: 400, fontSize: 38, margin: 0, padding: 0, lineHeight: 1, letterSpacing: -0.5, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
            Particle, Quo Vadis?
          </h1>
          <div style={{ fontFamily: styles.mono, fontSize: 13, color: COL_INK_DIM, letterSpacing: 0.5, lineHeight: 1.4 }}>
            <div>Classical and quantum particles</div>
            <div>in a one-dimensional box</div>
          </div>
        </header>

        {/* ===== PARAMETERS (collapsible): Γ / σ controls + energy slider ===== */}
        <CollapsibleSection
          title="Parameters"
          expanded={!paramsCollapsed}
          onToggle={() => setParamsCollapsed((c) => !c)}
          mono={styles.mono}
          inkDim={COL_INK_DIM}
          bg={COL_PANEL}
          rule={COL_RULE}
          style={{ marginTop: 0, marginBottom: 14 }}
        >
          <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Γ / σ controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: '0 1 300px', minWidth: 260 }}>
              <PreferenceNumberRow
                label="Spectral resolution Γ"
                value={gamma}
                onChange={setGamma}
                min={1}
                max={40}
                displayOffset={-1}
                accent={COL_QUANTUM}
                ink={COL_INK}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                mono={styles.mono}
              />
              <PreferenceNumberRow
                label="Instrument resolution σ"
                value={instrSigma}
                onChange={setInstrSigma}
                min={0}
                max={30}
                accent={COL_DANGER}
                ink={COL_INK}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                mono={styles.mono}
              />
            </div>

            {/* Quantum bound states — read-only table. The |cₙ|² column
                (Born probabilities + bars) only appears when "Show
                eigenstates" is on, mirroring the sibling app. The infinite
                well has no continuum, so there is no 1/κ (evanescent decay
                length) column. */}
            <div style={{ flex: '1 1 320px', minWidth: 280, fontFamily: styles.mono, fontSize: 12, color: COL_INK_DIM, fontVariantNumeric: 'tabular-nums' }}>
              <div style={{ marginBottom: 6 }}>
                Quantum bound states (<span style={{ color: COL_INK }}>{N_EIGEN}</span>)
              </div>
              {(() => {
                const cols = showEigen ? '20px 56px 52px 48px 1fr' : '20px 56px 52px 48px';
                const headerCellStyle = { fontSize: 10, color: COL_INK_DIM, letterSpacing: 0.5 };
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 10, alignItems: 'baseline', marginBottom: 4 }}>
                      <div style={headerCellStyle}><i>n</i></div>
                      <div style={headerCellStyle} title="Energy in engine units (ℏ²/2mL²)"><i>E</i><sub>n</sub></div>
                      <div style={headerCellStyle} title="Wavefunction parity about the centre of the box">parity</div>
                      <div style={headerCellStyle} title="Wavenumber inside the box, √Eₙ = nπ/L">k</div>
                      {showEigen && (
                        <div style={headerCellStyle} title="Born probability — fraction of the current preparation in this state">|c<sub>n</sub>|²</div>
                      )}
                    </div>
                    {eigenE.map((E, i) => {
                      const n = i + 1;
                      const parity = (n % 2 === 1) ? 'even' : 'odd';
                      const k = Math.sqrt(E);
                      const p = (probs && probs[i]) || 0;
                      const pct = p >= 0.001 ? (p * 100).toFixed(p < 0.1 ? 1 : 0) + '%' : (p > 0 ? '<0.1%' : '—');
                      return (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 10, alignItems: 'center', height: 22 }}>
                          <div>{n}</div>
                          <div style={{ color: COL_INK }}>{E.toFixed(1)}</div>
                          <div>{parity}</div>
                          <div>{k.toFixed(1)}</div>
                          {showEigen && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                              <div style={{ flex: 1, height: 4, background: COL_RULE, borderRadius: 2, overflow: 'hidden', minWidth: 24 }}>
                                <div style={{ width: Math.max(0, Math.min(100, p * 100)) + '%', height: '100%', background: COL_QUANTUM, transition: 'width 0.15s' }} />
                              </div>
                              <div style={{ width: 38, textAlign: 'right', fontSize: 10, color: p >= 0.01 ? COL_INK : COL_INK_DIM }}>{pct}</div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>

            {/* ENERGY SLIDER — in its own bordered box (matches PQVR) */}
            <div style={{ ...panel(COL_PANEL, COL_RULE), padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <VerticalSlider
                label="Energy"
                value={energy}
                onChange={setEnergy}
                min={E_SLIDER_MIN}
                max={E_SLIDER_MAX}
                accent={COL_ACCENT}
                rule={COL_RULE}
                inkDim={COL_INK_DIM}
                ink={COL_INK}
                mono={styles.mono}
                ticks={showEigen ? eigenE : null}
                tickLabel="E"
                decimals={0}
                onTickClick={showEigen ? (E) => setEnergy(Math.round(E)) : null}
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* ===== TRANSPORT BAR: buttons + view toggles + measurement count ===== */}
        <div style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 24, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TransportButton
              kind="play"
              active={running}
              onClick={() => setRunning(true)}
              colour={COL_QUANTUM}
              bg={COL_PANEL}
              rule={COL_RULE}
            />
            <TransportButton
              kind="pause"
              active={!running}
              onClick={() => setRunning(false)}
              colour={COL_INK}
              bg={COL_PANEL}
              rule={COL_RULE}
            />
            <TransportButton
              kind="stop"
              active={false}
              onClick={() => { setRunning(false); setReset((r) => r + 1); }}
              colour={COL_DANGER}
              bg={COL_PANEL}
              rule={COL_RULE}
            />
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <TransportButton
                kind="save"
                active={saveMenuOpen}
                onClick={() => {
                  if (classicalStepsRef.current === 0) return;
                  setSaveMenuOpen((o) => !o);
                }}
                colour={classicalStepsRef.current > 0 ? COL_QUANTUM : COL_INK_DIM}
                bg={COL_PANEL}
                rule={COL_RULE}
              />
              {saveMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '110%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: COL_PANEL,
                    border: `1px solid ${COL_RULE}`,
                    borderRadius: 4,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    zIndex: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 96,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => { exportCSV(); setSaveMenuOpen(false); }}
                    style={{
                      padding: '8px 14px', background: 'transparent', color: COL_INK,
                      border: 'none', cursor: 'pointer', fontFamily: styles.mono, fontSize: 13,
                      textAlign: 'left', letterSpacing: 0.3,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = COL_RULE; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >CSV</button>
                  <button
                    onClick={() => { exportJSON(); setSaveMenuOpen(false); }}
                    style={{
                      padding: '8px 14px', background: 'transparent', color: COL_INK,
                      border: 'none', cursor: 'pointer', fontFamily: styles.mono, fontSize: 13,
                      textAlign: 'left', letterSpacing: 0.3,
                      borderTop: `1px solid ${COL_RULE}`,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = COL_RULE; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >JSON</button>
                </div>
              )}
            </div>
            <TransportButton
              kind="load"
              active={false}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              colour={COL_QUANTUM}
              bg={COL_PANEL}
              rule={COL_RULE}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                handleFileChosen(f);
                e.target.value = ''; // allow re-loading the same file
              }}
            />
            <TransportButton
              kind="settings"
              active={settingsOpen}
              onClick={() => setSettingsOpen((o) => !o)}
              colour={COL_INK_DIM}
              bg={COL_PANEL}
              rule={COL_RULE}
            />
          </div>

          {/* View toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
            <CheckboxRow
              checked={showTheory}
              onChange={() => setShowTheory(!showTheory)}
              label="Show theory"
              accent={COL_QUANTUM}
              ink={COL_INK}
              inkDim={COL_INK_DIM}
              rule={COL_RULE}
              mono={styles.mono}
            />
            <CheckboxRow
              checked={showEigen}
              onChange={() => setShowEigen(!showEigen)}
              label="Show eigenstates"
              accent={COL_ACCENT}
              ink={COL_INK}
              inkDim={COL_INK_DIM}
              rule={COL_RULE}
              mono={styles.mono}
            />
            <CheckboxRow
              checked={showOverlay}
              onChange={() => setShowOverlay(!showOverlay)}
              label="Overlay simulations"
              accent={COL_INK}
              ink={COL_INK}
              inkDim={COL_INK_DIM}
              rule={COL_RULE}
              mono={styles.mono}
            />
          </div>

          {/* Measurement count */}
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontFamily: styles.mono, lineHeight: 1.1 }}>
            <div style={{ fontSize: 22, color: COL_INK, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
              {classicalStepsRef.current.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: COL_INK_DIM, letterSpacing: 1, textTransform: 'uppercase', marginTop: 3 }}>measurements</div>
          </div>
        </div>

        {/* MAIN GRID (two panels) — or the combined OVERLAY when toggled */}
        {showOverlay ? (
          <section style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <PanelHeader tag="Overlay" title=" " color={COL_INK} styles={styles} compact />
              <div style={{ display: 'flex', gap: 16, fontFamily: styles.mono, fontSize: 12, color: COL_INK_DIM }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 2, background: COL_CLASSICAL, display: 'inline-block', opacity: 0.7 }} />classical</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 2, background: COL_QUANTUM, display: 'inline-block', opacity: 0.7 }} />quantum</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <OverlaySimView
                  density={psiDisplayDensity}
                  particleX={personRef.current.x}
                  colC={COL_CLASSICAL}
                  colQ={COL_QUANTUM}
                  ink={COL_INK}
                  bg={COL_PANEL}
                />
                <OverlayPositionHistogram
                  histA={rebinDensity(classicalPosDensity, histBins)}
                  histB={rebinDensity(quantumPosDensity, histBins)}
                  colA={COL_CLASSICAL}
                  colB={COL_QUANTUM}
                  ink={COL_INK}
                  inkDim={COL_INK_DIM}
                  rule={COL_RULE}
                  styles={styles}
                  meanXA={classicalStepsRef.current > 0 ? classicalPosSumRef.current / classicalStepsRef.current : null}
                  meanXB={quantumPosMeasRef.current > 0 ? quantumPosSumRef.current / quantumPosMeasRef.current : null}
                />
              </div>
              <OverlayVerticalEnergyHistogram
                densityA={classicalEnergyDensity}
                densityB={quantumEnergyDensity}
                colA={COL_CLASSICAL}
                colB={COL_QUANTUM}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                styles={styles}
                eSet={energy}
                accentColor={COL_ACCENT}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 36, fontFamily: styles.mono, fontSize: 13, color: COL_INK_DIM, paddingTop: 2, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span>⟨x⟩</span>
                <span style={{ color: COL_CLASSICAL, fontVariantNumeric: 'tabular-nums' }}>{classicalStepsRef.current > 0 ? (classicalPosSumRef.current / classicalStepsRef.current).toFixed(2) + 'L' : '—'}</span>
                <span style={{ color: COL_QUANTUM, fontVariantNumeric: 'tabular-nums' }}>{quantumPosMeasRef.current > 0 ? (quantumPosSumRef.current / quantumPosMeasRef.current).toFixed(2) + 'L' : '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span>⟨E⟩</span>
                <span style={{ color: COL_CLASSICAL, fontVariantNumeric: 'tabular-nums' }}>{classicalEnergyMeasRef.current > 0 ? (classicalEnergySumRef.current / classicalEnergyMeasRef.current).toFixed(1) : '—'}</span>
                <span style={{ color: COL_QUANTUM, fontVariantNumeric: 'tabular-nums' }}>{quantumEnergyMeasRef.current > 0 ? (quantumEnergySumRef.current / quantumEnergyMeasRef.current).toFixed(1) : '—'}</span>
              </div>
            </div>
          </section>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* ============ CLASSICAL ============ */}
          <section style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <PanelHeader tag="Classical" title=" " color={COL_CLASSICAL} styles={styles} compact />
              <ModeToggle
                value={classicalMode}
                onChange={setClassicalMode}
                options={[{ value: 'ballistic', label: 'ballistic' }, { value: 'brownian', label: 'Brownian' }]}
                accent={COL_CLASSICAL}
                ink={COL_INK}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                mono={styles.mono}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <ParticleView
                  x={personRef.current.x}
                  recentMeasurements={recentClassicalPosRef.current}
                  col={COL_CLASSICAL}
                  wall={COL_INK}
                  bg={COL_PANEL}
                />
                <PositionHistogram
                  hist={rebinDensity(classicalPosDensity, histBins)}
                  overlay={null}
                  col={COL_CLASSICAL}
                  ink={COL_INK}
                  inkDim={COL_INK_DIM}
                  rule={COL_RULE}
                  styles={styles}
                  label={null}
                  recentMarkers={recentClassicalPosRef.current}
                  accentColor={COL_CLASSICAL}
                  meanX={classicalStepsRef.current > 0 ? classicalPosSumRef.current / classicalStepsRef.current : null}
                />
              </div>
              <VerticalEnergyHistogram
                density={classicalEnergyDensity}
                eigenValues={eigenE}
                theoretical={null}
                col={COL_CLASSICAL}
                ink={COL_INK}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                styles={styles}
                showEigen={showEigen}
                recentMarkers={null}
                eSet={energy}
                accentColor={COL_CLASSICAL}
                meanE={classicalEnergyMeasRef.current > 0 ? classicalEnergySumRef.current / classicalEnergyMeasRef.current : null}
              />
            </div>
          </section>

          {/* ============ QUANTUM ============ */}
          <section style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <PanelHeader tag="Quantum" title=" " color={COL_QUANTUM} styles={styles} compact />
              {/* spacer to balance classical's mode toggle height */}
              <div style={{ height: 24 }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px', gap: 10, alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <WavefunctionView
                  density={psiDisplayDensity}
                  recentMeasurements={recentPosMeasRef.current}
                  col={COL_QUANTUM}
                  ink={COL_INK}
                  inkDim={COL_INK_DIM}
                  bg={COL_PANEL}
                  styles={styles}
                  showWave={showTheory}
                />
                <PositionHistogram
                  hist={rebinDensity(quantumPosDensity, histBins)}
                  overlay={showTheory ? quantumTimeAvg : null}
                  col={COL_QUANTUM}
                  ink={COL_INK}
                  inkDim={COL_INK_DIM}
                  rule={COL_RULE}
                  styles={styles}
                  label={null}
                  recentMarkers={recentPosMeasRef.current}
                  accentColor={COL_QUANTUM}
                  meanX={quantumPosMeasRef.current > 0 ? quantumPosSumRef.current / quantumPosMeasRef.current : null}
                />
              </div>
              <VerticalEnergyHistogram
                density={quantumEnergyDensity}
                eigenValues={eigenE}
                theoretical={showTheory ? Array.from(probs) : null}
                col={COL_QUANTUM}
                ink={COL_INK}
                inkDim={COL_INK_DIM}
                rule={COL_RULE}
                styles={styles}
                showEigen={showEigen}
                recentMarkers={recentEnergyMeasRef.current}
                eSet={energy}
                accentColor={COL_ACCENT}
                meanE={quantumEnergyMeasRef.current > 0 ? quantumEnergySumRef.current / quantumEnergyMeasRef.current : null}
              />
            </div>
          </section>
        </div>
        )}

        {/* NOTES — collapsible "What you're looking at" */}
        <CollapsibleSection
          title="What you're looking at"
          expanded={showNotes}
          onToggle={() => setShowNotes((v) => !v)}
          mono={styles.mono}
          inkDim={COL_INK_DIM}
          bg={COL_PANEL}
          rule={COL_RULE}
        >
          <Notes energy={energy} probs={probs} gamma={gamma} display={styles.display} body={styles.body} ink={COL_INK} cCol={COL_CLASSICAL} qCol={COL_QUANTUM} aCol={COL_ACCENT} />
        </CollapsibleSection>

        <footer style={{ marginTop: 28, fontSize: 13, color: COL_INK_DIM, fontFamily: styles.mono, textAlign: 'center', letterSpacing: 1 }}>
          Energy quantization · Lorentzian-weighted superpositions · time-evolving |ψ|² · infinite square well
        </footer>
      </div>
    </div>
  );
}

// =============================================================
// SUBCOMPONENTS
// =============================================================

function ctrlBtn(c, bg) {
  const isDim = c === '#9aa0b4';
  return { background: isDim ? 'transparent' : c, color: isDim ? c : bg, border: `1px solid ${c}`, padding: '6px 12px', fontFamily: 'DM Sans, sans-serif', fontSize: 12, letterSpacing: 0.3, cursor: 'pointer', borderRadius: 2 };
}

function panel(bg, rule) {
  return { background: bg, border: `1px solid ${rule}`, borderRadius: 4, padding: '14px 18px' };
}

// Collapsible card with an uppercase mono header and a rotating ▾ chevron.
// Mirrors the sibling app (PQVR) so the two read as a matched set.
function CollapsibleSection({ title, expanded, onToggle, children, mono, inkDim, bg, rule, style }) {
  return (
    <section style={{ marginTop: 22, ...panel(bg, rule), ...style }}>
      <button
        onClick={onToggle}
        title={expanded ? 'Click to collapse' : 'Click to expand'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', width: '100%', textAlign: 'left' }}
      >
        <span style={{ fontFamily: mono, fontSize: 12, color: inkDim, width: 14, display: 'inline-block', textAlign: 'center', transition: 'transform 0.15s', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
        <span style={{ fontFamily: mono, fontSize: 13, color: inkDim, letterSpacing: 1.5, textTransform: 'uppercase' }}>{title}</span>
      </button>
      {expanded && <div style={{ marginTop: 12 }}>{children}</div>}
    </section>
  );
}

// ---------- Settings modal (gear button → popup) ----------
// The infinite-well subset of the sibling app's settings: cadence of the
// auto-pause, visual speed of the wavefunction, and histogram display
// resolution. Changes apply live and persist to localStorage.
function SettingsModal({ onClose, pauseIncrement, setPauseIncrement, waveTimeMult, setWaveTimeMult, histBins, setHistBins, col, fonts }) {
  const rowStyle = { display: 'grid', gridTemplateColumns: '200px 1fr 240px', gap: 14, alignItems: 'center', paddingTop: 10, paddingBottom: 10, borderBottom: `1px solid ${col.bg}` };
  const labelStyle = { fontFamily: fonts.mono, fontSize: 13, color: col.ink, letterSpacing: 0.3 };
  const hintStyle = { fontFamily: fonts.body, fontSize: 12, color: col.inkDim, lineHeight: 1.4 };
  const inputStyle = { width: 80, padding: '4px 8px', textAlign: 'right', background: 'transparent', color: col.accent, fontWeight: 600, border: `1.5px solid ${col.rule}`, borderRadius: 3, fontFamily: fonts.mono, fontSize: 14, fontVariantNumeric: 'tabular-nums' };
  function intInput(value, onChange, min, max) {
    return <input type="number" min={min} max={max} step={1} value={value} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))); }} style={inputStyle} />;
  }
  function floatInput(value, onChange, min, max, step) {
    return <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v))); }} style={inputStyle} />;
  }
  function resetAll() { setPauseIncrement(10000); setWaveTimeMult(1); setHistBins(NBINS_X); }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: col.panel, border: `1px solid ${col.rule}`, borderRadius: 6, padding: '20px 28px', maxWidth: 640, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', fontFamily: fonts.body, color: col.ink, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ fontFamily: fonts.display, fontSize: 24, fontStyle: 'italic', marginBottom: 16, color: col.ink }}>Settings</div>
        <div style={{ fontFamily: fonts.body, fontSize: 13, color: col.inkDim, marginBottom: 8, lineHeight: 1.5 }}>Settings apply immediately and persist across reloads.</div>
        <div style={rowStyle}>
          <div style={labelStyle}>Measurements per cycle</div>
          {intInput(pauseIncrement, setPauseIncrement, 1000, 50000)}
          <div style={hintStyle}>How often the simulation auto-pauses so you can watch convergence as a process. Default 10 000.</div>
        </div>
        <div style={rowStyle}>
          <div style={labelStyle}>Wavefunction time speed</div>
          {floatInput(waveTimeMult, setWaveTimeMult, 0.1, 20, 0.1)}
          <div style={hintStyle}>Visual speed of the |ψ(x,t)|² evolution. Does not change the converged distributions — only how fast the wave animates. Default 1×.</div>
        </div>
        <div style={rowStyle}>
          <div style={labelStyle}>Histogram bins</div>
          {intInput(histBins, setHistBins, 10, NBINS_X)}
          <div style={hintStyle}>Display resolution of the P(x) position histograms. Lower = coarser, smoother bars. Default {NBINS_X}.</div>
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
          <button onClick={resetAll} style={{ padding: '8px 14px', fontSize: 13, fontFamily: fonts.mono, background: 'transparent', color: col.danger, border: `1px solid ${col.danger}`, borderRadius: 4, cursor: 'pointer', letterSpacing: 0.3 }}>Reset to defaults</button>
          <button onClick={onClose} style={{ padding: '8px 18px', fontSize: 13, fontFamily: fonts.mono, background: col.quantum, color: '#0e1320', border: `1px solid ${col.quantum}`, borderRadius: 4, cursor: 'pointer', letterSpacing: 0.3, fontWeight: 600 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ tag, title, color, styles, compact }) {
  return (
    <div style={{ marginBottom: compact ? 0 : 6 }}>
      <div style={{ fontFamily: styles.mono, fontSize: 14, letterSpacing: 2, color, textTransform: 'uppercase', fontWeight: 600 }}>{tag}</div>
      {title && title.trim() && (
        <div style={{ fontFamily: styles.display, fontSize: 22, marginTop: 2, fontStyle: 'italic', fontWeight: 400, color: '#e9e4d4' }}>{title}</div>
      )}
    </div>
  );
}

// ---------- Segmented toggle ----------
function ModeToggle({ value, onChange, options, accent, ink, inkDim, rule, mono }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${rule}`, borderRadius: 3, overflow: 'hidden', fontFamily: mono, fontSize: 11 }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '3px 7px',
              background: active ? accent : 'transparent',
              color: active ? '#0e1320' : inkDim,
              border: 'none',
              cursor: 'pointer',
              fontFamily: mono,
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              letterSpacing: 0.3,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CheckboxRow({ checked, onChange, label, accent, ink, inkDim, rule, mono }) {
  return (
    <label onClick={onChange} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', fontFamily: mono, fontSize: 14, color: ink, height: 22 }}>
      <span style={{ color: checked ? ink : inkDim, letterSpacing: 0.3 }}>{label}</span>
      <span
        style={{
          width: 20, height: 20, borderRadius: 3,
          border: `1.5px solid ${checked ? accent : rule}`,
          background: checked ? accent : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s', flexShrink: 0,
        }}
      >
        {checked && (
          <svg width={12} height={12} viewBox="0 0 10 10">
            <path d="M2 5 L4 7 L8 3" fill="none" stroke="#0e1320" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </label>
  );
}

// ---------- Transport button: play / pause / stop ----------
function TransportButton({ kind, active, onClick, colour, bg, rule }) {
  const SIZE = 46;
  const fill = active ? bg : colour;
  const bgFill = active ? colour : bg;
  const borderCol = colour;
  const title = kind === 'play' ? 'Play' : kind === 'pause' ? 'Pause' : kind === 'stop' ? 'Stop & reset' : kind === 'load' ? 'Load saved state' : kind === 'settings' ? 'Settings' : 'Save data';
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: SIZE, height: SIZE, borderRadius: SIZE / 2,
        background: bgFill, border: `2px solid ${borderCol}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', padding: 0, flexShrink: 0,
        transition: 'all 0.15s',
      }}
    >
      <svg width={22} height={22} viewBox="0 0 20 20">
        {kind === 'play' && (
          <polygon points="6,4 6,16 16,10" fill={fill} />
        )}
        {kind === 'pause' && (
          <g fill={fill}>
            <rect x={5} y={4} width={4} height={12} />
            <rect x={11} y={4} width={4} height={12} />
          </g>
        )}
        {kind === 'stop' && (
          <g>
            {/* filled square (the standard stop icon) */}
            <rect x={4} y={4} width={12} height={12} fill={colour} />
            {/* standard "rotate-ccw" icon scaled to fit on top of the square, dark stroke for contrast */}
            <g transform="translate(4, 4) scale(0.5)" stroke="#0e1320" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </g>
          </g>
        )}
        {kind === 'save' && (
          <g fill="none" stroke={fill} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {/* download tray: down arrow into a base */}
            <line x1={10} y1={3} x2={10} y2={12} />
            <polyline points="6,8 10,12 14,8" />
            <line x1={4} y1={16} x2={16} y2={16} />
          </g>
        )}
        {kind === 'load' && (
          <g fill="none" stroke={fill} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            {/* upload tray: up arrow out of a base */}
            <line x1={10} y1={12} x2={10} y2={3} />
            <polyline points="6,7 10,3 14,7" />
            <line x1={4} y1={16} x2={16} y2={16} />
          </g>
        )}
        {kind === 'settings' && (() => {
          // 6-tooth gear built programmatically (matches the sibling app).
          const cx = 10, cy = 10, outerR = 8, innerR = 5.5, teeth = 6;
          const N = teeth * 4;
          const pts = [];
          for (let i = 0; i < N; i++) {
            const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
            const r = (i % 4) < 2 ? outerR : innerR;
            pts.push(`${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`);
          }
          return (
            <g stroke={fill} strokeWidth={1.4} fill="none" strokeLinejoin="round">
              <path d={`M${pts.join(' L')} Z`} />
              <circle cx={cx} cy={cy} r={2.4} />
            </g>
          );
        })()}
      </svg>
    </button>
  );
}

// ---------- Preference number row — looks like a checkbox row but shows a value ----------
function PreferenceNumberRow({ label, value, onChange, min, max, accent, ink, inkDim, rule, mono, displayOffset = 0 }) {
  const displayed = value + displayOffset;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(displayed));
  useEffect(() => { if (!editing) setDraft(String(value + displayOffset)); }, [value, displayOffset, editing]);
  function commit() {
    const n = parseFloat(draft);
    if (!isNaN(n)) onChange(Math.max(min, Math.min(max, Math.round(n - displayOffset))));
    setEditing(false);
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', fontFamily: mono, fontSize: 14, color: ink, height: 22 }}>
      <span style={{ color: ink, letterSpacing: 0.3 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          style={{ width: 22, height: 22, border: `1.5px solid ${rule}`, background: 'transparent', color: inkDim, fontFamily: mono, fontSize: 15, cursor: 'pointer', borderRadius: 3, padding: 0, lineHeight: 1, fontWeight: 600 }}
        >−</button>
        {editing ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(String(value + displayOffset)); } }}
            style={{ width: 40, textAlign: 'center', background: 'transparent', color: accent, border: `1.5px solid ${accent}`, padding: '2px 2px', fontFamily: mono, fontSize: 15, fontVariantNumeric: 'tabular-nums', borderRadius: 3 }}
          />
        ) : (
          <div onClick={() => setEditing(true)} style={{ width: 40, textAlign: 'center', color: accent, fontFamily: mono, fontSize: 15, fontVariantNumeric: 'tabular-nums', padding: '2px 2px', border: `1.5px solid transparent`, cursor: 'text', borderRadius: 3, fontWeight: 600 }}>
            {displayed}
          </div>
        )}
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          style={{ width: 22, height: 22, border: `1.5px solid ${rule}`, background: 'transparent', color: inkDim, fontFamily: mono, fontSize: 15, cursor: 'pointer', borderRadius: 3, padding: 0, lineHeight: 1, fontWeight: 600 }}
        >+</button>
      </div>
    </div>
  );
}

// ---------- Vertical slider with editable number field ----------
function VerticalSlider({ label, tooltip, value, onChange, min, max, accent, rule, inkDim, ink, mono, ticks, tickLabel, decimals = 0, tickValues, onTickClick }) {
  const TRACK_H = 130;
  const TRACK_W = 8;
  const PAD_TOP = 10;
  const PAD_BOTTOM = 10;
  const innerH = TRACK_H;

  // value -> y (top is max, bottom is min — natural for energy axis)
  function yFor(v) {
    const clamped = Math.max(min, Math.min(max, v));
    return PAD_TOP + innerH - ((clamped - min) / (max - min)) * innerH;
  }

  const knobY = yFor(value);

  // drag interaction
  const trackRef = useRef(null);
  const draggingRef = useRef(false);

  function valueFromClientY(clientY) {
    const rect = trackRef.current.getBoundingClientRect();
    const yLocal = clientY - rect.top;
    const frac = 1 - Math.max(0, Math.min(innerH, yLocal - PAD_TOP)) / innerH;
    const raw = min + frac * (max - min);
    return Math.round(raw / (decimals === 0 ? 1 : Math.pow(0.1, decimals))) * (decimals === 0 ? 1 : Math.pow(0.1, decimals));
  }

  function onPointerDown(e) {
    draggingRef.current = true;
    onChange(valueFromClientY(e.clientY));
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!draggingRef.current) return;
    onChange(valueFromClientY(e.clientY));
  }
  function onPointerUp(e) {
    draggingRef.current = false;
  }

  // editable number input
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (!editing) setDraft(value.toFixed(decimals)); }, [value, decimals, editing]);
  function commitDraft() {
    const n = parseFloat(draft);
    if (!isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
    setEditing(false);
  }

  const totalH = PAD_TOP + innerH + PAD_BOTTOM + 40; // include label area
  const trackX = 28;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
      <div title={tooltip || ''} style={{ fontFamily: mono, fontSize: 13, color: inkDim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </div>
      <svg
        ref={trackRef}
        width={80}
        height={PAD_TOP + innerH + PAD_BOTTOM}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: 'pointer', touchAction: 'none' }}
      >
        {/* track */}
        <rect x={trackX - TRACK_W / 2} y={PAD_TOP} width={TRACK_W} height={innerH} fill={rule} rx={4} />
        {/* filled portion below knob */}
        <rect x={trackX - TRACK_W / 2} y={knobY} width={TRACK_W} height={(PAD_TOP + innerH) - knobY} fill={accent} opacity={0.75} rx={4} />

        {/* ticks (e.g., eigenstates) — clickable when onTickClick is provided */}
        {ticks && ticks.map((t, i) => {
          if ((t < min) || (t > max)) return null;
          const y = yFor(t);
          const clickable = !!onTickClick;
          // Active tick: value is within rounding distance of this eigenstate
          const isActive = Math.abs(value - t) < 1;
          const tickColour = isActive ? ink : accent;
          return (
            <g
              key={i}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onPointerDown={clickable ? (e) => { e.stopPropagation(); onTickClick(t); } : undefined}
            >
              {/* hit area */}
              {clickable && (
                <rect x={trackX + TRACK_W / 2 + 1} y={y - 9} width={42} height={18} fill="transparent" />
              )}
              <line x1={trackX + TRACK_W / 2 + 2} x2={trackX + TRACK_W / 2 + 9} y1={y} y2={y} stroke={tickColour} strokeWidth={isActive ? 3 : 2} opacity={0.95} />
              <text x={trackX + TRACK_W / 2 + 12} y={y + 5} fill={tickColour} fontSize={isActive ? 16 : 14} fontFamily={mono} letterSpacing={0.3} opacity={0.95}>
                <tspan fontStyle="italic">n</tspan>
                {`=${i + 1}`}
              </text>
            </g>
          );
        })}

        {/* knob */}
        <circle cx={trackX} cy={knobY} r={10} fill={accent} stroke={ink} strokeWidth={2} />
      </svg>
      {/* editable value */}
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => { if (e.key === 'Enter') commitDraft(); if (e.key === 'Escape') { setEditing(false); setDraft(value.toFixed(decimals)); } }}
          style={{
            width: 52, textAlign: 'center', background: 'transparent', color: accent,
            border: `1px solid ${accent}`, padding: '2px 4px', fontFamily: mono, fontSize: 14,
            fontVariantNumeric: 'tabular-nums', marginTop: 4, borderRadius: 2, fontWeight: 600,
          }}
        />
      ) : (
        <div
          onClick={() => setEditing(true)}
          style={{
            width: 52, textAlign: 'center', color: accent, fontFamily: mono, fontSize: 14,
            fontVariantNumeric: 'tabular-nums', marginTop: 4, padding: '2px 4px',
            border: `1px solid transparent`, cursor: 'text', borderRadius: 2, fontWeight: 600,
          }}
        >
          {value.toFixed(decimals)}
        </div>
      )}
    </div>
  );
}

// ---------- Classical particle view: round particle in a box ----------
function ParticleView({ x, recentMeasurements, col, wall, bg }) {
  const W = 480, H = 70;
  const wallLeftX = 60, wallRightX = W - 60;
  const midY = H / 2;
  const px = wallLeftX + x * (wallRightX - wallLeftX);
  const flashY = H - 10;

  function xScale(xv) { return wallLeftX + xv * (wallRightX - wallLeftX); }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: bg, borderRadius: 2 }}>
      {/* track */}
      <line x1={wallLeftX} x2={wallRightX} y1={midY} y2={midY} stroke="#26304a" strokeWidth={1.5} />
      {/* walls */}
      <line x1={wallLeftX} x2={wallLeftX} y1={8} y2={H - 8} stroke={wall} strokeWidth={5} />
      <line x1={wallRightX} x2={wallRightX} y1={8} y2={H - 8} stroke={wall} strokeWidth={5} />

      {/* particle (visualization only — sim treats it as a point) */}
      <circle cx={px} cy={midY} r={6} fill={col} fillOpacity={0.9} stroke={col} strokeWidth={1.5} />

      {/* measurement flashes — same semantics as the quantum side */}
      {recentMeasurements && recentMeasurements.map((m, i) => {
        const opacity = Math.max(0, 1 - m.age / FLASH_AGE);
        const r = 1.5 + (1 - m.age / FLASH_AGE) * 3;
        return <circle key={i} cx={xScale(m.x)} cy={flashY} r={r} fill={col} opacity={opacity * 0.85} />;
      })}
    </svg>
  );
}

// ---------- Wavefunction view: |ψ(x,t)|² as filled curve, time-evolving ----------
function WavefunctionView({ density, recentMeasurements, col, ink, inkDim, bg, styles, showWave }) {
  const W = 480, H = 88;
  const PAD_L = 60, PAD_R = 60, PAD_T = 18, PAD_B = 8;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const boxLeft = PAD_L;
  const boxRight = W - PAD_R;
  const floorY = PAD_T + innerH;

  // y-scale
  let dMax = 0;
  for (const p of density) if (p.d > dMax) dMax = p.d;
  dMax = dMax * 1.1 || 1;

  function xScale(x) { return PAD_L + x * innerW; }
  function yScale(d) { return floorY - (d / dMax) * innerH; }

  let path = '';
  for (let i = 0; i < density.length; i++) {
    const X = xScale(density[i].x).toFixed(2);
    const Y = yScale(density[i].d).toFixed(2);
    path += (i === 0 ? `M${X},${floorY} L${X},${Y}` : `L${X},${Y}`);
  }
  path += ` L${xScale(1).toFixed(2)},${floorY} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: bg, borderRadius: 2 }}>
      <line x1={boxLeft} x2={boxRight} y1={floorY} y2={floorY} stroke="#26304a" strokeWidth={1.5} />
      <line x1={boxLeft} x2={boxLeft} y1={PAD_T} y2={floorY} stroke={ink} strokeWidth={5} />
      <line x1={boxRight} x2={boxRight} y1={PAD_T} y2={floorY} stroke={ink} strokeWidth={5} />

      {showWave && (
        <path d={path} fill={col} fillOpacity={0.22} stroke={col} strokeWidth={2.5} />
      )}

      {/* recent flashes — always visible so students see the raw measurement events */}
      {recentMeasurements && recentMeasurements.map((m, i) => {
        const opacity = Math.max(0, 1 - m.age / FLASH_AGE);
        const r = 1.5 + (1 - m.age / FLASH_AGE) * 3;
        return <circle key={i} cx={xScale(m.x)} cy={floorY - 1} r={r} fill={col} opacity={opacity * 0.85} />;
      })}

      {showWave ? (
        <text x={W / 2} y={PAD_T - 4} fill={col} fontSize={13} fontFamily={styles.mono} textAnchor="middle" opacity={0.9}>|ψ(x,t)|² evolves in time</text>
      ) : (
        <text x={W / 2} y={PAD_T - 4} fill={inkDim} fontSize={13} fontFamily={styles.mono} textAnchor="middle" opacity={0.75}>measurements only — theory hidden</text>
      )}
    </svg>
  );
}

// ---------- Position histogram ----------
// y-axis is auto-scaled to 1.15× the maximum of data + theory overlay, with a
// stable floor so an empty histogram doesn't render absurdly tall bars.
function PositionHistogram({ hist, overlay, col, ink, inkDim, rule, styles, label, recentMarkers, accentColor, meanX }) {
  // viewBox geometry matches the simulation views above so that
  // x = 0 and x = L land at the same horizontal pixels in the column.
  const W = 480, H = 220;
  const PAD = { l: 60, r: 60, t: 12, b: 54 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const histMax = hist.length ? Math.max(...hist) : 0;
  const overlayMax = overlay ? Math.max(...overlay.map((p) => p.d)) : 0;
  const yMax = Math.max(histMax, overlayMax, 0.5) * 1.25;

  function xScale(x) { return PAD.l + x * innerW; }
  function yScale(v) { return PAD.t + innerH - Math.min(1, v / yMax) * innerH; }

  const NB = hist.length;
  const bars = hist.map((v, i) => {
    if (v <= 0) return null;
    const x0 = i / NB, x1 = (i + 1) / NB;
    const X = xScale(x0), X2 = xScale(x1);
    const Y = yScale(v);
    return <rect key={i} x={X + 0.5} y={Y} width={Math.max(1, X2 - X - 1)} height={PAD.t + innerH - Y} fill={col} opacity={0.7} />;
  });

  const overlayPath = overlay ? overlay.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(2)},${yScale(p.d).toFixed(2)}`).join(' ') : null;

  const axisY = PAD.t + innerH;
  const xTicks = [0, 0.5, 1];
  const xLabel = (v) => v === 0 ? '0' : v === 1 ? 'L' : 'L/2';

  return (
    <div>
      {label && (<div style={{ fontFamily: styles.mono, fontSize: 13, letterSpacing: 0.5, color: inkDim, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>)}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* y-axis */}
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={axisY} stroke={rule} strokeWidth={1.5} />
        {/* x-axis baseline */}
        <line x1={PAD.l} x2={PAD.l + innerW} y1={axisY} y2={axisY} stroke={rule} strokeWidth={1.5} />
        {/* wall indicators — solid lines flush with simulation walls */}
        <line x1={xScale(0)} x2={xScale(0)} y1={PAD.t} y2={axisY} stroke={ink} strokeWidth={1.5} opacity={0.4} strokeDasharray="3 4" />
        <line x1={xScale(1)} x2={xScale(1)} y1={PAD.t} y2={axisY} stroke={ink} strokeWidth={1.5} opacity={0.4} strokeDasharray="3 4" />

        {/* horizontal reference at P = 1 (uniform density) */}
        <line x1={PAD.l} x2={PAD.l + innerW} y1={yScale(1)} y2={yScale(1)} stroke={inkDim} strokeDasharray="3 5" strokeWidth={1.2} opacity={0.35} />

        {bars}

        {overlayPath && <path d={overlayPath} fill="none" stroke={col} strokeWidth={3} opacity={0.95} vectorEffect="non-scaling-stroke" />}

        {recentMarkers && recentMarkers.map((m, i) => {
          const X = xScale(m.x);
          const opacity = Math.max(0, 1 - m.age / FLASH_AGE);
          return <line key={i} x1={X} x2={X} y1={PAD.t} y2={PAD.t + 9} stroke={col} strokeWidth={2.5} opacity={opacity} />;
        })}

        {/* x-axis tick marks and labels */}
        {xTicks.map((t) => (
          <g key={t}>
            <line x1={xScale(t)} x2={xScale(t)} y1={axisY} y2={axisY + 5} stroke={rule} strokeWidth={1.5} />
            <text x={xScale(t)} y={axisY + 20} textAnchor="middle" fill={inkDim} fontSize={16} fontFamily={styles.mono} fontWeight={500}>{xLabel(t)}</text>
          </g>
        ))}

        {/* axis titles */}
        <text x={PAD.l - 8} y={PAD.t + 10} textAnchor="end" fill={inkDim} fontSize={15} fontFamily={styles.mono} fontWeight={500} fontStyle="italic">P(x)</text>
        <text x={PAD.l + innerW / 2} y={axisY + 42} textAnchor="middle" fill={inkDim} fontSize={16} fontFamily={styles.mono} fontWeight={500} fontStyle="italic">x</text>

        {/* ⟨x⟩ overlay — upper-right corner */}
        {meanX !== undefined && meanX !== null && (
          <text x={PAD.l + innerW - 6} y={PAD.t + 15} textAnchor="end" fontFamily={styles.mono} fontSize={18} fontWeight={500} fontVariantNumeric="tabular-nums">
            <tspan fill={inkDim}>⟨x⟩ = </tspan>
            <tspan fill={col}>{meanX.toFixed(2)}<tspan fill={inkDim}>L</tspan></tspan>
          </text>
        )}
      </svg>
    </div>
  );
}

// ---------- Vertical energy histogram (E on y-axis, density on x-axis) ----------
// Companion to the position histogram, placed to the right of the sim view so
// the energy axis runs vertically — matches the sibling app's panel layout.
// Bars grow leftward from the right-hand axis. Infinite well: no V₀, continuum,
// or log axis.
function VerticalEnergyHistogram({ density, eigenValues, theoretical, col, ink, inkDim, rule, styles, showEigen, recentMarkers, eSet, accentColor, meanE }) {
  const W = 130, H = 220;
  const PAD = { l: 8, r: 32, t: 26, b: 16 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  // E → y: E = 0 at the bottom, E_HIST_MAX at the top.
  function yScale(E) { return PAD.t + innerH - Math.max(0, Math.min(1, E / E_HIST_MAX)) * innerH; }
  const axisX = PAD.l + innerW;   // right-side y-axis; bars grow left
  const baseX = PAD.l;
  const axisYbot = PAD.t + innerH;

  const dataMax = density && density.length ? Math.max(...density) : 0;
  const xMax = Math.max(dataMax, 0.005) * 1.25;
  function xScale(d) { return axisX - Math.min(1, d / xMax) * innerW; }

  const NB = density ? density.length : 0;
  const bars = density ? density.map((v, i) => {
    if (v <= 0) return null;
    const E0 = (i / NB) * E_HIST_MAX, E1 = ((i + 1) / NB) * E_HIST_MAX;
    const Y1 = yScale(E1), Y2 = yScale(E0);
    const Xl = xScale(v);
    return <rect key={i} x={Xl} y={Y1 + 0.5} width={Math.max(1, axisX - Xl)} height={Math.max(1, Y2 - Y1 - 1)} fill={col} opacity={0.7} />;
  }) : null;

  // Theory marks: horizontal dashed lines at each eigenvalue, length ∝ |c_n|².
  const theoryMarks = theoretical ? theoretical.map((p, i) => {
    if (p <= 0.002) return null;
    const Y = yScale(eigenValues[i]);
    const effD = p / (E_HIST_MAX / NB);
    const Xl = xScale(effD);
    return <line key={i} x1={Xl} x2={axisX} y1={Y} y2={Y} stroke={col} strokeOpacity={0.65} strokeWidth={2} strokeDasharray="3 2" />;
  }) : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: '100%' }}>
      {/* y-axis (right) + bottom baseline */}
      <line x1={axisX} x2={axisX} y1={PAD.t} y2={axisYbot} stroke={rule} strokeWidth={1.5} />
      <line x1={baseX} x2={axisX} y1={axisYbot} y2={axisYbot} stroke={rule} strokeWidth={1.5} />

      {bars}
      {theoryMarks}

      {/* set-energy horizontal line */}
      {eSet !== undefined && (
        <g>
          <line x1={baseX} x2={axisX} y1={yScale(eSet)} y2={yScale(eSet)} stroke={accentColor || col} strokeDasharray="4 3" opacity={0.75} strokeWidth={1.5} />
          <text x={baseX} y={yScale(eSet) - 3} textAnchor="start" fill={accentColor || col} fontSize={11} fontFamily={styles.mono} opacity={0.95}>set</text>
        </g>
      )}

      {/* eigenstate ticks on the left edge (Show eigenstates) */}
      {showEigen && eigenValues.map((E, i) => {
        if (E > E_HIST_MAX) return null;
        const Y = yScale(E);
        return <line key={i} x1={baseX} x2={baseX + 7} y1={Y} y2={Y} stroke={inkDim} strokeWidth={1.5} opacity={0.6} />;
      })}

      {/* recent measurement flashes — short ticks just inside the right axis */}
      {recentMarkers && recentMarkers.map((m, i) => {
        if ((m.E < 0) || (m.E > E_HIST_MAX)) return null;
        const Y = yScale(m.E);
        const opacity = Math.max(0, 1 - m.age / FLASH_AGE);
        return <line key={i} x1={axisX - 9} x2={axisX} y1={Y} y2={Y} stroke={col} strokeWidth={2.5} opacity={opacity} />;
      })}

      {/* y-axis energy ticks + labels (right, outside) */}
      {[0, 100, 200, 300, 400].map((E) => (
        <g key={E}>
          <line x1={axisX} x2={axisX + 4} y1={yScale(E)} y2={yScale(E)} stroke={rule} strokeWidth={1.5} />
          <text x={axisX + 6} y={yScale(E) + 3.5} textAnchor="start" fill={inkDim} fontSize={10} fontFamily={styles.mono}>{E}</text>
        </g>
      ))}

      {/* labels: P(E) and ⟨E⟩ at the top */}
      <text x={baseX} y={11} textAnchor="start" fill={inkDim} fontSize={13} fontFamily={styles.mono} fontStyle="italic">P(E)</text>
      {meanE !== undefined && meanE !== null && (
        <text x={baseX} y={22} textAnchor="start" fontFamily={styles.mono} fontSize={11} fontWeight={500} fontVariantNumeric="tabular-nums">
          <tspan fill={inkDim}>⟨E⟩=</tspan><tspan fill={col}>{meanE.toFixed(1)}</tspan>
        </text>
      )}
    </svg>
  );
}

// =============================================================
// OVERLAY MODE — classical and quantum superimposed on shared axes.
// Same panel layout as a single sim panel (sim + P(x) on the left, vertical
// P(E) on the right), but every plot draws BOTH series at half opacity in the
// classical (A) and quantum (B) colours so the two distributions can be read
// against one shared scale.
// =============================================================

// Combined sim view: quantum |ψ|² as a filled curve + the classical particle dot.
function OverlaySimView({ density, particleX, colC, colQ, ink, bg }) {
  const W = 480, H = 88;
  const PAD_L = 60, PAD_R = 60, PAD_T = 18, PAD_B = 8;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const floorY = PAD_T + innerH;
  let dMax = 0;
  for (const p of density) if (p.d > dMax) dMax = p.d;
  dMax = dMax * 1.1 || 1;
  const xScale = (x) => PAD_L + x * innerW;
  const yScale = (d) => floorY - (d / dMax) * innerH;
  let path = '';
  for (let i = 0; i < density.length; i++) {
    const X = xScale(density[i].x).toFixed(2);
    const Y = yScale(density[i].d).toFixed(2);
    path += (i === 0 ? `M${X},${floorY} L${X},${Y}` : `L${X},${Y}`);
  }
  path += ` L${xScale(1).toFixed(2)},${floorY} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', background: bg, borderRadius: 2 }}>
      <line x1={PAD_L} x2={W - PAD_R} y1={floorY} y2={floorY} stroke="#232a40" strokeWidth={1.5} />
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={floorY} stroke={ink} strokeWidth={5} />
      <line x1={W - PAD_R} x2={W - PAD_R} y1={PAD_T} y2={floorY} stroke={ink} strokeWidth={5} />
      <path d={path} fill={colQ} fillOpacity={0.22} stroke={colQ} strokeWidth={2} />
      <circle cx={xScale(particleX)} cy={floorY - 7} r={6} fill={colC} fillOpacity={0.95} stroke={colC} strokeWidth={1.5} />
    </svg>
  );
}

// Combined P(x): both position histograms on a shared y-scale.
function OverlayPositionHistogram({ histA, histB, colA, colB, ink, inkDim, rule, styles, meanXA, meanXB }) {
  const W = 480, H = 220;
  const PAD = { l: 60, r: 60, t: 12, b: 54 };
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const maxA = histA && histA.length ? Math.max(...histA) : 0;
  const maxB = histB && histB.length ? Math.max(...histB) : 0;
  const yMax = Math.max(maxA, maxB, 0.5) * 1.25;
  const xScale = (x) => PAD.l + x * innerW;
  const yScale = (v) => PAD.t + innerH - Math.min(1, v / yMax) * innerH;
  const axisY = PAD.t + innerH;
  function bars(hist, col) {
    if (!hist) return null;
    const NB = hist.length;
    return hist.map((v, i) => {
      if (v <= 0) return null;
      const X = xScale(i / NB), X2 = xScale((i + 1) / NB), Y = yScale(v);
      return <rect key={i} x={X + 0.5} y={Y} width={Math.max(1, X2 - X - 1)} height={axisY - Y} fill={col} opacity={0.5} />;
    });
  }
  const xTicks = [0, 0.5, 1];
  const xLabel = (v) => v === 0 ? '0' : v === 1 ? 'L' : 'L/2';
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={axisY} stroke={rule} strokeWidth={1.5} />
      <line x1={PAD.l} x2={PAD.l + innerW} y1={axisY} y2={axisY} stroke={rule} strokeWidth={1.5} />
      <line x1={xScale(0)} x2={xScale(0)} y1={PAD.t} y2={axisY} stroke={ink} strokeWidth={1.5} opacity={0.4} strokeDasharray="3 4" />
      <line x1={xScale(1)} x2={xScale(1)} y1={PAD.t} y2={axisY} stroke={ink} strokeWidth={1.5} opacity={0.4} strokeDasharray="3 4" />
      <line x1={PAD.l} x2={PAD.l + innerW} y1={yScale(1)} y2={yScale(1)} stroke={inkDim} strokeDasharray="3 5" strokeWidth={1.2} opacity={0.35} />
      {bars(histA, colA)}
      {bars(histB, colB)}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={xScale(t)} x2={xScale(t)} y1={axisY} y2={axisY + 5} stroke={rule} strokeWidth={1.5} />
          <text x={xScale(t)} y={axisY + 20} textAnchor="middle" fill={inkDim} fontSize={16} fontFamily={styles.mono} fontWeight={500}>{xLabel(t)}</text>
        </g>
      ))}
      <text x={PAD.l - 8} y={PAD.t + 10} textAnchor="end" fill={inkDim} fontSize={15} fontFamily={styles.mono} fontWeight={500} fontStyle="italic">P(x)</text>
      <text x={PAD.l + innerW / 2} y={axisY + 42} textAnchor="middle" fill={inkDim} fontSize={16} fontFamily={styles.mono} fontWeight={500} fontStyle="italic">x</text>
      {(meanXA !== null || meanXB !== null) && (
        <text x={PAD.l + innerW - 6} y={PAD.t + 14} textAnchor="end" fontFamily={styles.mono} fontSize={15} fontWeight={500} fontVariantNumeric="tabular-nums">
          <tspan fill={inkDim}>⟨x⟩ </tspan>
          <tspan fill={colA}>{meanXA !== null ? meanXA.toFixed(2) : '—'}</tspan>
          <tspan fill={inkDim}> / </tspan>
          <tspan fill={colB}>{meanXB !== null ? meanXB.toFixed(2) : '—'}</tspan>
        </text>
      )}
    </svg>
  );
}

// Combined vertical P(E): both energy histograms on a shared density scale.
function OverlayVerticalEnergyHistogram({ densityA, densityB, colA, colB, inkDim, rule, styles, eSet, accentColor }) {
  const W = 130, H = 220;
  const PAD = { l: 8, r: 32, t: 26, b: 16 };
  const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
  const yScale = (E) => PAD.t + innerH - Math.max(0, Math.min(1, E / E_HIST_MAX)) * innerH;
  const axisX = PAD.l + innerW, baseX = PAD.l, axisYbot = PAD.t + innerH;
  const maxA = densityA && densityA.length ? Math.max(...densityA) : 0;
  const maxB = densityB && densityB.length ? Math.max(...densityB) : 0;
  const xMax = Math.max(maxA, maxB, 0.005) * 1.25;
  const xScale = (d) => axisX - Math.min(1, d / xMax) * innerW;
  function bars(density, col) {
    if (!density) return null;
    const NB = density.length;
    return density.map((v, i) => {
      if (v <= 0) return null;
      const E0 = (i / NB) * E_HIST_MAX, E1 = ((i + 1) / NB) * E_HIST_MAX;
      const Y1 = yScale(E1), Y2 = yScale(E0), Xl = xScale(v);
      return <rect key={i} x={Xl} y={Y1 + 0.5} width={Math.max(1, axisX - Xl)} height={Math.max(1, Y2 - Y1 - 1)} fill={col} opacity={0.5} />;
    });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: '100%' }}>
      <line x1={axisX} x2={axisX} y1={PAD.t} y2={axisYbot} stroke={rule} strokeWidth={1.5} />
      <line x1={baseX} x2={axisX} y1={axisYbot} y2={axisYbot} stroke={rule} strokeWidth={1.5} />
      {bars(densityA, colA)}
      {bars(densityB, colB)}
      {eSet !== undefined && (
        <g>
          <line x1={baseX} x2={axisX} y1={yScale(eSet)} y2={yScale(eSet)} stroke={accentColor} strokeDasharray="4 3" opacity={0.75} strokeWidth={1.5} />
          <text x={baseX} y={yScale(eSet) - 3} textAnchor="start" fill={accentColor} fontSize={11} fontFamily={styles.mono} opacity={0.95}>set</text>
        </g>
      )}
      {[0, 100, 200, 300, 400].map((E) => (
        <g key={E}>
          <line x1={axisX} x2={axisX + 4} y1={yScale(E)} y2={yScale(E)} stroke={rule} strokeWidth={1.5} />
          <text x={axisX + 6} y={yScale(E) + 3.5} textAnchor="start" fill={inkDim} fontSize={10} fontFamily={styles.mono}>{E}</text>
        </g>
      ))}
      <text x={baseX} y={11} textAnchor="start" fill={inkDim} fontSize={13} fontFamily={styles.mono} fontStyle="italic">P(E)</text>
    </svg>
  );
}

// ---------- Energy histogram (horizontal: E on x-axis, density on y-axis) ----------
function EnergyHistogram({ density, eigenValues, theoretical, col, ink, inkDim, rule, styles, showEigen, recentMarkers, label, eSet, accentColor, meanE, meanECount }) {
  // viewBox matches simulation views and position histogram so columns align.
  const W = 480, H = 220;
  const PAD = { l: 60, r: 60, t: 18, b: 54 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  // x-axis = energy, y-axis = probability density.
  const axisY = PAD.t + innerH;
  function xScale(E) { return PAD.l + (E / E_HIST_MAX) * innerW; }

  // Auto-scale y to data peak with a floor so empty histograms don't blow up.
  const dataMax = density && density.length ? Math.max(...density) : 0;
  const yMax = Math.max(dataMax, 0.005) * 1.25;
  function yScaleFreq(v) { return axisY - Math.min(1, v / yMax) * innerH; }

  // Bars: one rect per bin, width = bin span in pixels.
  const NB = density ? density.length : 0;
  const binWidthPx = innerW / NB || 1;
  const bars = density ? density.map((v, i) => {
    if (v <= 0) return null;
    const eLo = (i / NB) * E_HIST_MAX;
    const X = xScale(eLo);
    const Y = yScaleFreq(v);
    return <rect key={i} x={X + 0.5} y={Y} width={Math.max(1, binWidthPx - 1)} height={axisY - Y} fill={col} opacity={0.7} />;
  }) : null;

  // Theory markers: vertical line at each eigenstate position, height = |c_n|² weight
  // mapped to comparable density via the bin width.
  const theoryMarks = theoretical ? theoretical.map((p, i) => {
    if (p <= 0.002) return null;
    const X = xScale(eigenValues[i]);
    const effDensity = p / (E_HIST_MAX / NB);
    const Y = yScaleFreq(effDensity);
    return <line key={i} x1={X} x2={X} y1={Y} y2={axisY} stroke={col} strokeOpacity={0.65} strokeWidth={2} strokeDasharray="3 2" />;
  }) : null;

  return (
    <div>
      {label && (<div style={{ fontFamily: styles.mono, fontSize: 13, letterSpacing: 0.5, color: inkDim, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>)}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* axes */}
        <line x1={PAD.l} x2={PAD.l + innerW} y1={axisY} y2={axisY} stroke={rule} strokeWidth={1.5} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={axisY} stroke={rule} strokeWidth={1.5} />

        {bars}
        {theoryMarks}

        {/* set-energy vertical line */}
        {eSet !== undefined && (
          <g>
            <line x1={xScale(eSet)} x2={xScale(eSet)} y1={PAD.t} y2={axisY} stroke={accentColor || col} strokeDasharray="4 3" opacity={0.75} strokeWidth={1.5} />
            <text x={xScale(eSet) + 4} y={PAD.t + 11} textAnchor="start" fill={accentColor || col} fontSize={13} fontFamily={styles.mono} opacity={0.95} fontWeight={500}>set</text>
          </g>
        )}

        {/* recent measurement flashes — short ticks at the top of the chart */}
        {recentMarkers && recentMarkers.map((m, i) => {
          if ((m.E < 0) || (m.E > E_HIST_MAX)) return null;
          const X = xScale(m.E);
          const opacity = Math.max(0, 1 - m.age / FLASH_AGE);
          return <line key={i} x1={X} x2={X} y1={PAD.t} y2={PAD.t + 9} stroke={col} strokeWidth={2.5} opacity={opacity} />;
        })}

        {/* x-axis numeric ticks — always numeric so the plot reads like experimental data */}
        {[0, 100, 200, 300, 400].map((E) => (
          <g key={E}>
            <line x1={xScale(E)} x2={xScale(E)} y1={axisY} y2={axisY + 5} stroke={rule} strokeWidth={1.5} />
            <text x={xScale(E)} y={axisY + 20} textAnchor="middle" fill={inkDim} fontSize={15} fontFamily={styles.mono} fontWeight={500}>{E}</text>
          </g>
        ))}

        {/* ⟨E⟩ overlay — upper-right corner */}
        {meanE !== undefined && meanE !== null && (
          <text x={PAD.l + innerW - 6} y={PAD.t + 16} textAnchor="end" fontFamily={styles.mono} fontSize={18} fontWeight={500} fontVariantNumeric="tabular-nums">
            <tspan fill={inkDim}>⟨E⟩ = </tspan>
            <tspan fill={col}>{meanE.toFixed(1)}</tspan>
          </text>
        )}

        {/* axis titles */}
        <text x={PAD.l - 8} y={PAD.t + 10} textAnchor="end" fill={inkDim} fontSize={15} fontFamily={styles.mono} fontWeight={500} fontStyle="italic">P(E)</text>
        <text x={PAD.l + innerW / 2} y={axisY + 42} textAnchor="middle" fill={inkDim} fontSize={16} fontFamily={styles.mono} fontWeight={500}>
          <tspan fontStyle="italic">E</tspan>
          <tspan fontSize={12}>{` (ℏ²/2mL²)`}</tspan>
        </text>
      </svg>
    </div>
  );
}

// ---------- Adaptive notes ----------
function Notes({ energy, probs, gamma, display, body, ink, cCol, qCol, aCol }) {
  // find dominant eigenstates
  const dominant = [];
  for (let i = 0; i < N_EIGEN; i++) {
    if (probs[i] > 0.05) dominant.push({ n: i + 1, p: probs[i] });
  }
  dominant.sort((a, b) => b.p - a.p);

  const isSinglePeak = dominant.length === 1 || (dominant[0] && dominant[0].p > 0.85);
  const closestEigen = eigenE.reduce((acc, E, i) => Math.abs(E - energy) < Math.abs(acc.E - energy) ? { E, i } : acc, { E: eigenE[0], i: 0 });

  const items = [];

  items.push({
    label: 'Two histograms, two stories',
    text: `Position histograms show where the particle is. Energy histograms show what you measure if you ask "what energy does it have?" Classically, position spreads uniformly and energy is exactly the slider value. Quantum position depends on which eigenstates are mixed in; quantum energy is one of a small number of specific values.`,
    colour: ink,
  });

  if (isSinglePeak) {
    items.push({
      label: "You've found a special point",
      text: `The energy histogram is essentially a single bar at E ≈ ${closestEigen.E.toFixed(1)}. The slider is sitting on a "special" energy. Nudge it slightly – the single bar will split into two. These special positions are the system's only allowed measurement outcomes for sharply-defined-energy states.`,
      colour: aCol,
    });
  } else {
    items.push({
      label: 'Between special points',
      text: `Two bars dominate the energy histogram. You set ⟨E⟩ = ${energy}, but every actual measurement returns one of two specific values (the bar positions). The slider energy is the *average*, never the *result*. Drag the slider until one of the bars disappears – you'll have landed on a special point.`,
      colour: aCol,
    });
  }

  items.push({
    label: 'Why the quantum particle wobbles',
    text: `When the energy is between specific values, |ψ(x,t)|² is a sum of stationary states beating against each other – probability sloshes back and forth across the well at frequency proportional to the energy gap. At a special energy, the beating stops and the density stands still. The position histogram averages over all these moments, which is why it converges to a smooth pattern even though the wavefunction is moving.`,
    colour: qCol,
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: 1.5, color: it.colour, textTransform: 'uppercase', marginBottom: 6 }}>{it.label}</div>
          <div style={{ fontSize: 13, color: ink, lineHeight: 1.55, fontFamily: body }}>{it.text}</div>
        </div>
      ))}
    </div>
  );
}
