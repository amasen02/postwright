"""Publish one LinkedIn post (and, optionally, its first comment) through the operator's
already-authorized browser session.

Executed by browser-harness. Reads a JSON job from POSTWRIGHT_LINKEDIN_JOB (a file path)
and prints a single JSON line prefixed with RESULT: describing what was actually published.

Mirrors x_publish.py's safety contract:
  * Never invent success. The result is read back from the rendered post, not assumed.
  * Verify the composed text (and audience) matches the intended text BEFORE the publish
    click.
  * Locate interactive elements from a fresh accessibility tree rather than a hardcoded
    CSS selector: LinkedIn's DOM/class names churn far more often than its AX roles/names.
  * Attach the GIF through the real file input; refuse to publish a visual post without
    its visual.
  * Never trigger a browser dialog.
  * Distinguish a pre-publish refusal (stage != "readback") from a post-click uncertain
    outcome (stage == "readback"): only the latter must never be retried automatically.
  * A first-comment failure is reported separately from the post outcome and never causes
    a retry of the post itself: the post already succeeded and is irreversible.
"""

import json
import os
import re
import time
from urllib.parse import urlsplit

JOB = json.load(open(os.environ["POSTWRIGHT_LINKEDIN_JOB"], encoding="utf-8"))
TEXT = JOB["text"]
FIRST_COMMENT = (JOB.get("firstComment") or "").strip()
MEDIA = JOB.get("media")
PROFILE = JOB["profile"].strip("/")  # e.g. "in/ama-sen"


