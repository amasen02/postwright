"""Publish one X post through the operator's already-authorized browser session.

Executed by browser-harness. Reads a JSON job from POSTWRIGHT_X_JOB (a file path) and
prints a single JSON line prefixed with RESULT: describing what was actually published.

Design rules this follows:
  * Never invent success. The result is read back from the rendered post, not assumed.
  * Verify the composed text matches the intended text BEFORE the publish click.
  * Never trigger a browser dialog.
  * Never print the post-composition state as success if the readback fails.
"""

import json
import os
import re
import time
from urllib.parse import urlsplit

JOB = json.load(open(os.environ["POSTWRIGHT_X_JOB"], encoding="utf-8"))
TEXT = JOB["text"]
MEDIA = JOB.get("media")
HANDLE = JOB["handle"]


def norm(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def emit(payload):
    print("RESULT:" + json.dumps(payload))


def find_x_tab():
    for tab in list_tabs():  # noqa: F821 - provided by browser-harness
        if not isinstance(tab, dict):
            continue
        if (urlsplit(tab.get("url", "")).hostname or "").lower().endswith("x.com"):
            return tab
    return None


tab = find_x_tab()
if not tab:
    emit({"ok": False, "stage": "attach", "error": "no logged-in x.com tab is open"})
    raise SystemExit(0)

switch_tab(tab.get("targetId"))  # noqa: F821
activate_tab(current_tab())  # noqa: F821 - compose needs a visible tab
time.sleep(0.6)

goto_url("https://x.com/compose/post")  # noqa: F821
wait_for_load()  # noqa: F821
time.sleep(2.5)

# Confirm the session is the expected account before typing anything into it.
who = js("""
(() => {
  const a = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  const t = a ? a.innerText : '';
  const m = t.match(/@([A-Za-z0-9_]+)/);
  return m ? m[1] : '';
})()
""")  # noqa: F821
if who and norm(who).lower() != HANDLE.lower():
    emit({"ok": False, "stage": "identity", "error": f"session is @{norm(who)}, expected @{HANDLE}"})
    raise SystemExit(0)

box = js("""
(() => {
  const el = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!el) return null;
  el.focus();
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.left + r.width / 2, y: r.top + r.height / 2});
})()
""")  # noqa: F821
if not box:
    emit({"ok": False, "stage": "compose", "error": "compose textbox not found"})
    raise SystemExit(0)

pos = json.loads(box)
click_at_xy(pos["x"], pos["y"])  # noqa: F821
time.sleep(0.5)

# DraftJS ignores direct DOM writes, so insert through the input pipeline.
cdp("Input.insertText", text=TEXT)  # noqa: F821
time.sleep(1.5)

media_attached = False
if MEDIA and os.path.exists(MEDIA):
    # Attach through the real file input. A drag-drop simulation does not reliably
    # reach X's uploader, and a synthetic change event cannot carry a real file.
    node = cdp("Runtime.evaluate", expression="""
      (() => {
        const el = document.querySelector('input[type="file"][data-testid="fileInput"]')
                || document.querySelector('input[type="file"]');
        return el || null;
      })()
    """, returnByValue=False)  # noqa: F821
    object_id = (node.get("result") or {}).get("objectId")
    if object_id:
        try:
            cdp("DOM.setFileInputFiles", files=[MEDIA], objectId=object_id)  # noqa: F821
            # The uploader needs time; the publish button stays disabled until it finishes.
            for _ in range(40):
                time.sleep(1)
                state = js("""
                (() => {
                  const rm = document.querySelector('[data-testid="removeMedia"]');
                  const prog = document.querySelector('[role="progressbar"]');
                  return JSON.stringify({attached: !!rm, busy: !!prog});
                })()
                """)  # noqa: F821
                if state:
                    s = json.loads(state)
                    if s.get("attached") and not s.get("busy"):
                        media_attached = True
                        break
        except Exception:
            media_attached = False

if MEDIA and not media_attached:
    emit({"ok": False, "stage": "media",
          "error": "the GIF did not attach; refusing to publish a visual post without its visual"})
    raise SystemExit(0)

composed = js("""
(() => {
  const el = document.querySelector('[data-testid="tweetTextarea_0"]');
  return el ? el.innerText : '';
})()
""")  # noqa: F821

if norm(composed) != norm(TEXT):
    emit({
        "ok": False, "stage": "verify-before-publish",
        "error": "composed text does not match the intended text",
        "composed": norm(composed)[:400],
    })
    raise SystemExit(0)

before = js("""
(() => {
  const a = document.querySelector('article [href*="/status/"]');
  return a ? a.getAttribute('href') : '';
})()
""")  # noqa: F821

btn = js("""
(() => {
  const el = document.querySelector('[data-testid="tweetButton"]')
          || document.querySelector('[data-testid="tweetButtonInline"]');
  if (!el || el.getAttribute('aria-disabled') === 'true') return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({x: r.left + r.width / 2, y: r.top + r.height / 2});
})()
""")  # noqa: F821
if not btn:
    emit({"ok": False, "stage": "publish", "error": "publish button missing or disabled"})
    raise SystemExit(0)

bpos = json.loads(btn)
click_at_xy(bpos["x"], bpos["y"])  # noqa: F821
time.sleep(6)

# Read the published post back from the profile timeline. A click is not evidence.
goto_url(f"https://x.com/{HANDLE}")  # noqa: F821
wait_for_load()  # noqa: F821
time.sleep(4)

found = js("""
(() => {
  const out = [];
  document.querySelectorAll('article[data-testid="tweet"]').forEach(a => {
    const tm = a.querySelector('time');
    const link = tm ? tm.closest('a') : null;
    const txt = a.querySelector('[data-testid="tweetText"]');
    const author = a.querySelector('[data-testid="User-Name"]');
    out.push({
      href: link ? link.getAttribute('href') : '',
      text: txt ? txt.innerText : '',
      when: tm ? tm.getAttribute('datetime') : '',
      author: author ? author.innerText : ''
    });
  });
  return JSON.stringify(out.slice(0, 8));
})()
""")  # noqa: F821

candidates = json.loads(found) if found else []
target = None
for item in candidates:
    if norm(item.get("text")) == norm(TEXT):
        target = item
        break

if not target:
    emit({
        "ok": False, "stage": "readback",
        "error": "published post was not found on the profile; verify manually before retrying",
        "seen": [norm(c.get("text"))[:80] for c in candidates[:3]],
    })
    raise SystemExit(0)

href = target.get("href") or ""
owner = href.strip("/").split("/")[0] if href else ""
emit({
    "ok": True,
    "url": "https://x.com" + href,
    "owner": owner,
    "text": target.get("text"),
    "when": target.get("when"),
})
