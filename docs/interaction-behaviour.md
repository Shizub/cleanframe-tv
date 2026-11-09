# Interaction behaviour — 0.7.0

## Home

- Dock: Left/Right scrolls the apps without wrapping. Up enters the top-right controls, starting with Art Mode or the last selected control. Left/Right moves between Art Mode, Inputs, All apps, Samsung Home and Settings. Down or Back returns to the selected app. The clock is at the top left.
- List: Up/Down scrolls the apps without wrapping. Right enters the bottom-right controls, aligned with the clock above. Up/Down moves between Art Mode, All apps and Settings. Left or Back returns to the selected app. The list fades at both ends as it scrolls.
- Duo (the default for a new installation): apps and the five controls form one row. Left/Right walks along it without wrapping and bounces once per press at each end; a held key does not repeat the bounce. Up and Down do nothing. Back opens the choice to stay or open Samsung Home. After 20 seconds on Home the row fades out, and the first key only brings it back. On starting, the launcher stays hidden until its images are ready, for at most 2.5 seconds, then fades in whole.
- OK opens the selected item. Focus alone never launches an app.
- Icons-only apps and controls reveal their names when focused. App presentation and control presentation are independent.
- Back from the app list or Dock opens a choice to stay or open Samsung Home.
- A panel keeps focus within its own controls. Back closes one panel at a time.
- Returning to the running launcher keeps the selected app or panel item. There is no auto-return timer. Held OK and Back keys act once until the key is released.

## Settings and appearance

Settings opens a grouped overview: Background, Layout, Typography, Focus, Apps on Home and Samsung. OK opens a group. Appearance groups use a two-pane screen with visible choices on the left and the committed Home preview on the right.

| Group | Choices |
| --- | --- |
| Background | Photo, Light, Dark; Wallpaper and Rotation when Photo is active |
| Layout | List or Dock; independent Text, Icons or Both choices for apps and Home controls |
| Typography | Manrope, Neue Montreal, Mori, Pangram Sans, Geist and Newsreader, when available |
| Focus | Type or Glass; Soft, Frost or Clear tint material |
| Apps on Home | Membership and arrangement editor |
| Samsung | Samsung Home, TV settings and Inputs |

In Duo, Settings keeps Appearance (Auto, Day or Night), Wallpaper, Layout, Sounds, Apps on Home and Samsung. Background, Typography and Focus do not apply to this layout. Auto follows the sun at the configured weather place.

Wallpaper opens a gallery of thumbnails, four across, that scrolls with the selection. OK applies one at once and leaves the gallery open, so the screen around the card shows the result. The new wallpaper, its glass and its frost are all loaded first and then change together; if one of them fails to load, the current wallpaper stays and the gallery offers to try again.

### Duo panels

Duo draws every panel as a card of frost over the wallpaper, in place of the screens described in this document. The clock and the row step aside while a card is open, and the wallpaper itself shows a change of day or night. There is no Home preview and no Back row: Back closes one card at a time.

- Lists: Up/Down moves a plate along the lines and bounces once at each end. OK applies a choice and stays, with a checkmark on the applied one, or opens the next card.
- All apps: five columns of colour icons, with a badge on those on Home. Up from the first row reaches Organise Home.
- Apps on Home: each app keeps a line that glides between On Home and Not on Home. Right from a name reaches its remove button, then the other column. Recently removed apps come first in Not on Home, without their own heading. Down from the top buttons returns to the column they were reached from.
- Back on Home: a card offers to stay or open the Samsung menu, as a list.
- Inputs: the selection lands on the active input once the TV has listed them. Its last line, Choose the devices, opens a card with each port, then a card with the devices for that port.
- Short messages float above the card for two seconds: the order is saved, a change is undone, a limit is reached, or a save failed.

Up/Down moves between rows. Left/Right moves between choices in a horizontal row. Focus alone changes neither the preview nor saved preferences in these appearance groups. Wallpaper has its own temporary photo preview, described below. OK applies the focused value. A checkmark identifies the applied value; the filled plate identifies remote focus. Applying the current value does not write again.

Material applies to a photographic Dock, or Glass focus on a photographic List. Inactive material choices remain visible with an explanation and are skipped during navigation. Their stored value is retained. Wallpaper and rotation are also inactive on flat backgrounds.

A font or photo change applies only after its resources are ready and storage succeeds. A load or storage failure keeps the previous appearance and checkmark, with a Try again action. Back cancels a pending change, leaves the group and keeps completed changes. Late load callbacks cannot apply a cancelled choice. There is no Save button. Returning to a group restores its last choice focus; returning to Settings restores its category focus. Rotation is nested within Background, and Back returns to its Rotation row.

The selected font applies to Home app names, the clock and Home controls, including Newsreader. Settings, All apps, the Home editor and status text retain Manrope. The preview shows the committed Home appearance and its clock continues to update. Pangram faces are available in Nathan's private build when the local files are present; their binaries are not included in the public source. An unavailable optional face is omitted. If the baseline font is slow or missing, Home remains usable with a local fallback and can recover when the font loads.

