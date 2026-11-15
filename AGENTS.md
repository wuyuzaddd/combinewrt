## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.

## Node.js Build Resource Limits

The development host (AMD 5800H in PVE) overheated during a few heavy `npm run build` runs. Resource caps are a recommendation for local/production builds on constrained or thermally limited hardware, not a requirement of the application.

Recommended wrapper when building on such a host:

```bash
systemd-run --user --scope -p CPUQuota=600% -p MemoryMax=6G -p RuntimeMaxSec=1800 -- bash -c "NODE_OPTIONS='--max-old-space-size=6144' npm run build"
```

- CPU quota ~3 physical cores and a 6 GB memory cap are usually enough for this app.
- For builds longer than ~2 minutes, append `> build.log 2>&1` inside the inner bash command to survive SSH disconnects.
- If the host still overheats, lowering the CPU max frequency (for example to 3.2 GHz) is an optional host-level mitigation.
