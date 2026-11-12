# macOS signing and notarization steps

The user has an Apple Developer account (2026-11-12). Nothing here has been run yet.
Source: Tauri v2 docs, https://v2.tauri.app/distribute/sign/macos/ (read 2026-11-12).

## 1. Certificate (once, by the user)
1. In the Apple Developer site, create a `Developer ID Application` certificate. Tauri names this type for apps shipped outside the App Store.
2. Install it in the login keychain, then find its name:
   ```sh
   security find-identity -v -p codesigning
   ```

## 2. Notarization credentials (pick one)
- Apple ID: `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password, not the account password), `APPLE_TEAM_ID`.
- App Store Connect API key: `APPLE_API_ISSUER`, `APPLE_API_KEY` (Key ID), `APPLE_API_KEY_PATH` (path to the `.p8` file).

Keep these in the shell environment or a password manager. Do not commit them.

## 3. Build (in a normal terminal; `hdiutil` failed in the agent sandbox)
```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<TEAM_ID>)"
export APPLE_ID=... APPLE_PASSWORD=... APPLE_TEAM_ID=...
pnpm --filter desktop tauri build --bundles dmg
```
Tauri signs and notarizes when these variables are set.

## 4. Check the result
```sh
spctl -a -vv -t install <path-to>.dmg
xcrun stapler validate <path-to>.dmg
```
Then open the DMG on a second account or Mac and confirm Gatekeeper opens the app without a warning.

## Not decided here
- CI signing (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` with a base64 `.p12`). Local builds first.
- Version number for the first public build (`tauri.conf.json` is `0.1.0`).