### Duo sounds and volume

Each gesture has its sound: a click that rises from left to right along the row, a dull one at the end of a row, an opener one between the capsules, a press for OK and for Back, a breath in and out with a card, a low note when the row wakes, a short rise when an app or a source takes over, two notes when a device is plugged in or out, and two knocks for a refusal. A held key spaces its clicks and softens them. There is no sound at startup, at rest, when the minute changes or while the TV is muted, and the sound stops when an app or a source takes over.

Settings → Sons offers Normal, Discret (the default) and Coupés, and the style: Verre (the default), Goutte, Zen, Galet, Bois, Feutre, Bronze or Ardoise. Choosing a style plays it. At night the sounds are softer and less bright. Sortie du son opens the TV's settings, since the public API can neither choose nor name the output, and the sounds follow that choice. List and Dock stay silent.

In Duo, the launcher takes the volume keys while it is on screen and changes the volume through the TV's public API, with a pill of baked glass and a click at each step, in place of Samsung's banner. Inside an app, the TV keeps its banner. If the audio API is missing or refuses, the keys go back to the TV. Whether Samsung's banner stays away, and whether the number is right with an external speaker, is only known on the TV.

## Streaming apps

The six default apps keep their known native IDs. Other installed consumer apps can also be added to Home. Launching uses the public `tizen.application.launch` API with the app's native ID. Missing apps and denied launches produce a real error. No web player, placeholder success page or account credential is embedded.

## All apps

The panel reads `tizen.application.getAppsInfo` on entry and shows the filtered consumer apps alphabetically. Samsung's visibility flag alone also exposes system utilities, so EP packages, background services, ad players, account utilities, placeholders and duplicates are omitted. Known brands use bundled marks. Other apps use their local installed icon, with initials as a fallback.

The five-column grid scrolls with remote focus. OK launches an app; its On Home badge shows membership. Up from the first row reaches Apps on Home, which opens the editor. An API failure shows a retry and keeps saved Home choices. Browser previews report that installed-app discovery and launching require the TV.

## Apps on Home

Open the editor from Settings or All apps. On Home shows the current order on the left. Not on Home shows Recently removed first, followed by other installed apps on the right. Home holds one to nine apps.

- Reorder: OK on an app name picks it up. Up/Down moves it. OK places it and saves the order. Back puts an unplaced app back without saving that move.
- Remove: Right from an app name reaches Remove from Home. OK saves the removal and moves focus to the same app in Recently removed. The app stays installed.
- Add: OK on an app in Not on Home adds it and saves. A recently removed app returns to its previous position within the editing session; another app is added at the end. Focus follows the app to its Remove from Home control, so another OK can reverse the addition.
- Undo reverses a completed addition, removal or reorder from the current editing session. Done or Back closes the editor and keeps completed changes. Undo history ends when the editor closes.

Removing the last Home app or adding a tenth app is prevented. A failed storage write keeps the committed choices and order, with a retry message. Saved native app IDs and names survive a restart or a failed catalogue refresh.

Home follows the TV. Each time the catalogue is read, an app that is no longer installed leaves Home and Recently removed, silently. A new app only joins All apps, so a first run keeps just the default apps that are installed. A failed read changes nothing, and neither does a list without any of the apps on Home, which looks more like a fault of the TV than a row to empty. An app being carried in the editor waits for the next read.

## Art Mode and Samsung screens

Art Mode sends an application control to the installed `org.tizen.art-app`, with `mode=fullscreen` and `requester=mobile`. This aims to enter native Art Mode with its current artwork, without toggling power or changing the selected artwork.

