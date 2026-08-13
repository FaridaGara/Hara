#!/usr/bin/env bash
set -euo pipefail

HARA_ANDROID_TOOLS="${HARA_ANDROID_TOOLS:-${HOME}/.local/share/hara-android}"
HARA_JAVA_HOME="${HARA_ANDROID_TOOLS}/jdk"
HARA_ANDROID_SDK="${HARA_ANDROID_TOOLS}/sdk"
HARA_COMMAND_LINE_TOOLS_VERSION="15859902"
HARA_COMMAND_LINE_TOOLS_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"
HARA_JDK_URL="https://aka.ms/download-jdk/microsoft-jdk-21-linux-x64.tar.gz"
HARA_JDK_SHA256_URL="${HARA_JDK_URL}.sha256sum.txt"
HARA_ANDROID_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-${HARA_COMMAND_LINE_TOOLS_VERSION}_latest.zip"

mkdir -p "${HARA_ANDROID_TOOLS}" "${HARA_ANDROID_SDK}/cmdline-tools"

HARA_TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "${HARA_TEMP_DIR}"' EXIT

if [[ ! -x "${HARA_JAVA_HOME}/bin/java" ]]; then
  echo "Java 21 endirilir…"
  curl --fail --location --retry 3 --output "${HARA_TEMP_DIR}/jdk.tar.gz" "${HARA_JDK_URL}"
  curl --fail --location --retry 3 --output "${HARA_TEMP_DIR}/jdk.sha256" "${HARA_JDK_SHA256_URL}"
  HARA_JDK_SHA256="$(awk '{print $1}' "${HARA_TEMP_DIR}/jdk.sha256")"
  printf '%s  %s\n' "${HARA_JDK_SHA256}" "${HARA_TEMP_DIR}/jdk.tar.gz" | sha256sum --check --status
  mkdir -p "${HARA_JAVA_HOME}"
  tar -xzf "${HARA_TEMP_DIR}/jdk.tar.gz" --strip-components=1 -C "${HARA_JAVA_HOME}"
else
  echo "Java 21 artıq quraşdırılıb."
fi

export JAVA_HOME="${HARA_JAVA_HOME}"
export ANDROID_HOME="${HARA_ANDROID_SDK}"

if [[ ! -x "${HARA_ANDROID_SDK}/cmdline-tools/latest/bin/sdkmanager" ]]; then
  echo "Android command-line tools endirilir…"
  curl --fail --location --retry 3 --output "${HARA_TEMP_DIR}/command-line-tools.zip" "${HARA_ANDROID_TOOLS_URL}"
  printf '%s  %s\n' "${HARA_COMMAND_LINE_TOOLS_SHA256}" "${HARA_TEMP_DIR}/command-line-tools.zip" | sha256sum --check --status
  mkdir -p "${HARA_TEMP_DIR}/command-line-tools"
  (
    cd "${HARA_TEMP_DIR}/command-line-tools"
    "${HARA_JAVA_HOME}/bin/jar" xf "${HARA_TEMP_DIR}/command-line-tools.zip"
  )
  mv "${HARA_TEMP_DIR}/command-line-tools/cmdline-tools" "${HARA_ANDROID_SDK}/cmdline-tools/latest"
  chmod +x "${HARA_ANDROID_SDK}/cmdline-tools/latest/bin/"*
else
  echo "Android command-line tools artıq quraşdırılıb."
fi

HARA_SDKMANAGER="${HARA_ANDROID_SDK}/cmdline-tools/latest/bin/sdkmanager"

echo "Android SDK lisenziyaları qəbul edilir…"
yes | "${HARA_SDKMANAGER}" --sdk_root="${HARA_ANDROID_SDK}" --licenses >/dev/null || true

echo "Android SDK 36 və build alətləri quraşdırılır…"
"${HARA_SDKMANAGER}" \
  --sdk_root="${HARA_ANDROID_SDK}" \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0"

"${HARA_JAVA_HOME}/bin/java" -version
"${HARA_SDKMANAGER}" --sdk_root="${HARA_ANDROID_SDK}" --list_installed
