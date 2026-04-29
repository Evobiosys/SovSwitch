# Sovereign Switch — sovswitch.com

The pragmatic path off Big Tech. Move your data, accounts, and apps to
open-source, end-to-end-encrypted, EU-jurisdiction providers — without
becoming a Linux engineer.

A project in the [EvoBioSys](https://github.com/Evobiosys) constellation.

## Stack

- Plain HTML + CSS, no build step (Jekyll passthrough via GitHub Actions)
- Atkinson Hyperlegible via Bunny Fonts (EU CDN)
- GitHub Pages on `Evobiosys/SovSwitch`
- Custom domain: `sovswitch.com`
- Email: `connect@sovswitch.com` (Infomaniak Mail)
- Newsletter: `mailto:` for v1; Spider VPS Lite listmonk integration is v0.2

## Pages

- `/` — hero, three-threat frame, three paths, projects grid, mailto signup
- `/threats.html` — deeper on data harvesting / structural surveillance / hackers
- `/projects.html` — OpenHarness, secureOpenHarness, OpenMac, OpenWindows, deGoogle, Incogni
- `/methodology.html` — clearly malicious vs backdoor; provider grading rubric
- `/about.html` — outer-ring framing, EvoBioSys context
- `/advanced.html` — link-out to Vitalik / Privacy Guides / Sovereign Tech Fund

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## DNS

Configured at Infomaniak (domain id `2146506`):

- `A @` → `185.199.108.153`, `.109.153`, `.110.153`, `.111.153` (GitHub Pages)
- `CNAME www` → `evobiosys.github.io`
- `MX, SPF, DKIM, DMARC` — wired for `connect@sovswitch.com` via Infomaniak Mail

## Adjacent

- `soswitch.com` (without the V) — older spelling, redirects to sovswitch.com
  while it's alive; will not be renewed.

## License

See [LICENSE.md](LICENSE.md). Adapted from the [EvoBiosys License](https://github.com/Evobiosys/license)
(AMPL 1.0 base).
