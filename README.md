# kep-ci

Shared, reusable GitHub Actions CI for KEP repos. The same CI logic used to be
copy-pasted into every repo and drifted out of sync. This repo holds **one copy**
that every repo calls.

> Status: testing on the user's own account first
> (`hainguyenvan-cybozu/kep-ci`, public). Will be published to `Cybozu-SD` later.

## What's here

| File | Purpose |
| --- | --- |
| `.github/workflows/lint.yml` | Reusable lint (+ optional CSS format check), one matrix job per package. |
| `.github/workflows/license-check.yml` | Reusable license check, single sequential job (order matters). |
| `.github/workflows/check-before-releasing.yml` | Reusable pre-release check (tasks/backlogs status, optional common-PRs). Runs the shared scripts. |
| `.github/scripts/` | Shared Node scripts (no npm deps) used by `check-before-releasing.yml`. Live here ONCE instead of being copied per repo. |
| `.github/actions/takumi-guard/` | Composite wrapper for `Cybozu-SD/takumi-guard-action`. Edit the ref here to update every workflow at once. |

## How a repo uses it

A repo keeps a **thin caller** workflow that only sends its own package list.

### Lint — `.github/workflows/commit.yml`

```yaml
name: On commit
on:
  push:
jobs:
  lint:
    uses: hainguyenvan-cybozu/kep-ci/.github/workflows/lint.yml@main
    permissions:
      id-token: write
      contents: read
    with:
      packages: |
        [
          { "package": "packages/customization-deployment-request", "run_lint": true, "run_css": true },
          { "package": "packages/customization-template-master",     "run_lint": true, "run_css": true }
        ]
```

### License — `.github/workflows/check-license.yml`

```yaml
name: Check license
on:
  pull_request:
    branches: [main, develop]
jobs:
  license-check:
    uses: hainguyenvan-cybozu/kep-ci/.github/workflows/license-check.yml@main
    permissions:
      id-token: write
      contents: write
    with:
      licenses: |
        [
          { "working_directory": "./packages/customization-deployment-request", "license_filename": "LICENSE-customization-deployment-request" },
          { "working_directory": "./packages/customization-template-master",     "license_filename": "LICENSE-customization-template-master", "trigger_license_combination": "true" }
        ]
```

Mark only the **last** license entry with `"trigger_license_combination": "true"`.

### Pre-release check — `.github/workflows/check-before-releasing.yml`

```yaml
name: Check tasks/backlogs status before releasing
on:
  pull_request:
    branches: [main, develop]
jobs:
  check:
    uses: hainguyenvan-cybozu/kep-ci/.github/workflows/check-before-releasing.yml@main
    secrets: inherit
    permissions:
      contents: read
      actions: write
      pull-requests: write
    with:
      version-package-path: "./packages/customization-deployment-request/package.json"
      check-common-prs: false   # app-analysis sets true
```

The shared scripts (`check-tasks-status.js`, `check-backlogs-status.js`,
`check-kep-common-prs.js`, `check-license-versions.js`) live in
`.github/scripts/` here. The workflow checks out this repo into `.kep-ci/` at
runtime to run them, so caller repos can delete their own copies.

## Versioning

- Callers should pin to a tag (`@v1`) once this is stable.
- During testing, callers use `@main`.
- Actions inside this repo are pinned to `@main` for now.

## Limits

- `license-check.yml` supports up to **8 packages** (fixed slots). Add more slots if a repo needs more.
