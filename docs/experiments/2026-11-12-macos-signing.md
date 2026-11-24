# macOS signing and notarization

First signed, notarized build: 2026-11-17 (app), DMG notarized 2026-11-24. Procedure below is what actually worked.
Source: Tauri v2 docs, https://v2.tauri.app/distribute/sign/macos/ (read 2026-11-12).

## Setup on this Mac (done, do not repeat)
- Signing identity: `Developer ID Application: Seongjoon Kim (A922BP334F)`, Apple certificate ID `ZY456K5PD7`, expires 2027-12-13. Private key lives only in the login keychain; the user keeps a `.p12` backup.
- Notarization credentials: keychain profile `somm-notary` (`xcrun notarytool store-credentials`, Apple ID + app-specific password). Agents can notarize with the profile name without seeing the password.
- Recreating the certificate on a new Mac: import the `.p12` backup. Only if it is lost, create a new CSR (Keychain Access, or `openssl` + `security import -t priv -f openssl`) and a new Developer ID Application certificate; the account allows up to five.

## Release build
1. Free disk: keep at least 10 GB (a release build from scratch writes several GB).
2. Build, sign and notarize the app. This step still needs the app-specific password in the environment because Tauri reads `APPLE_ID`/`APPLE_PASSWORD`; the user runs it in their own terminal:
   ```sh
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Seongjoon Kim (A922BP334F)"
   export APPLE_TEAM_ID="A922BP334F" APPLE_ID="<developer account email>"
   read -s APPLE_PASSWORD && export APPLE_PASSWORD
   pnpm --filter desktop tauri build --bundles dmg
   ```
   Allow `codesign` keychain access ("Always Allow") and Finder automation if asked. Notarizing the app waits on Apple for a few minutes.
3. Notarize and staple the DMG itself (Tauri only notarizes the app inside). Agents can run this:
   ```sh
   cd apps/desktop/src-tauri/target/release/bundle/dmg
   xcrun notarytool submit somm_<version>_aarch64.dmg --keychain-profile somm-notary --wait
   xcrun stapler staple somm_<version>_aarch64.dmg
   ```

## Checks
With `--bundles dmg`, Tauri removes `bundle/macos/somm.app` after making the DMG, so `spctl` on that path fails with `invalid API object reference`. Check the DMG and the app inside it:
```sh
D=somm_<version>_aarch64.dmg
spctl -a -t open --context context:primary-signature -vv "$D"   # accepted, Notarized Developer ID
M=$(mktemp -d); hdiutil attach -nobrowse -readonly -mountpoint "$M" "$D"
spctl -a -vv "$M/somm.app"                                      # accepted, Notarized Developer ID
xcrun stapler validate "$M/somm.app"
hdiutil detach "$M"
```
Plain `spctl -a -vv -t install` on a DMG is not the right assessment.

## Results: 0.1.0 (aarch64)
| Check | Result |
|---|---|
| App signature | Developer ID, Team `A922BP334F`, hardened runtime, secure timestamp |
| App notarization | ticket stapled; Gatekeeper `accepted`, `Notarized Developer ID` |
| DMG notarization | submission `8a54f9fc-4df1-49f4-9090-c6dd51060554` `Accepted`, stapled; Gatekeeper `accepted` |
| SHA-256 | `2f7107e91f3d9d33ef4fba6269b9d8b7633ca8358aa3301ff65042c77e1949af` |

Not verified: opening the DMG on a second Mac or account, and an Intel (x86_64) build.

## Not decided here
- Notarizing the app with the keychain profile instead of `APPLE_PASSWORD` (Tauri's documented variables do not include a keychain profile; untested).
- CI signing (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` with a base64 `.p12`).
- Version number for the first public build (`tauri.conf.json` is `0.1.0`).
