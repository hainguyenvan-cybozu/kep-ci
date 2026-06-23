# kep-ci

Shared, reusable GitHub Actions CI for KEP repos. The same CI logic used to be
copy-pasted into every repo and drifted out of sync. This repo holds **one copy**
that every repo calls.

> Status: published in the `Cybozu-SD` org (`Cybozu-SD/kep-ci`). Callers use
> `@main` for now; pin to a tag (`@v1`) once it is stable.

## What's here

### Reusable workflows (`.github/workflows/`)

| File | Purpose | Key inputs |
| --- | --- | --- |
| `lint.yml` | Reusable lint (+ optional CSS format check), one matrix job per package. | `packages` (required), `max-parallel` (2), `continue-on-error` (true) |
| `license-check.yml` | Reusable license check, single sequential job (order matters). | `licenses` (required, max 8) |
| `check-before-releasing.yml` | Reusable pre-release check (tasks/backlogs status, optional common-PRs). Runs the shared Node scripts. | `version-package-path` (required), `check-common-prs` (false), `kep-ci-ref` (main) + secrets |
| `verify-release-base.yml` | Reusable guard: release branch must equal base-branch HEAD. | `base-branch` (main) |
| `build-and-package.yml` | Reusable build + package. Picks a build/collect bash script by `is-monorepo`, attaches LICENSE, uploads binary + source ZIPs. | `is-monorepo` (true), `version-package-path` (required), `artifact-name` (required), `project-dir` (.), `kep-ci-ref` (main) |
| `create-release.yml` | Reusable final step: download build artifacts + publish GitHub pre-release. | `version-package-path` (required), `artifact-pattern` (required), `release-note-path` (RELEASE-NOTE.md) |

### Build scripts (`.github/scripts/`)

| File | Purpose |
| --- | --- |
| `build-release-monorepo.sh` | Build/collect for `packages/*` monorepos (KEP glob convention). Used when `is-monorepo: true`. |
| `build-release-single.sh` | Build/collect for a single-project repo. Used when `is-monorepo: false`. TEMPLATE — untested; adjust globs when a normal repo adopts it. |

### Shared Node scripts (`.github/scripts/`, no npm deps)

These live here ONCE instead of being copied per repo. `check-before-releasing.yml` checks out this repo into `.kep-ci/` at runtime and runs them.

