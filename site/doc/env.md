---
title: Environment
description: Install, enroll, path roots, push. Do not set PAIRFOB_JOIN_TOKEN.
---

# Environment

Operator-facing variables only. Leave unspecified variables unset. Do not put secrets in a global `~/.zshrc` you then paste into logs.

## Enroll and origin

| Variable | When |
| --- | --- |
| `PAIRFOB_ORIGIN` | Default `https://pairfob.com` (this project's official instance). Leave unset |
| `PAIRFOB_JOIN_TOKEN` | **Forbidden**. Setting it fails startup |

## Local state

| Variable | Default | Notes |
| --- | --- | --- |
| `PAIRFOB_STATE_DIR` | `~/.config/pairfob` | Identity, devices, logs |
| `PAIRFOB_ALLOWED_ROOTS` | user Home | Allowed roots for web paths. Setting it replaces Home |
| `PAIRFOB_MULTI_SESSION` | on | Lets the phone list and switch to named Herdr sessions (`herdr --session <name>`) from the Sessions header and Settings. `0` turns it off; `HERDR_SOCKET_PATH` set to a non-default path keeps it off unless `1` is set. Pairfob still starts only the default server. Notifications still come from the default session only. See [Named Herdr sessions](/app#named-herdr-sessions) |

## Install

| Variable | Notes |
| --- | --- |
| `PAIRFOB_DOWNLOAD_BASE` | Binary download root, default `https://pairfob.com/dl` |
| `PAIRFOB_INSTALL_PREFIX` | Same as `install.sh --prefix` |

## Push

| Variable | Notes |
| --- | --- |
| `PAIRFOB_PUSH` | Defaults to `1` (on); `0` disables |
| `PAIRFOB_VAPID_SUBJECT` | Optional `mailto:` or `https:` URL you control; default `https://pairfob.com` |

Save explicit settings with `PAIRFOB_PUSH=0 pairfob service install` (or `1` to enable). Reinstallation preserves existing push settings; a plain restart does not import shell variables. See [Notifications](/push).

## Keep off

| Variable | Why |
| --- | --- |
| `PAIRFOB_HERDR_AUTOSTART` | `0` skips starting Herdr automatically |
| `PAIRFOB_DEV_FAKE_RUNTIME` | Demo data, not real Herdr |
| `PAIRFOB_DEV_AUTO_ADMIT` | Skips computer confirm. Outside isolated tests this hands the computer to anyone with the code |
