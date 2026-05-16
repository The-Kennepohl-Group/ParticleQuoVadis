# Pedagogical Notes

This document captures the design decisions behind *Particle, Quo Vadis?* — the *why* behind the *what*. It's written for instructors who plan to use this in a course, and for anyone who wants to fork the tool and adapt it without re-deriving every choice.

## What the simulation actually represents

The system is a single particle in a 1D infinite square well of length $L$. Two simulations run in parallel:

- **Classical side**: a single particle is integrated forward in time. Its position is binned into the position histogram every step. At each step, a separate "energy measurement" is reported (the slider energy plus Gaussian instrument noise) and binned into the energy histogram.
- **Quantum side**: the prepared state is a Lorentzian-weighted superposition of energy eigenstates, centered on the slider energy. Position measurements sample $|\psi(x,t)|^2$ at the current time. Energy measurements sample the Born-rule distribution (probabilities $|c_n|^2$) then add Gaussian instrument noise to the reported eigenvalue.

The two sides intentionally use parallel measurement protocols so the histograms are directly comparable.

## Units

Energies are dimensionless multiples of $\hbar^2 / (2mL^2)$. In these units the eigenvalues are $E_n = n^2 \pi^2$, so $E_1 \approx 9.87$, $E_2 \approx 39.48$, etc. This matches the textbook eigenvalue formula structure and keeps $\pi^2$ visible.

Position is dimensionless, ranging $0 \le x \le L$.

An alternative would be to use units of $E_1$ so that $E_n = n^2$ exactly (1, 4, 9, 16, 25, 36). This would be cleaner but hides the $\pi^2$ that's part of the standard derivation. The current choice keeps the textbook formula visible.

## Why we use a Lorentzian for state preparation

The state-preparation parameter $\Gamma$ controls how broadly the prepared state spreads across eigenstates. The weights are

$$|c_n|^2 \propto \frac{1}{(E_n - E_\text{set})^2 + (\Gamma/2)^2}$$

normalized to sum to 1. This is a Lorentzian profile, physically motivated by:

- The time-energy uncertainty relation: a state of finite lifetime $\tau$ has natural linewidth $\Gamma \sim \hbar/\tau$.
- It matches natural lineshapes seen in real spectroscopy.
- The heavy tails (compared to Gaussian) give a meaningful contribution from distant eigenstates, which is pedagogically useful when $E_\text{set}$ is far from any eigenvalue.

A Gaussian was considered but rejected — the heavy Lorentzian tails make the "non-eigenstate" case more visibly different from the "eigenstate" case.

The internal floor for $\Gamma$ is 1 (in the same energy units) to avoid numerical singularity. The displayed value is offset by $-1$ so users see "$\Gamma = 0$" at the minimum, which corresponds intuitively to "perfect spectral resolution."

## Why we have two separate broadening parameters ($\Gamma$ and $\sigma$)

Real spectroscopy involves at least two sources of line width:

- **Intrinsic linewidth** ($\Gamma$ here) — a property of the system being measured. Set by lifetime, dephasing, or in our case by how the state was prepared.
- **Instrument resolution** ($\sigma$ here) — a property of the measurement apparatus. Gaussian noise added to each reported value.

Keeping these separate lets students see how each affects the histogram independently. Lorentzian $\Gamma$ broadens by spreading the *underlying* probability across more eigenstates. Gaussian $\sigma$ broadens each reported peak by adding measurement noise.

At $\sigma = 0$ the underlying eigenstate structure is visible as sharp lines. As $\sigma$ grows, peaks merge and quantization becomes invisible — the same way it does in low-resolution spectrometers. This is the pedagogical point.

The default $\sigma = 0$ preserves the quantization story by default. The default $\Gamma = 0$ (internal value 1) preserves the eigenstate-as-pure-state story by default.

## Why the classical particle has wall jitter and speed jitter

A purely deterministic ballistic particle bouncing in a 1D box has a *periodic orbit*. Such an orbit fills only a measure-zero subset of $[0,L]$. The position histogram never converges to the uniform distribution — instead it accumulates only in the bins the orbit visits.

This is correct classical mechanics. Real ballistic particles ergodicize because of:
- Microscopic imperfections in the walls (each bounce is slightly off-specular)
- Thermal fluctuations in the wall
- Numerical noise in the integrator

The simulation includes these as:
- ±20% multiplicative speed jitter on each step (breaks the periodic orbit)
- A small (~1 bin width) random offset on each wall bounce (ensures the bins next to the wall sample at the same rate as interior bins)

Without these, the classical histogram shows a visible periodic-orbit pattern, and the bins next to the walls are systematically under-sampled. With them, the histogram converges to uniform within 5% across all 80 bins after about 10k measurements. Verified empirically.

The energy is recorded as the *slider value*, not the per-step instantaneous kinetic energy. This is defensible: in real spectroscopy, the spectrometer reports the system's energy from a single coherent measurement, not the integrand of a microscopic trajectory. Conceptually, the slider sets the system energy and the spectrometer reads it with finite resolution $\sigma$.

## Why Brownian mode exists

Most introductory chemistry presentations contrast a quantum particle with a deterministic classical ball. But many real classical systems (e.g., colloidal particles, thermalized molecules in a cavity) are better modeled by random walks than by ballistic motion.

