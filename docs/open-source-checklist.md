# Public launch record / 开源记录

The repository owner explicitly authorized public release on **2026-11-14**. StoryDesk is distributed under [MIT](../LICENSE), retaining the existing copyright notices and the original skill author’s confirmed permission.

## Prepared and reviewed

- [x] Chinese, English and Japanese entry points; Chinese-first application language stated honestly.
- [x] Built-in-image-generated branding, with genuine fictional-data UI screenshots separately identified.
- [x] Versioned prebuilt Harness package, checksums and installation / migration guidance.
- [x] License, skill provenance, dependency notices, contribution, conduct and security guidance.
- [x] Core / docs tests, production build, Sites checks and CI packaging.
- [x] Reachable Git history and released attachment inventory reviewed before publication. Common credential-pattern / private-data-path scans found no matches. This is not a guarantee that automated scanning detects all sensitive content.
- [x] Existing contributor identities and original attribution retained; no history was rewritten or reassigned.

## Main branch policy

The public launch configures `main` to require pull requests and the three named GitHub Actions checks below, with an up-to-date branch and resolved review conversations. Force pushes and branch deletion are disabled; administrators are covered too. No extra approving reviewer is required for this single-maintainer repository, so the owner can merge their own PR after the checks pass.

- `Node 20 / ubuntu-latest`
- `Node 22 / ubuntu-latest`
- `Node 22 / macos-latest`

Do not bypass protection to make routine updates. Submit a branch / pull request instead. Keep job names and required-check settings in sync if the CI matrix changes.

## Publication verification

Public access, anonymous release downloads, the v0.9.4 archive hash, enabled private vulnerability reporting and effective branch protection are independently checked as part of the launch. The original installation tarball stays byte-for-byte unchanged.

A native installation on a second physical Mac has not been performed by this launch task. Prior local Harness installation and real-model acceptance are documented in [0.9.4 verification](verification/0.9.4.md). Platform and host-version limits still apply.

## Optional presentation setting

An upload-ready [social preview](assets/social-preview.jpg) is included. Setting the image in GitHub Settings → General → Social preview is a separate optional UI setting; the README artwork is already wired into all language pages.

## Release discipline

Published package bytes remain immutable. For a new application version, increment the version, run checks, pack, compute checksums and create a matching version tag / Release. Do not replace v0.9.4 with another tarball under the same name. CI produces artifacts but does not automatically publish npm packages or deploy Harness. See [maintainer release guide](release.md).
