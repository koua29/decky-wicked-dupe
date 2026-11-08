"""Wicked Dupe backend.

Saves a copy of the No Rest for the Wicked realm files (the world: chests,
buildings) and puts it back later. Character files are never touched, so what
the character carries survives the restore: that is the duplication trick.
"""
import glob
import json
import os
import re
import shutil
import ssl
import urllib.request

import decky

APPID = "1371980"
# Decky does not always run the backend with HOME set to the deck user.
HOME = getattr(decky, "DECKY_USER_HOME", "") or os.path.expanduser("~")
STEAM_ROOTS = [os.path.join(HOME, ".local/share/Steam"), os.path.join(HOME, ".steam/steam")]
SAVE_SUBPATH = "pfx/drive_c/users/steamuser"
GAME_EXE = "norestforthewicked"

SNAPSHOT_DIR = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "snapshot")
UNDO_DIR = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "before_restore")


REPO = "koua29/decky-wicked-dupe"
ZIP_NAME = "WickedDupe.zip"
CURRENT_VERSION = getattr(decky, "DECKY_PLUGIN_VERSION", "0.0.0")


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for path in ("/etc/ssl/certs/ca-certificates.crt",
                 "/etc/ca-certificates/extracted/tls-ca-bundle.pem"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


def _version_key(version):
    numbers = tuple(int(n) for n in re.findall(r"\d+", version.split("-", 1)[0])[:3])
    return numbers + (0,) * (3 - len(numbers))


def _latest_release():
    """Latest GitHub release, compared with the installed version."""
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                 headers={"User-Agent": "WickedDupe"})
    with urllib.request.urlopen(req, timeout=15, context=_ssl_context()) as resp:
        release = json.loads(resp.read().decode("utf-8", "replace"))
    asset = next((a for a in release.get("assets", []) if a.get("name") == ZIP_NAME), {})
    latest = release.get("tag_name", "").lstrip("v")
    digest = asset.get("digest") or ""
    return {
        "current": CURRENT_VERSION,
        "latest": latest,
        "available": bool(asset) and _version_key(latest) > _version_key(CURRENT_VERSION),
        "url": release.get("html_url", ""),
        "zip_url": asset.get("browser_download_url", ""),
        "zip_sha256": digest[7:] if digest.startswith("sha256:") else "",
    }


def _library_folders():
    """Every Steam library (the save sits in the library where the game is installed)."""
    roots = []
    for root in STEAM_ROOTS:
        root = os.path.realpath(root)
        if os.path.isdir(root) and root not in roots:
            roots.append(root)
        vdf = os.path.join(root, "steamapps", "libraryfolders.vdf")
        try:
            with open(vdf, encoding="utf-8", errors="ignore") as f:
                for path in re.findall(r'"path"\s+"([^"]+)"', f.read()):
                    path = os.path.realpath(path)
                    if os.path.isdir(path) and path not in roots:
                        roots.append(path)
        except OSError:
            pass
    return roots


def _store_dir():
    """Folder of the newest realm file inside the game's Proton prefix.

    The video shows .../LocalLow/Moon Studios/NoRestForTheWicked/Data/Store/<build>,
    but the exact names are not relied on: any folder holding realm files counts.
    """
    best, best_time = None, 0
    for lib in _library_folders():
        users = os.path.join(lib, "steamapps", "compatdata", APPID, SAVE_SUBPATH)
        for folder, _dirs, files in os.walk(users):
            for f in files:
                if "realm" in f.lower():
                    t = os.path.getmtime(os.path.join(folder, f))
                    if t > best_time:
                        best, best_time = folder, t
    return best


def _searched():
    return [os.path.join(lib, "steamapps", "compatdata", APPID) for lib in _library_folders()]


def _realm_files(folder):
    if not folder or not os.path.isdir(folder):
        return []
    return sorted(f for f in os.listdir(folder)
                  if "realm" in f.lower() and os.path.isfile(os.path.join(folder, f)))


def _copy(files, src, dst):
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(dst):
        os.remove(os.path.join(dst, f))
    for f in files:
        shutil.copy2(os.path.join(src, f), os.path.join(dst, f))


def _put_back(src, store):
    """Replace the realm files of the game with the ones in src."""
    for f in _realm_files(store):
        os.remove(os.path.join(store, f))
    for f in _realm_files(src):
        shutil.copy2(os.path.join(src, f), os.path.join(store, f))


def _game_running():
    pids = os.listdir("/proc") if os.path.isdir("/proc") else []
    for pid in pids:
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                if GAME_EXE in f.read().lower().decode(errors="ignore"):
                    return True
        except OSError:
            pass
    return False


def _stamp(folder):
    files = _realm_files(folder)
    if not files:
        return 0
    return int(max(os.path.getmtime(os.path.join(folder, f)) for f in files))


class Plugin:
    async def get_state(self):
        store = _store_dir()
        return {
            "found": store is not None,
            "searched": _searched(),
            "build": os.path.basename(store) if store else "",
            "realm_files": len(_realm_files(store)),
            "game_running": _game_running(),
            "snapshot_time": _stamp(SNAPSHOT_DIR),
            "snapshot_files": len(_realm_files(SNAPSHOT_DIR)),
            "undo_time": _stamp(UNDO_DIR),
        }

    async def snapshot(self):
        store = _store_dir()
        files = _realm_files(store)
        if not files:
            return {"ok": False, "code": "no_save"}
        _copy(files, store, SNAPSHOT_DIR)
        decky.logger.info(f"snapshot: {len(files)} realm files from {store}")
        return {"ok": True, "code": "saved", "count": len(files)}

    async def restore(self):
        store = _store_dir()
        if not store:
            return {"ok": False, "code": "no_save"}
        if not _realm_files(SNAPSHOT_DIR):
            return {"ok": False, "code": "no_snapshot"}
        # Safety copy first, so a restore can always be undone.
        _copy(_realm_files(store), store, UNDO_DIR)
        _put_back(SNAPSHOT_DIR, store)
        decky.logger.info(f"restore: snapshot put back into {store}")
        return {"ok": True, "code": "restored"}

    async def undo(self):
        store = _store_dir()
        if not store:
            return {"ok": False, "code": "no_save"}
        if not _realm_files(UNDO_DIR):
            return {"ok": False, "code": "no_undo"}
        _put_back(UNDO_DIR, store)
        decky.logger.info(f"undo: realm before the last restore put back into {store}")
        return {"ok": True, "code": "undone"}

    async def check_update(self):
        try:
            return _latest_release()
        except Exception as e:
            decky.logger.warning(f"update check failed: {e}")
            return {"current": CURRENT_VERSION, "error": str(e)}

    async def _main(self):
        decky.logger.info(f"Wicked Dupe started, home {HOME}, searched {_searched()}, save folder: {_store_dir()}")

    async def _unload(self):
        pass
