#!/bin/sh
set -eu
if [ "$#" -ne 5 ]; then
  echo 'Usage: sign-apk.sh unsigned.apk keystore.jks password-file alias output.apk' >&2
  exit 2
fi
ggr_input=$1
ggr_keystore=$2
ggr_password_file=$3
ggr_alias=$4
ggr_output=$5
test -f "$ggr_input"
test -f "$ggr_keystore"
test -f "$ggr_password_file"
test ! -e "$ggr_output"
ggr_temp=$(mktemp -d)
trap 'rm -rf "$ggr_temp"' EXIT HUP INT TERM
zipalign -P 16 -f 4 "$ggr_input" "$ggr_temp/aligned.apk"
apksigner sign --ks "$ggr_keystore" --ks-pass "file:$ggr_password_file" --ks-key-alias "$ggr_alias" --out "$ggr_output" "$ggr_temp/aligned.apk"
apksigner verify --verbose --print-certs "$ggr_output"
zipalign -c -P 16 4 "$ggr_output"
