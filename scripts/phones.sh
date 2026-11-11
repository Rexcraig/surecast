#!/bin/zsh
# Installs SureCast on the user's iPhone and keeps the free (7-day) signing fresh.
#
#   scripts/phones.sh release   Freeze the current source as the installed version, build it
#                               with a fresh signature and install it on every reachable phone.
#   scripts/phones.sh renew     (LaunchAgent, hourly) Rebuild the frozen source and reinstall on
#                               any phone whose install expires within 2 days. Posts a Mac
#                               notification when a phone has to be unlocked or brought home.
#   scripts/phones.sh status    When each phone's install expires.
#
# Renewals build the frozen copy, never the working tree, so work in progress can't reach
# the phone. Use `release` to ship a new version.
set -uo pipefail
export LANG=en_US.UTF-8 PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin

REPO=${0:A:h:h}
DATA="$HOME/Library/Application Support/SureCast"
SRC="$DATA/src"
DERIVED="$DATA/build"
APP="$DERIVED/Build/Products/Release-iphoneos/SureCast.app"
APP_ID=T5D465LUGX.com.willspro.tideline
PHONES=("YOUR-IPHONE-UDID:iPhone")
RENEW_WITHIN=$((2 * 86400))
mkdir -p "$DATA/state"

log() { print -r -- "$(date '+%F %T') $*" >> "$DATA/renew.log"; print -r -- "$*"; }
notify() {
    log "notify: $1"
    /usr/bin/osascript -e "display notification \"$1\" with title \"SureCast\"" 2>/dev/null
}
# Runs a command, killing it after $1 seconds (a keychain prompt nobody answers must not hang it).
limit() { local secs=$1; shift; /usr/bin/perl -e 'alarm shift; exec @ARGV' "$secs" "$@"; }

iso_to_epoch() { date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s; }
profile_field() { security cms -D -i "$1" 2>/dev/null | plutil -extract "$2" raw -o - - 2>/dev/null; }
app_expiry() { iso_to_epoch "$(profile_field "$APP/embedded.mobileprovision" ExpirationDate)"; }
show_date() { date -r "$1" '+%a %b %-d, %-I:%M %p'; }

# Deletes cached signing profiles for this app that expire within `$1` seconds, so the
# next build asks Apple for a new 7-day one instead of reusing the old one.
drop_old_profiles() {
    local now=$(date +%s) f
    for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision(N) \
             "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision(N); do
        [[ "$(profile_field "$f" Entitlements.application-identifier)" == "$APP_ID" ]] || continue
        local exp=$(iso_to_epoch "$(profile_field "$f" ExpirationDate)")
        if (( exp - now < $1 )); then log "dropping profile expiring $(show_date $exp): ${f:t}"; rm -f "$f"; fi
    done
}

build() {
    log "building $SRC"
    limit 1800 xcodebuild -project "$SRC/SureCast.xcodeproj" -scheme SureCast -configuration Release \
        -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" -allowProvisioningUpdates build \
        >> "$DATA/build.log" 2>&1 || { notify "Renewal build failed; see $DATA/build.log"; return 1; }
    log "built; signature good until $(show_date $(app_expiry))"
}

reachable() { xcrun devicectl list devices 2>/dev/null | grep "$1" | grep -q "available"; }

# install <udid> <name>: 0 on success.
install_on() {
    local udid=$1 name=$2
    reachable "$udid" || { log "$name not reachable"; return 1; }
    if limit 600 xcrun devicectl device install app --device "$udid" "$APP" >> "$DATA/build.log" 2>&1; then
        app_expiry > "$DATA/state/$udid"
        log "installed on $name, good until $(show_date $(app_expiry))"
        return 0
    fi
    log "install on $name failed (locked?)"
    return 1
}

case "${1:-}" in
release)
    # The version lives in two places: VERSION in web/index.html (shown on the page) and project.yml (the app).
    # They must match; the Xcode project is regenerated from project.yml so it never needs a hand edit.
    web_ver=$(sed -n 's/^const VERSION = "\(.*\)";$/\1/p' "$REPO/SureCast/web/index.html")
    app_ver=$(sed -n 's/.*MARKETING_VERSION: "\(.*\)"/\1/p' "$REPO/project.yml")
    [[ -n "$web_ver" && "$web_ver" == "$app_ver" ]] || { log "release: version mismatch (page '$web_ver', project.yml '$app_ver')"; exit 1; }
    (cd "$REPO" && xcodegen generate >> "$DATA/build.log" 2>&1) || { log "release: xcodegen failed; see $DATA/build.log"; exit 1; }
    log "release: freezing $REPO (v$web_ver)"
    rm -rf "$SRC" && mkdir -p "$SRC" || exit 1
    # APFS clones: instant, and no extra disk space until files change.
    cp -cR "$REPO/SureCast" "$REPO/SureCast.xcodeproj" "$REPO/project.yml" "$SRC/" || exit 1
    drop_old_profiles $((7 * 86400))
    build || exit 1
    for entry in $PHONES; do install_on "${entry%%:*}" "${entry#*:}"; done
    # Rule: the phone app and the web link (occhiphoto.com/surecast) always ship the same version.
    if ~/surecast-web/deploy.sh >> "$DATA/build.log" 2>&1; then log "web link updated"; else notify "Web link update failed; see $DATA/build.log"; fi
    ;;
renew)
    now=$(date +%s); hour=$(date +%-H)
    (( hour >= 8 && hour < 22 )) || exit 0
    due=()
    for entry in $PHONES; do
        udid=${entry%%:*}
        exp=$(cat "$DATA/state/$udid" 2>/dev/null || echo 0)
        (( exp - now < RENEW_WITHIN )) && due+=("$entry")
    done
    (( ${#due} )) || exit 0
    [[ -d "$SRC" ]] || { notify "No frozen version to renew; run scripts/phones.sh release"; exit 1; }
    # One fresh build per renewal round; later hourly runs reuse it.
    if [[ ! -d "$APP" ]] || (( $(app_expiry) - now < 5 * 86400 )); then
        drop_old_profiles $((3 * 86400))
        build || exit 1
        if (( $(app_expiry) - now < 5 * 86400 )); then
            notify "Apple didn't issue a fresh signature; renew by hand in Xcode"
            exit 1
        fi
    fi
    for entry in $due; do
        udid=${entry%%:*} name=${entry#*:}
        install_on "$udid" "$name" && { notify "Renewed on $name, good until $(show_date $(app_expiry))"; continue; }
        # Remind at most every 3 hours.
        exp=$(cat "$DATA/state/$udid" 2>/dev/null || echo 0)
        last=$(cat "$DATA/state/$udid.reminded" 2>/dev/null || echo 0)
        if (( now - last >= 3 * 3600 )); then
            notify "Unlock $name on home Wi-Fi to renew it (stops opening $(show_date $exp))"
            print $now > "$DATA/state/$udid.reminded"
        fi
    done
    ;;
status)
    for entry in $PHONES; do
        exp=$(cat "$DATA/state/${entry%%:*}" 2>/dev/null || echo 0)
        print -r -- "${entry#*:}: $( (( exp )) && show_date $exp || echo unknown )"
    done
    ;;
*)
    print "usage: ${0:t} release|renew|status"; exit 2
    ;;
esac
