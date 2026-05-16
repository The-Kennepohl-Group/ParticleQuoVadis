# Changelog

All notable changes to *Particle, Quo Vadis?* will be recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-16

Initial release.

### Features

- Side-by-side classical (ballistic or Brownian) and quantum particle simulations in a 1D infinite square well.
- Position histograms for both panels, aligned to the simulation box above.
- Energy histograms with continuous binning, supporting both intrinsic ($\Gamma$) and instrumental ($\sigma$) broadening.
- Running expectation values $\langle x \rangle$ and $\langle E \rangle$ displayed on each histogram.
- Energy slider with optional eigenstate ticks; click an eigenstate label to snap to that exact value.
- Show theory / Show eigenstates toggles.
- Ballistic / Brownian classical motion toggle.
- Spectral resolution $\Gamma$ control (Lorentzian state preparation width).
- Instrument resolution $\sigma$ control (Gaussian measurement noise).
- Save data as CSV or JSON; load JSON to restore a previous state.
- Auto-pause at every 10,000 measurements.
- Confirm dialog before discarding unsaved data on load.
