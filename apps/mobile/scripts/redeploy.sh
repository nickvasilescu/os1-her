#!/bin/bash
# Build UAOS1 for Android on the server and install it on the paired phone over Wi-Fi (adb).
#   PHONE=172.16.1.91:40601 apps/mobile/scripts/redeploy.sh
#   NO_LAUNCH=1 installs without opening the app (use when the phone is in use).
set -e
cd "$(dirname "$0")/.."
PHONE="${PHONE:-172.16.1.91:40601}"
npx tsc --noEmit -p .
npx vite build --logLevel error
[ -d android ] || npx cap add android
python3 scripts/patch-android.py
npx cap sync android >/dev/null
docker run --rm -v "$HOME:$HOME" -v uaos1-gradle:/root/.gradle -v uaos1-androidhome:/root/.android -w "$PWD/android" \
  ghcr.io/cirruslabs/android-sdk:36 bash -lc "./gradlew --no-daemon -q assembleDebug" 2>&1 | grep -vE "^\[|Install Android SDK" || true
docker run --rm -v "$PWD:$PWD" alpine chown -R "$(id -u):$(id -g)" "$PWD/android"
docker run --rm --network host -v "$HOME/.android-uaos1:/root/.android" -v "$PWD/android/app/build/outputs/apk/debug:/apk" \
  ghcr.io/cirruslabs/android-sdk:36 bash -lc "adb connect $PHONE >/dev/null 2>&1; sleep 2; adb -s $PHONE install -r /apk/app-debug.apk | tail -1; [ -n \"$NO_LAUNCH\" ] && exit 0; adb -s $PHONE shell am force-stop co.tonysplace.uaos1; adb -s $PHONE shell monkey -p co.tonysplace.uaos1 -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1" 2>&1 | grep -v daemon