def norm(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def emit(payload):
    print("RESULT:" + json.dumps(payload))


def find_linkedin_tab():
    for tab in list_tabs():  # noqa: F821 - provided by browser-harness
        if not isinstance(tab, dict):
            continue
        host = (urlsplit(tab.get("url", "")).hostname or "").lower()
        if host in ("linkedin.com", "www.linkedin.com"):
            return tab
    return None


def ax_nodes():
    # Always re-fetched: LinkedIn's compose surface remounts after navigation and after a
    # file attaches, so a tree captured earlier can point at detached nodes.
    return cdp("Accessibility.getFullAXTree").get("nodes", [])  # noqa: F821


def find_ax(role, name_pattern=None):
    for node in ax_nodes():
        node_role = (node.get("role") or {}).get("value", "")
        if node_role != role:
            continue
        if name_pattern is None:
            if node.get("backendDOMNodeId"):
                return node
            continue
        name = (node.get("name") or {}).get("value", "")
        if re.search(name_pattern, name, re.I) and node.get("backendDOMNodeId"):
            return node
    return None


def click_ax(node):
    box = cdp("DOM.getBoxModel", backendNodeId=node["backendDOMNodeId"])  # noqa: F821
    quad = box["model"]["content"]
    x, y = sum(quad[0::2]) / 4, sum(quad[1::2]) / 4
    click_at_xy(x, y)  # noqa: F821
    return x, y


tab = find_linkedin_tab()
if not tab:
    emit({"ok": False, "stage": "attach", "error": "no logged-in linkedin.com tab is open"})
    raise SystemExit(0)

switch_tab(tab.get("targetId"))  # noqa: F821
activate_tab(current_tab())  # noqa: F821 - compose needs a visible tab
time.sleep(0.6)

goto_url("https://www.linkedin.com/feed/")  # noqa: F821
wait_for_load()  # noqa: F821
time.sleep(2)

# Confirm the session is the expected profile before typing anything into it.
who = js("""
(() => {
  const a = document.querySelector('a.global-nav__me-photo')?.closest('a')
         || document.querySelector('a[href*="/in/"][data-control-name="identity_welcome_message"]')
         || document.querySelector('nav a.global-nav__primary-link[href*="/in/"]');
  return a ? a.getAttribute('href') : '';
})()
""")  # noqa: F821
who_path = urlsplit(who or "").path.strip("/")
if who_path and not who_path.rstrip("/").lower() == PROFILE.lower():
    emit({"ok": False, "stage": "identity", "error": f"session profile is /{norm(who_path)}/, expected /{PROFILE}/"})
    raise SystemExit(0)

start_node = find_ax("button", r"start a post")
if not start_node:
    emit({"ok": False, "stage": "compose", "error": "\"Start a post\" control not found in the accessibility tree"})
    raise SystemExit(0)
click_ax(start_node)
time.sleep(1.5)
wait_for_load()  # noqa: F821

route = norm(js("() => location.pathname"))  # noqa: F821
if "/sharing/compose" not in route:
    emit({"ok": False, "stage": "compose", "error": f"compose route is {route}, expected /sharing/compose"})
    raise SystemExit(0)

box_node = find_ax("textbox")
if not box_node:
    emit({"ok": False, "stage": "compose", "error": "compose textbox not found in the accessibility tree"})
    raise SystemExit(0)
click_ax(box_node)
time.sleep(0.5)

# LinkedIn's rich-text editor ignores direct DOM writes, so insert through the input pipeline.
cdp("Input.insertText", text=TEXT)  # noqa: F821
time.sleep(1.5)

media_attached = False
if MEDIA and os.path.exists(MEDIA):
    node = cdp("Runtime.evaluate", expression="""
      (() => document.querySelector('input[type="file"]'))()
    """, returnByValue=False)  # noqa: F821
    object_id = (node.get("result") or {}).get("objectId")
    if object_id:
        try:
            cdp("DOM.setFileInputFiles", files=[MEDIA], objectId=object_id)  # noqa: F821
            # The publish control stays disabled/absent until the upload finishes.
            for _ in range(40):
                time.sleep(1)
                state = js("""
                (() => {
                  const media = document.querySelector('video, img[src^="blob:"], [data-test-id*="media"]');
                  const prog = document.querySelector('[role="progressbar"]');
                  return JSON.stringify({attached: !!media, busy: !!prog});
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

# Re-locate the textbox from a fresh tree: attaching media can remount the compose surface.
box_node = find_ax("textbox")
composed = js("""
(() => {
  const el = document.querySelector('div.ql-editor[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
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

# Verify the audience is public before publishing: a narrowed audience is not the intended
# release and must not be silently accepted.
audience_node = find_ax("button", r"anyone|public|audience")
audience = ""
if audience_node:
    audience = (audience_node.get("name") or {}).get("value", "")
if audience and not re.search(r"anyone|public", audience, re.I):
    emit({"ok": False, "stage": "audience", "error": f"post audience is not public: {norm(audience)[:120]}"})
    raise SystemExit(0)

publish_node = find_ax("button", r"^post$")
if not publish_node:
    emit({"ok": False, "stage": "publish", "error": "Post control missing or not found in the accessibility tree"})
    raise SystemExit(0)
click_ax(publish_node)
time.sleep(6)

goto_url(f"https://www.linkedin.com/{PROFILE}/recent-activity/all/")  # noqa: F821
wait_for_load()  # noqa: F821
time.sleep(4)

found = js("""
(() => {
  const out = [];
  document.querySelectorAll('[data-urn^="urn:li:activity:"]').forEach(el => {
    const link = el.querySelector('a[href*="/feed/update/"]');
    const txt = el.querySelector('.feed-shared-update-v2__description, .update-components-text');
    out.push({
      urn: el.getAttribute('data-urn') || '',
      href: link ? link.getAttribute('href') : '',
      text: txt ? txt.innerText : ''
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

result = {
    "ok": True,
    "url": "https://www.linkedin.com" + (target.get("href") or ""),
    "owner": "/" + PROFILE + "/",
    "text": target.get("text"),
    "id": target.get("urn"),
}

# The post is already released and irreversible at this point. A first-comment failure is
# reported alongside the post's success and must never trigger a retry of the post.
if FIRST_COMMENT:
    try:
        goto_url(result["url"])  # noqa: F821
        wait_for_load()  # noqa: F821
        time.sleep(2)
        comment_open = find_ax("button", r"comment")
        if not comment_open:
            raise RuntimeError("comment control not found")
        click_ax(comment_open)
        time.sleep(1)
        comment_box = find_ax("textbox")
        if not comment_box:
            raise RuntimeError("comment textbox not found")
        click_ax(comment_box)
        time.sleep(0.3)
        cdp("Input.insertText", text=FIRST_COMMENT)  # noqa: F821
        time.sleep(1)
        composed_comment = js("""
        (() => {
          const boxes = [...document.querySelectorAll('div[role="textbox"][contenteditable="true"]')];
          const el = boxes[boxes.length - 1];
          return el ? el.innerText : '';
        })()
        """)  # noqa: F821
        if norm(composed_comment) != norm(FIRST_COMMENT):
            raise RuntimeError("composed comment does not match the intended first comment")
        submit_node = find_ax("button", r"^(post|comment)$")
        if not submit_node:
            raise RuntimeError("comment submit control not found")
        click_ax(submit_node)
        time.sleep(3)
        posted = js("""
        (() => {
          const nodes = [...document.querySelectorAll('.comments-comment-item, [data-view-name="comments-comment-entity"]')];
          return nodes.some(n => n.innerText && n.innerText.includes(%s)) ? "yes" : "no";
        })()
        """ % json.dumps(FIRST_COMMENT[:60]))  # noqa: F821
        if posted != "yes":
            raise RuntimeError("first comment could not be confirmed on the post")
        result["commentStatus"] = "posted"
    except Exception:
        # Do not surface the raw exception text: it may carry DOM/page content, and this
        # result is scanned as publishable evidence. Only the post's own success matters
        # for the release decision; the comment failure is reported for the operator to
        # retry manually (posting a first comment is idempotent-safe to redo; the post
        # itself is not, which is why only the post half of this driver refuses to retry).
        result["commentStatus"] = "failed"
        result["commentError"] = "first comment could not be verified as posted"
else:
    result["commentStatus"] = "not-requested"

emit(result)
