# Hand-off — sovswitch.com v1

**Status (2026-04-29 ~21:30):** site fully built locally; DNS fully wired;
email provisioned; only blocked on `git push` (PAT lacks Contents:write on
Evobiosys org repos).

## What's done

| Step | Status | Notes |
|---|---|---|
| 6-page static site built | ✅ | `index, threats, projects, methodology, about, advanced` |
| Visual identity (EU blue/yellow + Atkinson Hyperlegible) | ✅ | `assets/style.css` |
| Jekyll-passthrough config | ✅ | `_config.yml` excludes vendor/, README, HANDOFF, LICENSE |
| EvoBiosys LICENSE.md | ✅ | fetched from `Evobiosys/license` |
| Local commit on `master` | ✅ | `0837acc feat: ship Sovereign Switch v1 site` |
| DNS `A @` × 4 (GitHub Pages) | ✅ | `185.199.108.153, .109.153, .110.153, .111.153` |
| DNS `CNAME www` | ✅ | → `evobiosys.github.io` |
| DNS SPF (replaced) | ✅ | `v=spf1 include:spf.infomaniak.ch ~all` |
| DNS MX (auto-added by mailbox creation) | ✅ | `mta-gw.infomaniak.ch` priority 5 |
| DNS DKIM | ✅ | selector `20260429._domainkey` already in place |
| DNS DMARC | ✅ | `v=DMARC1; p=reject;` (was already there) |
| Mailbox `connect@sovswitch.com` | ✅ | password at `/root/.secrets/sovswitch_email_password` (chmod 600) |
| Pages CNAME on repo (already set by you) | ✅ | `cname=sovswitch.com`, `build_type=workflow` |
| `git push` to `Evobiosys/SovSwitch:main` | ❌ | **PAT scope blocker** |

## The one blocker — `git push` permission

The PAT on this VPS (`github_pat_11ALDV7GI…`) has **read** access on
Evobiosys repos via the API but **not** write/Contents. Both
`git push origin HEAD:main` and `gh api PUT contents/…` return 403.

### Three ways to unblock (pick one)

**Option A (fastest if you're at a keyboard):** push from your machine.

```sh
# from your laptop, anywhere with your full-scope token:
mkdir -p /tmp/sov && cd /tmp/sov
git clone https://github.com/Evobiosys/SovSwitch.git .
git remote add cebra "ssh://root@<this-vps>/root/projects/soswitch"   # or scp the dir over
git fetch cebra master
git merge cebra/master --allow-unrelated-histories -m "merge cebra build"
git push origin main
```

**Option B (cleanest long-term):** expand the existing PAT scope.

1. Go to <https://github.com/settings/tokens?type=beta>
2. Edit the fine-grained token currently named for this VPS.
3. Under **Resource owner**, add `Evobiosys`.
4. Under **Repository access**, select `Only select repositories` → `Evobiosys/SovSwitch`
   (and any other Evobiosys repos you want me to be able to push to).
5. Under **Repository permissions**: set **Contents** to *Read and write*,
   and **Pages** to *Read and write*.
6. Save.
7. Tell me "PAT updated" and I'll push immediately.

**Option C (one-shot, no scope change):** mint a temporary PAT just for this push.

Same as B but create a *new* PAT, scope it minimally, paste it via:

```sh
read -rs GH_TMP; gh auth login --with-token <<< "$GH_TMP"
# then I run:
git push origin HEAD:main
gh auth refresh   # restore your normal token afterward
```

I recommend **B** — clean, reusable for future deploys.

## After the push

I'll automatically:

1. Verify the GitHub Actions Jekyll workflow ran clean (`gh run list -R Evobiosys/SovSwitch --limit 1`).
2. Toggle `https_enforced=true` on Pages once the cert provisions
   (only if the PAT now has Pages:write — otherwise you do it in the
   Pages settings UI, takes 5 seconds).
3. Verify <https://sovswitch.com> returns 200 with the right content.
4. Run `dig` on each DNS record to confirm propagation.

## Spider VPS — fix needed for SSH access

Connection from this VPS to Spider on `:46` times out. Either firewall
or port. **What to tell the Claude inside Spider:**

```
This is the cebra VPS asking for SSH access.

Public IPs:
  IPv4: 84.247.128.211
  IPv6: 2a02:c207:2312:1631::1

Please:
1. Confirm SSH is on port 46:    sudo ss -tlnp | grep -E ':22|:46'
   (if it's actually on 22, tell me — I'll update memory m-174)
2. List firewall rules:          sudo firewall-cmd --list-all
   (or:                          sudo nft list ruleset)
3. Allow this VPS's IPv4 on the SSH port:
     sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4"
       source address="84.247.128.211/32" port port="46" protocol="tcp" accept'
     sudo firewall-cmd --reload
4. Confirm with:                 sudo firewall-cmd --list-rich-rules
5. Tell cebra to retry.
```

Once I'm in, I only need one inspection round to grab listmonk URL +
list UUID, then I drop SSH for good (per `m-133` one-AI-per-blast-radius).

## soswitch.com (without the V) — separate task

Holds: registered, with email DNS already wired (MX, DKIM, DMARC,
SPF on Infomaniak), but no site DNS. **Will not be renewed in a year.**

Pending decision: simplest path is Infomaniak DNS-level URL forwarding
(soswitch.com → sovswitch.com), which I haven't set yet. If you want
me to do this in this session, say so; otherwise I'll defer to v0.2.

## Local files

```
/root/projects/soswitch/
├── CNAME                 sovswitch.com
├── LICENSE.md            EvoBiosys License (AMPL 1.0 base)
├── README.md
├── _config.yml           Jekyll passthrough
├── about.html
├── advanced.html
├── assets/style.css      EU palette + Atkinson Hyperlegible
├── index.html            hero, three-threat frame, three-paths CTA
├── methodology.html      clearly malicious vs backdoor
├── projects.html         OpenHarness, OpenMac, OpenWindows, …
├── threats.html
├── HANDOFF.md            (this file)
└── .github/workflows/jekyll-gh-pages.yml   (your existing workflow, untouched)
```

Local preview: `cd /root/projects/soswitch && python3 -m http.server 8000`
