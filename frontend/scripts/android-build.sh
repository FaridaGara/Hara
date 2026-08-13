#!/usr/bin/env bash
set -euo pipefail

HARA_ANDROID_TOOLS="${HARA_ANDROID_TOOLS:-${HOME}/.local/share/hara-android}"
HARA_JAVA_HOME="${HARA_ANDROID_TOOLS}/jdk"
HARA_ANDROID_SDK="${HARA_ANDROID_TOOLS}/sdk"

if [[ ! -x "${HARA_JAVA_HOME}/bin/java" ]]; then
  echo "Java 21 tapılmadı. Əvvəlcə 'npm run android:install-tools' işlədin." >&2
  exit 1
fi

if [[ ! -d "${HARA_ANDROID_SDK}/platforms/android-36" ]]; then
  echo "Android SDK 36 tapılmadı. Əvvəlcə 'npm run android:install-tools' işlədin." >&2
  exit 1
fi

export JAVA_HOME="${HARA_JAVA_HOME}"
export ANDROID_HOME="${HARA_ANDROID_SDK}"
export ANDROID_SDK_ROOT="${HARA_ANDROID_SDK}"

cd android
exec ./gradlew assembleDebug "$@"
