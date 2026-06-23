# kep-ci

Shared, reusable GitHub Actions CI for KEP repos. The same CI logic used to be
copy-pasted into every repo and drifted out of sync. This repo holds **one copy**
that every repo calls.

> Status: in the `Cybozu-SD` org (`Cybozu-SD/kep-ci`). While KEP-7 CI is being
> built, the live callers and the in-repo refs point at the feature branch
> `@SSR-6111_Implement-CI-workflows-for-KEP7`. The examples below show `@main`
> (the post-merge target); after merge, tag `@v1` and switch callers to it.
>
> kep-ci is an **INTERNAL** repo, so two things must be set up once — see
> [Access & tokens](#access--tokens-internal-repo).

## What's here

### Reusable workflows (`.github/workflows/`)

| File | Purpose | Key inputs |
| --- | --- | --- |
| `lint.yml` | Reusable lint (+ optional CSS format check), one matrix job per package. | `packages` (required), `max-parallel` (2), `continue-on-error` (true) |
| `license-check.yml` | Reusable license check, single sequential job (order matters). | `licenses` (required, max 8) |
| `check-before-releasing.yml` | Reusable pre-release check (tasks/backlogs status, optional common-PRs). Runs the shared Node scripts. | `version-package-path` (required), `check-common-prs` (false), `kep-ci-ref` (feature branch); caller passes `secrets: inherit` |
| `verify-release-base.yml` | Reusable guard: release branch must equal base-branch HEAD. | `base-branch` (main) |
| `build-and-package.yml` | Reusable build + package. Picks a build/collect bash script by `is-monorepo`, attaches LICENSE, uploads binary + source ZIPs. | `is-monorepo` (true), `version-package-path` (required), `artifact-name` (required), `project-dir` (.), `kep-ci-ref` (feature branch); secret `KEP_RELEASE_AUTOMATION_APP_PRIVATE_KEY` |
| `create-release.yml` | Reusable final step: download build artifacts + publish GitHub pre-release. | `version-package-path` (required), `artifact-pattern` (required), `release-note-path` (RELEASE-NOTE.md) |

### Build scripts (`.github/scripts/`)

| File | Purpose |
| --- | --- |
| `build-release-monorepo.sh` | Build/collect for `packages/*` monorepos (KEP glob convention). Used when `is-monorepo: true`. |
| `build-release-single.sh` | Build/collect for a single-project repo. Used when `is-monorepo: false`. TEMPLATE — untested; adjust globs when a normal repo adopts it. |

### Shared Node scripts (`.github/scripts/`, no npm deps)

These live here ONCE instead of being copied per repo. `check-before-releasing.yml` (and `build-and-package.yml`) check this repo out into `.kep-ci/` at runtime and run them. Because kep-ci is INTERNAL, that checkout needs a token — see [Access & tokens](#access--tokens-internal-repo).

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

> The examples pin `@main` (post-merge target). Until KEP-7 CI merges, point
> callers at `@SSR-6111_Implement-CI-workflows-for-KEP7` instead.

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
      check-common-prs: false
    secrets: inherit
```

> `secrets: inherit` forwards all the caller's org secrets (kintone API tokens +
> the App private key) to the reusable in one line. This is required: GitHub
> never lets a reusable workflow read secrets the caller hasn't passed, so there
> is no "zero-pass" option. You can list the secrets explicitly instead, but
> `inherit` is the least to maintain.

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
    secrets: inherit   # for the App key that clones internal kep-ci

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

## Access & tokens (internal repo)

kep-ci is **INTERNAL**, so two one-time setups are needed (a public repo wouldn't
need either):

1. **Reusable-workflow / action access.** kep-ci → Settings → Actions → General →
   *Access* → "Accessible from repositories in the Cybozu-SD organization". Without
   this, callers fail to even resolve the workflow ("workflow was not found").

2. **A token to clone kep-ci.** `check-before-releasing.yml` and
   `build-and-package.yml` check this repo out at runtime to run the scripts. The
   caller's default `GITHUB_TOKEN` can't read another repo, so these workflows mint
   a short-lived **GitHub App token** (`actions/create-github-app-token`, App
   `KEP_RELEASE_AUTOMATION`) and use it for the checkout. For this to work the App
   must have **Contents: Read** on kep-ci (Org → GitHub Apps → KEP_RELEASE_AUTOMATION
   → Repository access → add `kep-ci`). The caller supplies the App private key via
   `secrets: inherit`; the client-id comes from `vars.KEP_RELEASE_AUTOMATION_APP_ID`.

> `lint.yml`, `license-check.yml`, `verify-release-base.yml` and `create-release.yml`
> do NOT clone kep-ci, so they need only setup #1, not a token.

## Versioning

- In-repo refs (`uses:` to kep-ci's own actions, the `kep-ci-ref` input defaults)
  currently point at the feature branch `SSR-6111_Implement-CI-workflows-for-KEP7`.
- After KEP-7 CI merges to `main`: bump those in-repo refs and every caller
  `@SSR-6111_…` to `@main`, then tag `@v1` and move callers to `@v1`.

## Limits

- `license-check.yml` supports up to **8 packages** (fixed slots). Add more slots if a repo needs more.
