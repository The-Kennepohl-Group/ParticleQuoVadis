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
  const [gamma, setGamma] = useState(1);
  const [instrSigma, setInstrSigma] = useState(0);
  const [classicalMode, setClassicalMode] = useState('ballistic'); // 'ballistic' or 'brownian'
  const [reset, setReset] = useState(0);
  const [running, setRunning] = useState(true);
  const [showEigen, setShowEigen] = useState(false);
  const [showTheory, setShowTheory] = useState(false);

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
  const nextPauseAtRef = useRef(PAUSE_INCREMENT);
  useEffect(() => {
    if (reset === 0) return; // skip initial mount
    tRef.current = 0;
    lastResetRef.current = performance.now();
    nextPauseAtRef.current = PAUSE_INCREMENT;
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
        nextPauseAtRef.current += PAUSE_INCREMENT;
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
    tRef.current += DT_QM;
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
      energy_units: 'hbar^2 / (2 m L^2)',
      position_units: 'L (box length)',
      n_position_bins: NBINS_X,
      n_energy_bins: NBINS_E,
      energy_axis_max: E_HIST_MAX,
      n_eigenstates_included: N_EIGEN,
      classical_measurements: totalCount,
      classical_mean_x: cMeanX,
      classical_mean_E: cMeanE,
      quantum_position_measurements: qPosCount,
      quantum_energy_measurements: qEnergyCount,
      quantum_mean_x: qMeanX,
      quantum_mean_E: qMeanE,
    };

    const eigenvalues = [];
    for (let n = 1; n <= N_EIGEN; n++) eigenvalues.push({ n, E_n: n * n * Math.PI * Math.PI });

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

    const eigenRows = [['eigenstate_n', 'energy_E_n']];
    for (const e of snap.eigenvalues) eigenRows.push([e.n, fmt(e.E_n)]);

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
    const ceiled = Math.ceil((cPosTotal + 1) / PAUSE_INCREMENT) * PAUSE_INCREMENT;
    nextPauseAtRef.current = Math.max(PAUSE_INCREMENT, ceiled);

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
  const COL_RULE = '#26304a';
  const COL_CLASSICAL = '#e0a868';
  const COL_QUANTUM = '#7adfd0';
  const COL_ACCENT = '#c9a0ff';
  const COL_DANGER = '#e8745a';

  return (
    <div style={{ background: COL_BG, color: COL_INK, fontFamily: styles.body, minHeight: '100vh', padding: '20px 24px 32px' }}>
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
        <header style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-end', gap: 18 }}>
          <h1 style={{ fontFamily: styles.display, fontWeight: 400, fontSize: 38, margin: 0, padding: 0, lineHeight: 1, letterSpacing: -0.5, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
            Particle, Quo Vadis?
          </h1>
          <div style={{ fontFamily: styles.mono, fontSize: 13, color: COL_INK_DIM, letterSpacing: 0.5, lineHeight: 1.4, paddingBottom: 2 }}>
            Classical and quantum particles in a box
          </div>
        </header>

        {/* TOP CONTROLS: left stack (controls+count over preferences) | energy */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, marginBottom: 14, alignItems: 'stretch' }}>
          {/* LEFT COLUMN: two stacked panels — distribute available height */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-between' }}>
            {/* Transport + measurement count */}
            <div style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 18 }}>
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
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right', fontFamily: styles.mono, lineHeight: 1.1 }}>
                <div style={{ fontSize: 22, color: COL_INK, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                  {classicalStepsRef.current.toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: COL_INK_DIM, letterSpacing: 1, textTransform: 'uppercase', marginTop: 3 }}>measurements</div>
              </div>
            </div>

            {/* Preferences */}
            <div style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          </div>

          {/* ENERGY SLIDER — matches the left stack height */}
          <div style={{ ...panel(COL_PANEL, COL_RULE), padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

        {/* MAIN GRID */}
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

            <ParticleView
              x={personRef.current.x}
              recentMeasurements={recentClassicalPosRef.current}
              col={COL_CLASSICAL}
              wall={COL_INK}
              bg={COL_PANEL}
            />

            <PositionHistogram
              hist={classicalPosDensity}
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

            <EnergyHistogram
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
              label={null}
              eSet={energy}
              accentColor={COL_CLASSICAL}
              meanE={classicalEnergyMeasRef.current > 0 ? classicalEnergySumRef.current / classicalEnergyMeasRef.current : null}
              meanECount={classicalEnergyMeasRef.current}
            />
          </section>

          {/* ============ QUANTUM ============ */}
          <section style={{ ...panel(COL_PANEL, COL_RULE), padding: '10px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <PanelHeader tag="Quantum" title=" " color={COL_QUANTUM} styles={styles} compact />
              {/* spacer to balance classical's mode toggle height */}
              <div style={{ height: 24 }} />
            </div>

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
              hist={quantumPosDensity}
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

            <EnergyHistogram
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
              label={null}
              eSet={energy}
              accentColor={COL_ACCENT}
              meanE={quantumEnergyMeasRef.current > 0 ? quantumEnergySumRef.current / quantumEnergyMeasRef.current : null}
              meanECount={quantumEnergyMeasRef.current}
            />
          </section>
        </div>

        {/* NOTES */}
        <section style={{ marginTop: 22, ...panel(COL_PANEL, COL_RULE) }}>
          <div style={{ fontFamily: styles.mono, fontSize: 13, color: COL_INK_DIM, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
            What you're looking at
          </div>
          <Notes energy={energy} probs={probs} gamma={gamma} display={styles.display} body={styles.body} ink={COL_INK} cCol={COL_CLASSICAL} qCol={COL_QUANTUM} aCol={COL_ACCENT} />
        </section>

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
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', fontFamily: mono, fontSize: 14, color: ink, height: 22 }}>
      <span style={{ color: checked ? ink : inkDim, letterSpacing: 0.3 }}>{label}</span>
      <span
        onClick={onChange}
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
  const title = kind === 'play' ? 'Play' : kind === 'pause' ? 'Pause' : kind === 'stop' ? 'Stop & reset' : kind === 'load' ? 'Load saved state' : 'Save data';
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
