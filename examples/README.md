# Example data

A small collection of saved simulation states demonstrating pedagogically interesting conditions. Each example is provided as a JSON file (loadable back into the app via the upload button) and as a parallel CSV (for direct analysis in Excel, R, or pandas).

## How to use these

- **In the app:** click the upload button (the upload arrow) and select one of the `.json` files. The app restores all settings, histograms, and counters from that file. The simulation is paused after load — press Play to keep collecting.
- **For analysis:** open the matching `.csv` file in your spreadsheet or data tool. The CSV has metadata at the top (slider energy, $\Gamma$, $\sigma$, etc.), then an eigenvalue reference table, then the long-format histogram data with `type`, `panel`, `bin_index`, `bin_center`, and `density` columns.

## Catalog

| File | Energy | Mode | Γ | σ | Measurements | Notes |
| ---- | -----: | ---- | -: | -: | -----------: | ----- |
| [`pib_E10_ballistic_g0_s0.json`](pib_E10_ballistic_g0_s0.json) | 10 (≈ E₁) | ballistic | 0 | 0 | 10,000 | **Default parameters, ground-state-like.** Both histograms look superficially similar — the position distribution shape differs subtly (quantum is peaked at L/2, classical is uniform), and ⟨E⟩ values differ by about 0.1 unit. *The energy difference is real:* the slider reads 10, but E₁ = π² ≈ 9.87, so the quantum particle reports the true eigenvalue while the classical reports the slider value. A nice first example showing where the two pictures diverge. |
| [`pib_E355_brownian_g0_s0.json`](pib_E355_brownian_g0_s0.json) | 355 (≈ E₆) | Brownian | 0 | 0 | 10,000 | **High-energy eigenstate (n=6) with random-walk classical motion.** Even at high energy, Brownian motion converges *slowly* to the uniform position distribution — the random walker takes much longer to sample the whole box than a ballistic particle does. The quantum side shows the n=6 nodal structure clearly. ⟨E⟩ is essentially identical for both panels because the slider sits on an eigenvalue and instrument resolution is zero. |
| [`pib_E355_brownian_g3_s3.json`](pib_E355_brownian_g3_s3.json) | 355 (≈ E₆) | Brownian | 3 | 3 | 10,000 | **Same n=6 state, now with realistic spectral and instrumental width.** Both energy histograms broaden into peaks of finite width. The position distributions still show their characteristic shapes (Brownian-uniform classical, n=6 nodal quantum). Useful for showing what "real" measurement of an eigenstate looks like with finite resolution. |
| [`pib_E355_brownian_g20_s5.json`](pib_E355_brownian_g20_s5.json) | 355 (≈ E₆) | Brownian | 20 | 5 | 40,000 | **Same n=6 with much larger spectral width.** The quantum energy histogram now reveals genuine contributions from neighbouring eigenstates — even though the slider is on an eigenvalue, the Lorentzian preparation gives non-trivial \|cₙ\|² for nearby states. The classical histogram remains a simple Gaussian centred on the slider value. Higher measurement count makes the small contributions from other states clearer. **Try replotting the energy CSV in Excel and zooming in to see the small side peaks.** |
| [`pib_E197_ballistic_g3_s3.json`](pib_E197_ballistic_g3_s3.json) | 197 (off-eigenvalue) | ballistic | 3 | 3 | 20,000 | **Slider intentionally placed *between* eigenstates** (E₄ ≈ 158, E₅ ≈ 247). The quantum position distribution is now a *superposition* of states, with no clean nodal structure. The quantum energy ⟨E⟩ (≈ 182) no longer matches the slider value (197) — because the Lorentzian weights the closer eigenstate (E₄) more heavily, pulling the mean down. The classical ⟨E⟩ still equals the slider value plus instrumental noise. A striking demonstration of why "the energy you set" and "the energy you measure" can disagree in a quantum system. |

## Suggested teaching sequence

A reasonable order for showing these in class:

1. Start with **E=10 ballistic** — looks deceptively simple. Ask students what's different. Surface the ⟨E⟩ discrepancy as a discovery.
2. Move to **E=355 Brownian, no broadening** — introduce a different classical motion type. Note that the quantum side shows n=6 structure (a high quantum number, but still purely quantized).
3. Add broadening at **E=355 with Γ=3, σ=3** — what happens when measurements aren't perfectly sharp? Both panels broaden. Quantization is partially obscured but still visible.
4. Push broadening further at **E=355 with Γ=20, σ=5** — does the classical answer change qualitatively? (No — still Gaussian.) Does the quantum answer change qualitatively? (Yes — neighbouring eigenstates now contribute observable side peaks.)
5. Finally **E=197 off-eigenvalue** — what if we set an energy that *can't* be a quantum eigenvalue? The quantum particle adopts a superposition; ⟨E⟩ disagrees with the slider; the position distribution loses nodal structure.

This sequence builds up: quantization is the punchline of example 1, motion type doesn't change the quantum/classical contrast (example 2), finite measurement resolution preserves the contrast (3), large broadening starts to obscure quantization (4), and off-eigenvalue states reveal genuine superposition (5).

## Adding your own examples

To contribute an example state:

1. Run the simulation with the settings you want to demonstrate.
2. Let measurements accumulate (a few thousand is usually enough; more for low-probability features).
3. Click the download button and save as JSON (and optionally CSV).
4. Drop the file in this folder with a clear name. The filename pattern `pib_E{energy}_{mode}_g{gamma}_s{sigma}.json` is generated automatically by the app and makes parameters scannable from the directory listing.
5. Add a row to the table above with a brief description of what the example shows.

Pull requests welcome.
