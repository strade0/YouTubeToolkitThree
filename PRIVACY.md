# Privacy Policy — YouTube Toolkit

Last updated: 4 September 2026

YouTube Toolkit is a browser extension for Chrome and Firefox that runs only on YouTube domains, including music.youtube.com. It is not affiliated with YouTube, Google, Mozilla, or Alphabet.

This policy describes what the extension can do, what it stores on your device, and what it does **not** collect.

## What the extension does

All features run locally in the YouTube tab. Each can be turned off from the popup; a master switch turns every feature off at once.

- **Volume Drag** — Supported on YouTube and YouTube Music. Drag horizontally across a YouTube video or the YouTube Music player in song or video mode, or hold Alt and left-drag elsewhere on either site. A local on-screen HUD shows the current level. You can choose the on-player drag trigger, sensitivity, whether the HUD shows its volume icon, waveform, and percentage, and whether it follows the mouse or stays at the click position. Volume is applied to the player in that tab and remembered so it stays consistent there.
- **Layout Trimmer** — Sets a maximum YouTube watch-page width and lets you adjust the space reserved for suggested videos. The main video uses the remaining width.
- **SkipIt** — After a single skip keypress (Right Arrow or L), clicks YouTube’s native **Jump ahead** control. The quick pause/play gesture, enabled by default and configurable in the popup, can trigger the same action from headphones or any other playback control. Jump count and estimated time saved stay on your device.
- **2x Speed Lock** — Hold left-click (YouTube’s built-in 2x), hover YouTube’s native speed control, and release to lock or reset playback speed. Holding on the control briefly can expand nearby speed options. The chosen lock speed is a local setting. Speed is not sent anywhere.
- **Interactive guide** — After a fresh install, or when you click Guide in the popup, a local overlay can appear over the current YouTube page to demonstrate Volume Drag, Speed Lock, and the SkipIt pause/play shortcut. The guide does not send any data off the device.

The extension does not change video recommendations, ads, comments, or account settings.

## Permissions

Chrome and Firefox require these permissions for the features above:

| Permission | Why it is used |
| --- | --- |
| `storage` | Save feature toggles and settings in the browser’s synced extension storage, and SkipIt stats plus a temporary onboarding flag in local extension storage. Nothing in storage is uploaded to the developer. |
| Host access to `*.youtube.com` | Inject content scripts only on YouTube so the features can read the player/page DOM and apply volume, layout, skip, speed, and guide-overlay changes in that tab. |

The extension does not request access to other sites, your Google account, cookies for other origins, camera, microphone, location, or browsing history.

## Data we collect

The extension does **not** send any data to the developer or to any server operated by the developer. There is no analytics, crash reporting, advertising, telemetry, or account system.

Settings and stats stay in your browser:

- **Feature settings** (master on/off; volume sensitivity, drag trigger, HUD components, follow-cursor; layout width and suggested-video width; SkipIt triggers and threshold; 2x lock speed; and similar) are saved with the browser’s synced extension storage so they persist and may sync through your browser account when extension sync is enabled.
- **Volume** is also written to YouTube’s own page storage (`localStorage` / `sessionStorage` on youtube.com) so the player volume stays consistent in that tab. That data never leaves youtube.com except as YouTube itself already handles player volume.
- **SkipIt stats** (jump count, estimated time saved) and a short-lived **guide pending** flag are stored only in local extension storage on your device.

The extension reads the YouTube page only to:

- detect drag/click gestures on the video player (and Alt + left-drag on the YouTube page) and update volume and the local HUD
- resize the watch-page and suggested-video layout containers
- detect a local skip keypress or quick pause/play gesture, then find and click YouTube’s native “Jump ahead” control
- detect hold-click and release over YouTube’s native speed control (including the optional expanded speed pills), then lock or reset playback speed (it does not send speed data anywhere)
- display the local interactive guide overlay on the current YouTube tab

It does not read your Google account, watch history, comments, chat, search queries, or video metadata for any other purpose, and it does not transmit page contents off the device.

## Network

The extension does not make its own network requests. Any traffic you see is YouTube’s normal site traffic. There is no remote configuration, no phone-home, and no third-party scripts loaded by this extension.

## Remote code

The extension does not load or execute remote code. All scripts ship inside the extension package.

## Sharing

Nothing is sold, rented, or shared with third parties. The developer cannot see your settings, volume, layout, skip stats, or watch activity.

## Data deletion

Uninstalling the extension removes its local extension data from that browser profile. Synced copies of settings, if any, follow the browser’s own sync and account controls.

## Children’s privacy

The extension is a YouTube page tool. It does not knowingly collect personal information from anyone, including children.

## Changes

If this policy changes, the “Last updated” date above will be revised. Material changes will be reflected in the applicable Chrome Web Store or Firefox Add-ons listing.

## Contact

If you have questions about this policy, use the contact email on the extension’s store listing.