The Brownian mode is included to make the classical-quantum comparison more flexible. Both ballistic and Brownian motion converge to the same uniform position distribution and the same energy peak. The contrast with quantum is preserved either way.

Pedagogically, this matters because students often ask "but isn't a classical particle moving randomly anyway?" The Brownian toggle lets you say "yes, like this — and notice the histograms still look classical, not quantum."

## Why the position and energy histograms look different

The position histogram is a *time-average* of $|\psi(x,t)|^2$ sampled at the current time, plus the bins of independent particles each measured once. For eigenstates these are identical (eigenstates are stationary); for superpositions they differ slightly (the time-evolving $|\psi(x,t)|^2$ oscillates).

The energy histogram is built from independent measurements, each of which collapses to a single eigenvalue. This is the Born rule made visible: $P(n) = |c_n|^2$.

The protocols are deliberately parallel: both panels record one observable per step, into a histogram. The difference is what each observable looks like under the Born rule. Position has a continuous spectrum (any value in $[0, L]$ is possible); energy has a discrete spectrum.

## Why we report $\langle x \rangle$ and $\langle E \rangle$ as running means

Students see two convergent quantities: $\langle x \rangle$ and $\langle E \rangle$. Both update as more measurements come in.

For the classical particle in any uniform-density state, $\langle x \rangle \to L/2$. For a quantum eigenstate, also $\langle x \rangle = L/2$ exactly (since $|\psi_n|^2$ is symmetric about $L/2$). For a mixed-parity superposition (e.g., $\Gamma$ tuned between $E_1$ and $E_2$), $\langle x \rangle$ can drift away from $L/2$. This is correct physics — $\langle x \rangle$ in a mixed-parity state generally isn't $L/2$.

Students seeing this drift discover something nontrivial about superposition states.

## Auto-pause at every 10,000 measurements

Without intervention, the simulation could run indefinitely and the histograms would converge with arbitrary precision. This is not the lesson — students should *experience* convergence as a process.

Auto-pausing at 10k checkpoints lets students:
- Notice that the histogram still has visible noise at small N.
- See the noise decrease as they keep adding more measurements.
- Decide for themselves when they've collected "enough" data.

The 10k increment is a compromise. Smaller (e.g., 1000) would interrupt too often. Larger (e.g., 50000) would let the histograms converge too smoothly between checkpoints.

## Data export

The export captures the full simulation state — settings, counts, running means, all four histograms, and eigenvalue reference. Two formats:

- **CSV** for direct analysis in Excel, R, MATLAB, Origin, or pandas. Long-format ("tidy data") with explicit `type` and `panel` columns. Metadata as a key/value block at the top.
- **JSON** for programmatic re-use or for re-loading into the simulation.

The JSON schema is versioned (`particle-in-a-box-export/v1`) so future changes can be detected. Loading checks the schema version, bin counts, and energy axis max — incompatible files are rejected with a brief alert.

## Things the simulation deliberately doesn't model

- **The finite potential well.** Walls are infinite. Wavefunctions are exactly zero outside the box; no tunneling, no leakage. Adding finite walls is a substantial pedagogical jump (transcendental eigenvalue equations, continuum above $V_0$, qualitatively different classical-quantum contrast) and is a candidate for a sibling tool rather than an addition to this one.
- **Time-dependent Hamiltonians.** The Hamiltonian is static. The wavefunction evolves under the time-independent Schrödinger equation.
- **Multiple particles or interactions.** One particle, no interactions.
- **Spin.** Spinless particle.
- **External fields.** No applied fields. The "energy" set by the slider is purely kinetic plus the well's potential (zero inside, infinite outside).

These omissions are deliberate. Each adds complexity without changing the core lesson about measurement, quantization, and the classical-quantum contrast.

## Defaults

The defaults are chosen so a student opening the app for the first time sees:

- The energy slider set to $E_1 \approx 10$ (a near-eigenstate condition).
- $\Gamma$ displayed as 0 (sharpest spectral resolution).
- $\sigma$ set to 0 (perfect instrument).
- Show theory: off (students should discover the underlying structure from data first).
- Show eigenstates: off (same reason).
- Classical mode: ballistic.

Pressing Play immediately shows classical and quantum histograms diverging in shape. Turning on "Show theory" reveals what the underlying functions are. Turning on "Show eigenstates" reveals the discrete energy structure. The defaults support a progression from observation to interpretation.

## Visual design

- Classical accent: orange (`#e0a868`).
- Quantum accent: teal (`#7adfd0`).
- Setting/eigenstate accent: purple (`#c9a0ff`).
- Destructive (Stop/Reset): red-orange (`#e8745a`).
- Background: deep blue-black (`#0e1320`).
- Panels: slate (`#161c2e`).
- Text: warm cream (`#e9e4d4`) and muted grey (`#9aa0b4`).

The color choices are warm but high-contrast against the dark background. The classical/quantum colors are chosen to be distinguishable for the most common forms of color-vision deficiency (orange vs teal differs in both hue and luminance).

Typography uses Fraunces (display serif) for the main title and large expectation values, JetBrains Mono for technical labels and numbers, DM Sans for body text. All three are open-source and CDN-available.