| File | Purpose |
| --- | --- |
| `check-tasks-status.js` | Check SSR task status before releasing. |
| `check-backlogs-status.js` | Check project backlog status before releasing. |
| `check-kep-common-prs.js` | Check KEP common PRs (only when `check-common-prs: true`). |
| `check-license-versions.js` | License-version check. Present but not wired into a reusable workflow yet (used by app-analysis's extra job). |

### Composite actions (`.github/actions/`)

| File | Purpose |
| --- | --- |
| `setup-node/` | Install Node.js at the KEP version (hardcoded, no input). Edit the version here to bump every workflow. |
| `setup-pnpm/` | Install pnpm at the KEP version (hardcoded, no input). Edit the version here to bump every workflow. |
| `takumi-guard/` | Composite wrapper for `Cybozu-SD/takumi-guard-action`. Edit the ref here to update every workflow at once. |

## How a repo uses it

A repo keeps a **thin caller** workflow that only sends its own package list.

### Lint — `.github/workflows/commit.yml`

```yaml
name: On commit
on:
  push:
jobs:
  lint:
    uses: Cybozu-SD/kep-ci/.github/workflows/lint.yml@main
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
    uses: Cybozu-SD/kep-ci/.github/workflows/license-check.yml@main
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
    uses: Cybozu-SD/kep-ci/.github/workflows/check-before-releasing.yml@main
    permissions:
      contents: read
      actions: write
      pull-requests: write
    with:
      version-package-path: "./packages/customization-deployment-request/package.json"
      check-common-prs: false   # app-analysis sets true
    secrets:
      KEP_PLUGINS_MANAGEMENT_APP_API_TOKEN: ${{ secrets.KEP_PLUGINS_MANAGEMENT_APP_API_TOKEN }}
      KEP_SSR_APP_API_TOKEN: ${{ secrets.KEP_SSR_APP_API_TOKEN }}
      KEP_RELEASE_AUTOMATION_APP_PRIVATE_KEY: ${{ secrets.KEP_RELEASE_AUTOMATION_APP_PRIVATE_KEY }}
```

> Secrets are passed explicitly here. Now that kep-ci is inside `Cybozu-SD`,
> `secrets: inherit` would also work; explicit passing still works and is clearer
> about exactly which secrets the workflow needs.

The shared scripts (`check-tasks-status.js`, `check-backlogs-status.js`, and
`check-kep-common-prs.js` when `check-common-prs: true`) live in
`.github/scripts/` here. The workflow checks out this repo into `.kep-ci/` at
runtime to run them, so caller repos can delete their own copies.

### Release — `.github/workflows/auto-release.yml`

The full release is 4 reusable jobs chained together. The caller only passes the
per-repo paths/names; all build/zip/publish logic lives in kep-ci.

```yaml
name: Auto release
on:
  push:
    branches: [release]
permissions:
  contents: read
  actions: write
jobs:
  # 1. release branch must equal main HEAD
  verify-base:
    if: ${{ github.event.created == true }}
    uses: Cybozu-SD/kep-ci/.github/workflows/verify-release-base.yml@main
    with:
      base-branch: main

  # 2. same license flow as check-license -> uploads the "LICENSE" artifact
  generate_release_file:
    needs: verify-base
    if: ${{ success() }}
    permissions:
      id-token: write
      contents: write
    uses: Cybozu-SD/kep-ci/.github/workflows/license-check.yml@main
    with:
      licenses: |
        [
          { "working_directory": "./packages/customization-deployment-request", "license_filename": "LICENSE-customization-deployment-request" },
          { "working_directory": "./packages/customization-template-master",     "license_filename": "LICENSE-customization-template-master", "trigger_license_combination": "true" }
        ]

  # 3. build + collect (monorepo glob) + attach LICENSE + upload binary/source ZIPs
  build_and_package:
    needs: [verify-base, generate_release_file]
    if: ${{ success() }}
    uses: Cybozu-SD/kep-ci/.github/workflows/build-and-package.yml@main
    permissions:
      id-token: write
      contents: read
    with:
      is-monorepo: true
      version-package-path: "./packages/customization-deployment-request/package.json"
      artifact-name: "customization-request-and-deployment"

  # 4. publish the GitHub pre-release from the uploaded artifacts
  create-release:
    needs: build_and_package
    uses: Cybozu-SD/kep-ci/.github/workflows/create-release.yml@main
    permissions:
      contents: write
      actions: write
      issues: write
    with:
      version-package-path: "./packages/customization-deployment-request/package.json"
      artifact-pattern: "customization-request-and-deployment_v*"
      release-note-path: "release-assets/RELEASE-NOTE.md"
```

`build-and-package.yml` uploads two ZIPs: a binary `<artifact-name>_v<VERSION>.zip`
and a source `<artifact-name>_v<VERSION>_src.zip`. For a non-monorepo repo set
`is-monorepo: false` and `project-dir` to the folder holding `package.json`
(e.g. `plugin` or `customization`).

> Tip: to verify the built ZIP contents WITHOUT publishing a release, copy this
> pipeline but drop `verify-base` + `create-release`, and add a job that downloads
> the artifacts and checks them. See `auto-release-test.yml` in the caller repo.

## Versioning

- Callers should pin to a tag (`@v1`) once this is stable.
- During testing, callers use `@main`.
- Actions inside this repo are pinned to `@main` for now.

## Limits

- `license-check.yml` supports up to **8 packages** (fixed slots). Add more slots if a repo needs more.
