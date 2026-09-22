"""Hold one host's CMS worker lock until the owning Node process closes stdin.

Do not remove the lock file: unlinking an advisory-lock inode permits another
process to lock a replacement inode while the original owner is still running.
"""
import fcntl
import json
import os
import sys

lock_path, parent_pid, token = sys.argv[1:]
os.makedirs(os.path.dirname(lock_path), exist_ok=True)
with open(lock_path, "a+") as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(73)
    # Respect a still-running worker from the previous exclusive-file version
    # during upgrades. New flock records remain harmless after release.
    lock.seek(0)
    try:
        previous = json.load(lock)
    except (ValueError, OSError):
        previous = {}
    if previous.get("token") and previous.get("locking") != "flock-v1":
        try:
            os.kill(int(previous["pid"]), 0)
        except ProcessLookupError:
            pass
        except (KeyError, ValueError):
            sys.exit(73)
        except PermissionError:
            sys.exit(73)
        else:
            sys.exit(73)
    lock.seek(0)
    lock.truncate()
    json.dump({"pid": int(parent_pid), "token": token, "locking": "flock-v1"}, lock)
    lock.flush()
    os.fsync(lock.fileno())
    print("acquired", flush=True)
    # Parent death closes the pipe; the kernel releases flock when we exit.
    sys.stdin.buffer.read()
