# Public launch checklist / 公开前清单

The repository remains private during preparation. Making a GitHub repository public also exposes its reachable commit history and Release assets, not only the latest README.

## Prepared

- [x] Chinese, English and Japanese project entry points; application language limitations stated.
- [x] Original vector branding and a fictional-data screenshot with fixture disclosure.
- [x] Versioned prebuilt Harness package, SHA-256 and install / migration guide.
- [x] MIT license retaining the existing notice, original-skill authorization record and dependency notices.
- [x] Contribution, conduct, support, security, issue and pull request guidance.
- [x] Least-privilege CI configuration for tests, docs, build and package artifacts; dependency update configuration.
- [x] No private manuscript/state/settings files included in the preparation changes.

## Before changing visibility

- [ ] Repository owner explicitly chooses to make it public. Preparation is not a visibility change.
- [ ] Review all reachable Git history and previously attached assets for personal information, credentials and material not intended for public release. A pattern scan is not proof of absence.
- [ ] Confirm the retained original copyright attribution and final public-facing maintainer identity. No existing attribution has been removed or reassigned.
- [ ] Review the complete skill snapshot for content the owner wants public; ownership and permission to include it under MIT were confirmed on 2026-11-14.
- [ ] Check the latest GitHub Actions result and verify download / installation from a separate machine. Anonymous URL installation can only be tested after public access is enabled.
- [ ] Enable and verify GitHub private vulnerability reporting after public access is chosen. The current private-repository API returned 404; the security policy gives a fallback without public disclosure.
- [ ] Consider GitHub branch protection / rulesets appropriate to account capabilities. An upload-ready 1280×640 [social preview](assets/social-preview.png) is included; GitHub Settings → General → Social preview is a manual repository setting not changed by this commit. No account-level protections are claimed by these files.

## Release discipline

Keep published package bytes immutable. For a new application version, increment package version, run checks, pack, compute checksums, and create a matching version tag / Release. Do not replace v0.9.4 with a different tarball under the same name. The current repository documentation can evolve without reinstalling the running plugin.

CI uploads build artifacts for maintainers; it does not automatically publish to npm, make the repository public or deploy Harness. See [maintainer release guide](release.md).