This mode comes from [research on Samsung's Art app](https://github.com/TheFab21/ha-samsungtv-smart/blob/master/notes/QN55LS03FAFXZA/ART_MODE_DECOMPILED.md), on another Tizen 9 Frame model. It is an internal Samsung contract, not a documented public Art API. Its visible behaviour on this exact firmware must be confirmed on the TV.

Samsung Home explicitly launches the original `com.samsung.tv.csfs` app, independently of the new Home assignment. The earlier `com.samsung.tv.coba.newhome` component did not open Smart Hub visibly and is no longer the escape target. TV settings still uses `com.samsung.tv.coba.setting`. Exact on-device destinations are recorded in docs/tv-status.md; launch callbacks alone are not visual proof. There is no blind power-key fallback.

All calls have bounded response handling. A failure leaves CleanFrame usable. No simulated device success views remain. Browser validation cannot confirm the visible Samsung destination.

Installed-app discovery allows up to 20 seconds for large TV catalogues; launch controls retain an 8-second limit. The catalogue is read when the launcher comes on screen and each time All apps or the editor opens, while retaining saved Home choices. Nothing is read during hidden startup, and there is no polling.

## HDMI inputs

The Inputs control on Home, or Settings → Samsung → Inputs, opens the HDMI chooser. The adapter reads the TV’s actual connected and disconnected source records, including sleeping devices that may be listed as disconnected. It does not guess a universal port count. Missing APIs, denied access and discovery failure produce an unavailable/error state rather than invented ports. The active source comes from the synchronous `tvwindow.getSource()` return value.

Up/Down selects an input. OK requests that exact source; Back returns to Samsung Settings. Retry after a failed load rereads the available sources. A routing error remains an error, and a failed handoff leaves the launcher usable. Timed-out or cancelled requests cannot start a later routing or viewer action; a native request already sent to the TV may itself be uncancellable.

Selecting a source, opening Samsung’s viewer, seeing the expected HDMI picture and waking a CEC device are separate results. The portable implementation does not import firmware-specific viewer payloads or claim to wake a sleeping device. No input discovery or polling runs during hidden startup.

In Duo, a source can also sit on Home like an app. All apps lists the sources after the apps, and Not on Home lists them before the apps. OK switches to that source through the same call as the chooser. A source stays on Home when its device sleeps or is unplugged, because it stands for the port. The TV's public API gives only the type and number of a port, so its name and logo come from the device chosen once for that port: Nintendo Switch, PlayStation, Xbox, Apple TV or Other device, which keeps the port's name and the HDMI logo. List and Dock keep their own All apps and editor, without sources. A source placed on Home in Duo still appears there, with its initials, and opens normally.

## Preferences and wallpaper

The launcher stores appearance, Home order, recently removed apps, the last launched Home app, the device chosen for each port, wallpaper and rotation locally. List and Dock share these preferences. The existing `cleanframe.home.v1` key is retained, with a fallback read from `cleanframe.shore.v1`. Legacy List maps to Dark + List + Type; Glass Dock and Glass Grid map to Photo + Dock + Glass. App order, wallpaper, rotation and the last Home app are preserved.

The gallery contains 15 bundled wallpapers. Settings → Background → Wallpaper keeps the two-pane Settings frame. Up/Down browses a vertical thumbnail list without wrapping; the right-hand Home preview shows the candidate while the surrounding Settings backdrop stays on the applied photo. OK applies the focused photo and stays in Wallpaper. The tick marks the applied photo and preview status distinguishes unsaved browsing. Back restores the latest applied photo, cancels pending loading and returns to Background’s Wallpaper row. Photo and material assets change as one complete bundle; a failed load restores the applied preview and offers retry. Preview loading waits briefly for remote focus to settle. OK during loading queues application for that photo; another browse move or Back cancels it. Browsing never saves, and repeated OK on the applied photo does not write again.

Settings → Background → Rotation offers Fixed, Each time Home opens, Every 5 minutes, Every 15 minutes and Every hour. Each time Home opens advances once when the launcher loads; a return to the already-running launcher does not advance it. Timed rotation counts only visible Photo Home time in either List or Dock. Panels, flat backgrounds and time spent in other apps pause the cycle. Changing the photo or rotation mode starts a new interval.

Launcher wallpaper is separate from native Art Mode. Runtime photos, materials and available fonts are local assets; they do not require the Mac or a network download.

## Sources

- [Samsung Application API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html): installed-app discovery and application control.
- [Samsung application termination guide](https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html): exiting is not treated as a deterministic Samsung Home route.

The native Home operation and startup configuration from 19 October remain separate from this app update. Home from Netflix was confirmed for that configuration; power-on after Netflix remains provisional. Streaming apps retain their own Back navigation. Netflix did not exit on repeated Back in the observed test, so there was no app-exit destination to verify. No global Back interception or key-filter hook was installed. See [TV status](tv-status.md) for device evidence; this behaviour specification is not an installation or visual-verification record for 0.6.0.

## Clock and rendering

List and Dock show the TV's local time in 24-hour format, without seconds. It updates at the minute boundary and on return to the launcher. No date or clock panel is shown. Duo draws the time as images with a leading zero (`09:41`), under the French date, and its day and night images cross-fade with the sun, once a minute.

Weather appears under the clock. `updateWeather` asks Open-Meteo for the configured `WEATHER_PLACE` every 30 minutes while the launcher is visible, and retries after 5 minutes on failure. It sends coordinates only and needs no key. A failure keeps the last reading, or shows nothing before the first one.

Photographic materials and blurred panel backgrounds are generated before packaging and stay aligned with the full-screen image. Photo colour and contrast metadata are also prepared offline. Navigation does not sample image pixels, run an optics engine or apply live backdrop blur. Flat backgrounds use matching light or dark panel colours. Focus feedback uses transforms and opacity; reduced motion removes animated scaling and movement while retaining opacity feedback.

Hidden prelaunch can install a fully loaded wallpaper bundle without waiting for an animation frame. A valid loaded image remains usable if detached-image decoding rejects. A failed startup bundle retries when the launcher becomes visible; an active wallpaper preview keeps its candidate. Font recovery clears fallback measurements and cached markup. This readiness fallback uses a completed load and nonzero image dimensions; it does not prove a TV has painted the image, and an accepted bundle is not automatically decoded again on return. These paths have browser regression coverage; physical cold-boot behaviour still needs owner observation.
