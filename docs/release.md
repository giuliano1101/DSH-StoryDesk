# Maintainer release guide

1. Review scope, compatibility and migration / backup requirements. Increment version for runtime changes and update CHANGELOG.md. Refresh dependency notices against the lockfile when dependencies change, retaining original copyright and license text.
2. In a clean checkout, install locked dependencies, run `pnpm test`, `pnpm run test:docs`, `pnpm build`, then `pnpm run test:sites`.
3. Run `pnpm pack --pack-destination release-assets`. Inspect the tarball manifest and verify it contains runtime files but no user data or secrets. Generate SHA256SUMS.txt for the tarball.
4. Commit source and tag the intended commit as `vX.Y.Z`. Create a GitHub Release draft, attach the tarball, checksum, dependency notices and installation notes; verify downloads before publishing the Release to authorized repository viewers.
5. Test installation / upgrade in an isolated Harness profile, retain data backups and record actual coverage. Do not imply all platforms or models were tested.
6. Update pinned install examples and translated documentation only after the package is available. Never retarget an existing published tag or overwrite immutable installation assets silently.

The `CI` workflow produces a tarball, checksum, dependency metadata and notices as an Actions artifact. Downloading that artifact is a maintainer convenience, not a replacement for the versioned Release link used by authors. No workflow here changes repository visibility or publishes npm packages.

## Existing v0.9.4

The original package remains attached to its existing Release and original source tag. Later repository presentation changes do not rebuild or replace it. Its SHA-256 is recorded in the [installation guide](installation.md).
